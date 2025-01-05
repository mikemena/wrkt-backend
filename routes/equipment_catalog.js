const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET all equipment
router.get('/equipments', async (req, res) => {
  try {
    const query = `SELECT DISTINCT id, name FROM equipment_catalog ORDER BY name`;
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
    console.error('Error fetching equipment:', error);
    res.status(500).send(error.message);
  }
});

// GET a specific equipment by ID
router.get('/equipments/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    // Query to fetch the equipment with the specified ID
    const { rows } = await db.query(
      'SELECT * FROM equipment_catalog WHERE id = $1',
      [parseInt(id)]
    );

    if (rows.length === 0) {
      // If no equipment is found with the given ID, return a 404 Not Found response
      return res.status(404).json({ message: 'Equipment not found' });
    }

    // If a equipment is found, return it in the response
    res.json(rows[0]);
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error fetching equipment:', error);
    res.status(500).json({ message: 'Error fetching equipment' });
  }
});

// POST a equipment
router.post('/equipments', async (req, res) => {
  try {
    const { name } = req.body;

    const { rows } = await db.query(
      'INSERT INTO equipment_catalog (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// PUT a equipment

router.put('/equipments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, image_id } = req.body;

    // Construct the update part of the query based on provided fields
    const updateParts = [];
    const queryValues = [];
    let queryIndex = 1;

    if (name !== undefined) {
      updateParts.push(`name = $${queryIndex++}`);
      queryValues.push(name);
    }

    if (image_id !== undefined) {
      updateParts.push(`image_id = $${queryIndex++}`);
      queryValues.push(image_id);
    }

    queryValues.push(id); // For the WHERE condition

    if (updateParts.length === 0) {
      return res.status(400).send('No update fields provided.');
    }

    const queryString = `UPDATE equipment_catalog SET ${updateParts.join(
      ', '
    )} WHERE id = $${queryIndex} RETURNING *`;

    const { rows } = await db.query(queryString, queryValues);

    if (rows.length === 0) {
      return res.status(404).send('Equipment not found.');
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Delete equipment

router.delete('/equipments/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    const { rowCount } = await db.query(
      'DELETE FROM equipment_catalog WHERE id = $1',
      [id]
    );

    if (rowCount > 0) {
      res.status(200).json({ message: 'Equipment deleted successfully' });
    } else {
      // If no muscle was found and deleted, return a 404 Not Found response
      res.status(404).json({ message: 'Equipment not found' });
    }
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error deleting equipment:', error);
    res.status(500).json({ message: 'Error deleting equipment' });
  }
});

module.exports = router;
