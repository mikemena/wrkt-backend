const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (auth_provider, email, password_hash, signup_date) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id, auth_provider,email, signup_date',
      [auth_provider, email, passwordHash]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
});

// Endpoint to sign up with social authentication

router.post('/auth/social', async (req, res) => {
  try {
    const { email, authProvider, authProviderId, name } = req.body;

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR (auth_provider = $2 AND auth_provider_id = $3)',
      [email, authProvider, authProviderId]
    );

    let userId;

    if (existingUser.rows.length > 0) {
      // User exists - just return token
      userId = existingUser.rows[0].id;
    } else {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (
          email,
          auth_provider,
          auth_provider_id,
          username,
          signup_date
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        RETURNING id`,
        [email, authProvider, authProviderId, name]
      );
      userId = result.rows[0].id;
    }

    // Generate token
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });

    res.json({ token, user: { id: userId, email } });
  } catch (error) {
    console.error('Social auth error:', error);
    res.status(500).json({ message: 'Server error during social auth' });
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
