const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Endpoint to get all sets

router.get('/sets', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM sets');
    res.json(rows);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// GET a specific set by ID

router.get('/sets/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    // Query to fetch the set with the specified ID
    const { rows } = await db.query('SELECT * FROM sets WHERE id = $1', [
      parseInt(id)
    ]);

    if (rows.length === 0) {
      // If no set is found with the given ID, return a 404 Not Found response
      return res.status(404).json({ message: 'Set not found' });
    }

    // If a set is found, return it in the response
    res.json(rows[0]);
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error fetching set:', error);
    res.status(500).json({ message: 'Error fetching set' });
  }
});

// Endpoint to create a set

router.post('/sets', async (req, res) => {
  try {
    const { exercise_id, reps, weight, order } = req.body;
    const { rows } = await db.query(
      'INSERT INTO sets (exercise_id,reps,weight,order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [exercise_id, reps, weight, order]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Endpoint to modify a set

router.put('/sets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { workout_id, exercise_id, reps, weight, notes } = req.body;

    // Construct the update part of the query based on provided fields
    const updateParts = [];
    const queryValues = [];
    let queryIndex = 1;

    if (exercise_id !== undefined) {
      updateParts.push(`exercise_id = $${queryIndex++}`);
      queryValues.push(exercise_id);
    }

    if (reps !== undefined) {
      updateParts.push(`reps = $${queryIndex++}`);
      queryValues.push(reps);
    }

    if (weight !== undefined) {
      updateParts.push(`weight = $${queryIndex++}`);
      queryValues.push(weight);
    }

    if (notes !== undefined) {
      updateParts.push(`order = $${queryIndex++}`);
      queryValues.push(order);
    }

    queryValues.push(id); // For the WHERE condition
    if (updateParts.length === 0) {
      return res.status(400).send('No update fields provided.');
    }

    const queryString = `UPDATE sets SET ${updateParts.join(
      ', '
    )} WHERE id = $${queryIndex} RETURNING *`;

    const { rows } = await db.query(queryString, queryValues);

    if (rows.length === 0) {
      return res.status(404).send('Set not found.');
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Endpoint to delete a set

router.delete('/sets/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    const { rowCount } = await db.query('DELETE FROM sets WHERE id = $1', [id]);

    if (rowCount > 0) {
      res.status(200).json({ message: 'Set deleted successfully' });
    } else {
      // If no set was found and deleted, return a 404 Not Found response
      res.status(404).json({ message: 'Set not found' });
    }
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error deleting set:', error);
    res.status(500).json({ message: 'Error deleting set' });
  }
});

module.exports = router;
