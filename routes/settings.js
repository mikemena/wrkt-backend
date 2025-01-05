const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// Endpoint to get user's settings

router.get('/settings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const settings = await db.query(
      'SELECT theme_mode, accent_color FROM user_settings WHERE user_id = $1',
      [userId]
    );

    if (settings.rows.length === 0) {
      // Insert default settings if none exist
      const defaultSettings = await db.query(
        `INSERT INTO user_settings (user_id, theme_mode, accent_color)
                 VALUES ($1, 'dark', '#D93B56')
                 RETURNING theme_mode, accent_color`,
        [userId]
      );
      return res.json(defaultSettings.rows[0]);
    }

    res.json(settings.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Endpoint to create initial settings

router.post('/settings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { theme_mode = 'dark', accent_color = '#D93B56' } = req.body;

    const queryString = `
        INSERT INTO user_settings (user_id, theme_mode, accent_color, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        RETURNING *`;

    const { rows } = await db.query(queryString, [
      userId,
      theme_mode,
      accent_color
    ]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      // unique violation
      res.status(409).json({ error: 'Settings already exist for this user' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Endpoint to change settings

router.put('/settings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { theme_mode, accent_color } = req.body;

    // Construct the update part of the query based on provided fields
    const updateParts = [];
    const queryValues = [];
    let queryIndex = 1;

    if (theme_mode !== undefined) {
      updateParts.push(`theme_mode = $${queryIndex++}`);
      queryValues.push(theme_mode);
    }

    if (accent_color !== undefined) {
      updateParts.push(`accent_color = $${queryIndex++}`);
      queryValues.push(accent_color);
    }

    queryValues.push(userId); // For the WHERE condition

    if (updateParts.length === 0) {
      return res.status(400).send('No update fields provided.');
    }

    const queryString = `UPDATE user_settings SET ${updateParts.join(
      ', '
    )} WHERE user_id = $${queryIndex} RETURNING *`;

    const { rows } = await db.query(queryString, queryValues);

    if (rows.length === 0) {
      return res.status(404).send('User not found.');
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

module.exports = router;
