const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET all muscles
router.get('/muscles', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT muscle, muscle_group, subcategory
      FROM muscle_groups
      ORDER BY muscle`;
    const { rows } = await db.query(query);

    res.set({
      'Cache-Control': 'public, max-age=86400',
      ETag: require('crypto')
        .createHash('md5')
        .update(JSON.stringify(rows))
        .digest('hex')
    });

    res.json(rows);
  } catch (error) {
    console.error('Error fetching muscles:', error);
    res.status(500).send(error.message);
  }
});

// GET a specific muscle by ID
router.get('/muscles/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    // Query to fetch the muscle with the specified ID
    const { rows } = await db.query(
      `SELECT m.id, m.muscle_group, m.subcategory, m.muscle, i.file_path
      FROM muscle_groups m
      LEFT JOIN image_metadata i ON m.image_id = i.id
      WHERE m.id = $1`,
      [parseInt(id)]
    );

    if (rows.length === 0) {
      // If no muscle is found with the given ID, return a 404 Not Found response
      return res.status(404).json({ message: 'Muscle not found' });
    }

    // If a muscle is found, return it in the response
    res.json(rows[0]);
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error fetching muscle:', error);
    res.status(500).json({ message: 'Error fetching muscle' });
  }
});

// POST a muscle
router.post('/muscles', async (req, res) => {
  try {
    const { muscle_group, subcategory, muscle, image_id } = req.body;
    const { rows } = await db.query(
      'INSERT INTO muscle_groups (muscle_group, subcategory, muscle, image_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [muscle_group, subcategory, muscle, image_id]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// PUT a muscle
router.put('/muscles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { muscle_group, subcategory, muscle, image_id } = req.body;

    // Construct the update part of the query based on provided fields
    const updateParts = [];
    const queryValues = [];
    let queryIndex = 1;

    if (muscle_group !== undefined) {
      updateParts.push(`name = $${queryIndex++}`);
      queryValues.push(muscle_group);
    }

    if (subcategory !== undefined) {
      updateParts.push(`name = $${queryIndex++}`);
      queryValues.push(subcategory);
    }

    if (muscle !== undefined) {
      updateParts.push(`name = $${queryIndex++}`);
      queryValues.push(muscle);
    }

    if (image_id !== undefined) {
      updateParts.push(`id = $${queryIndex++}`);
      queryValues.push(image_id);
    }

    queryValues.push(id); // For the WHERE condition

    if (updateParts.length === 0) {
      return res.status(400).send('No update fields provided.');
    }

    const queryString = `UPDATE muscle_groups SET ${updateParts.join(
      ', '
    )} WHERE id = $${queryIndex} RETURNING *`;

    const { rows } = await db.query(queryString, queryValues);

    if (rows.length === 0) {
      return res.status(404).send('Muscle not found.');
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Delete muscle

router.delete('/muscles/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    const { rowCount } = await db.query(
      'DELETE FROM muscle_groups WHERE id = $1',
      [id]
    );

    if (rowCount > 0) {
      res.status(200).json({ message: 'Muscle deleted successfully' });
    } else {
      // If no muscle was found and deleted, return a 404 Not Found response
      res.status(404).json({ message: 'Muscle not found' });
    }
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error deleting muscle:', error);
    res.status(500).json({ message: 'Error deleting muscle' });
  }
});

module.exports = router;
