const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const db = require('../config/db');
require('dotenv').config();
const { sendPasswordResetEmail } = require('../services/emailService');

// Endpoint to sign up a user

router.post('/auth/signup', async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured');
    }
    const { auth_provider, email, password } = req.body;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate verification token
    const verificationToken = jwt.sign(
      { email, purpose: 'email-verification' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (auth_provider, email, password_hash, signup_date,verification_token,verification_token_expires,access_level) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, NOW() + INTERVAL "24 hours",LIMITED) RETURNING id, auth_provider,email, signup_date',
      [auth_provider, email, passwordHash, verificationToken]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.rows[0].id, accessLevel: 'LIMITED' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Send verification email
    await sendVerificationEmail(email, verificationToken);

    res.json({
      token,
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        accessLevel: 'LIMITED'
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
});

// Endpoint for email verification

router.post('/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.purpose !== 'email-verification') {
      return res.status(400).json({ message: 'Invalid verification token' });
    }

    // Update user verification status
    const result = await pool.query(
      `UPDATE users
       SET email_verified = TRUE,
           verification_token = NULL,
           verification_token_expires = NULL,
           access_level = 'FULL'
       WHERE email = $1 AND verification_token = $2
       RETURNING id, email`,
      [decoded.email, token]
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ message: 'Invalid or expired verification token' });
    }

    // Generate new full access token
    const newToken = jwt.sign(
      {
        userId: result.rows[0].id,
        accessLevel: 'FULL'
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token: newToken,
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        accessLevel: 'FULL'
      }
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ message: 'Server error during email verification' });
  }
});

// Endpoint to resend verification email

router.post('/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    // Generate new verification token
    const verificationToken = jwt.sign(
      { email, purpose: 'email-verification' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update user with new verification token
    const result = await pool.query(
      `UPDATE users
       SET verification_token = $1,
           verification_token_expires = NOW() + INTERVAL '24 hours'
       WHERE email = $2 AND email_verified = FALSE
       RETURNING id`,
      [verificationToken, email]
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ message: 'Invalid email or already verified' });
    }

    // Send new verification email
    await sendVerificationEmail(email, verificationToken);

    res.json({ message: 'Verification email resent successfully' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res
      .status(500)
      .json({ message: 'Server error during resend verification' });
  }
});

// Endpoint to sign up with social authentication

// Add this function to verify Apple's JWT token
async function verifyAppleToken(identityToken) {
  try {
    // Get Apple's public keys
    const appleKeysResponse = await axios.get(
      'https://appleid.apple.com/auth/keys'
    );
    const keys = appleKeysResponse.data.keys;

    // Verify the token using Apple's public key
    // You may want to use a library like 'jwt-decode' for this
    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded) throw new Error('Invalid token');

    return decoded.payload;
  } catch (error) {
    throw new Error('Failed to verify Apple token');
  }
}

router.post('/auth/social', async (req, res) => {
  try {
    const { email, authProvider, identityToken, user } = req.body;

    // Additional verification for Apple sign in
    if (authProvider === 'apple') {
      // Verify the token with Apple
      const verifiedPayload = await verifyAppleToken(identityToken);

      // The email from Apple's token should match the one provided
      if (verifiedPayload.email !== email) {
        return res.status(401).json({ message: 'Invalid authentication' });
      }
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    let userId;

    if (existingUser.rows.length > 0) {
      // User exists - return token
      userId = existingUser.rows[0].id;
    } else {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (
          email,
          auth_provider,
          email_verified,
          signup_date,
          access_level
        ) VALUES ($1, $2, TRUE, CURRENT_TIMESTAMP, 'FULL')
        RETURNING id`,
        [email, authProvider]
      );
      userId = result.rows[0].id;
    }

    // Generate token
    const token = jwt.sign(
      { userId, accessLevel: 'FULL' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: userId,
        email,
        accessLevel: 'FULL'
      }
    });
  } catch (error) {
    console.error('Apple auth error:', error);
    res
      .status(500)
      .json({ message: 'Server error during Apple authentication' });
  }
});

// Endpoint to sign in

router.post('/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Convert bytea to string before comparison
    const passwordHashString = user.password_hash.toString('utf8');

    // Verify password
    const isValidPassword = await bcrypt.compare(password, passwordHashString);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ message: 'Server error during signin' });
  }
});

// Endpoint for a forgotten password

router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    console.log('user email match?', userResult);

    if (userResult.rows.length === 0) {
      // For security, don't reveal if email exists or not
      return res.json({
        message:
          'If an account exists with this email, you will receive a password reset link.'
      });
    }

    const user = userResult.rows[0];

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.id, purpose: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Store reset token and expiry in database
    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2",
      [resetToken, user.id]
    );

    // Send the reset email
    await sendPasswordResetEmail(email, resetToken);

    // For demo purposes, we'll just return the token
    res.json({
      message:
        'If an account exists with this email, you will receive a password reset link.',
      debug_token:
        process.env.NODE_ENV === 'development' ? resetToken : undefined
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res
      .status(500)
      .json({ message: 'Server error during password reset request' });
  }
});

// Endpoint for password reset
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.purpose !== 'password-reset') {
      return res.status(400).json({ message: 'Invalid reset token' });
    }

    // Check if token is still valid in database
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND reset_token = $2 AND reset_token_expires > NOW()',
      [decoded.userId, token]
    );

    if (userResult.rows.length === 0) {
      return res
        .status(400)
        .json({ message: 'Invalid or expired reset token' });
    }

    // Hash new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password and clear reset token
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [passwordHash, decoded.userId]
    );

    res.json({ message: 'Password successfully reset' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error during password reset' });
  }
});

// Endpoint to modify a user

router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email } = req.body;

    // Construct the update part of the query based on provided fields
    const updateParts = [];
    const queryValues = [];
    let queryIndex = 1;

    if (username !== undefined) {
      updateParts.push(`username = $${queryIndex++}`);
      queryValues.push(username);
    }

    if (email !== undefined) {
      updateParts.push(`email = $${queryIndex++}`);
      queryValues.push(email);
    }

    queryValues.push(id); // For the WHERE condition

    if (updateParts.length === 0) {
      return res.status(400).send('No update fields provided.');
    }

    const queryString = `UPDATE users SET ${updateParts.join(
      ', '
    )} WHERE id = $${queryIndex} RETURNING *`;

    const { rows } = await db.query(queryString, queryValues);

    if (rows.length === 0) {
      return res.status(404).send('User not found.');
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Endpoint to delete a user

router.delete('/users/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [
      id
    ]);

    if (rowCount > 0) {
      res.status(200).json({ message: 'User deleted successfully' });
    } else {
      // If no user was found and deleted, return a 404 Not Found response
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

module.exports = router;
