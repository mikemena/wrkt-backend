const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Endpoint to get all exercises

router.get('/exercises', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM exercises');
    res.json(rows);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// GET a specific exercise by ID

router.get('/exercises/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    // Query to fetch the exercise with the specified ID
    const { rows } = await db.query('SELECT * FROM exercises WHERE id = $1', [
      parseInt(id)
    ]);

    if (rows.length === 0) {
      // If no exercise is found with the given ID, return a 404 Not Found response
      return res.status(404).json({ message: 'Exercise not found' });
    }

    // If a exercise is found, return it in the response
    res.json(rows[0]);
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error fetching exercise:', error);
    res.status(500).json({ message: 'Error fetching exercise' });
  }
});

// Endpoint to create a exercise

router.post('/exercises', async (req, res) => {
  try {
    const { workout_id, catalog_exercise_id, order } = req.body;
    const { rows } = await db.query(
      'INSERT INTO exercises (workout_id, catalog_exercise_id, order) VALUES ($1, $2, $3) RETURNING *',
      [workout_id, catalog_exercise_id, order]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Endpoint to modify a exercise

router.put('/exercises/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { workout_id, catalog_exercise_id, order } = req.body;

    // Construct the update part of the query based on provided fields
    const updateParts = [];
    const queryValues = [];
    let queryIndex = 1;

    if (workout_id !== undefined) {
      updateParts.push(`workout_id = $${queryIndex++}`);
      queryValues.push(workout_id);
    }

    if (catalog_exercise_id !== undefined) {
      updateParts.push(`catalog_exercise_id = $${queryIndex++}`);
      queryValues.push(catalog_exercise_id);
    }

    if (order !== undefined) {
      updateParts.push(`order = $${queryIndex++}`);
      queryValues.push(order);
    }

    queryValues.push(id); // For the WHERE condition
    if (updateParts.length === 0) {
      return res.status(400).send('No update fields provided.');
    }

    const queryString = `UPDATE exercises SET ${updateParts.join(
      ', '
    )} WHERE id = $${queryIndex} RETURNING *`;

    const { rows } = await db.query(queryString, queryValues);

    if (rows.length === 0) {
      return res.status(404).send('Exercise not found.');
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Endpoint to delete an exercise

router.delete('/exercises/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    const { rowCount } = await db.query('DELETE FROM exercises WHERE id = $1', [
      id
    ]);

    if (rowCount > 0) {
      res.status(200).json({ message: 'Exercise deleted successfully' });
    } else {
      // If no exercise was found and deleted, return a 404 Not Found response
      res.status(404).json({ message: 'Exercise not found' });
    }
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error deleting exercise:', error);
    res.status(500).json({ message: 'Error deleting exercise' });
  }
});

module.exports = router;
