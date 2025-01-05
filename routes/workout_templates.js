const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// Endpoint to get all workouts for given user

router.get('/workout-templates/:program_id', async (req, res) => {
  const { program_id } = req.params;

  try {
    const workouts = await pool.query(
      'SELECT * FROM workouts WHERE program_id = $1',
      [parseInt(program_id)]
    );

    if (workouts.rows.length === 0)
      return res.status(404).json({ message: 'No workout templates found' });

    for (const workout of workouts.rows) {
      const exercises = await pool.query(
        'select e.exercise_id, e.catalog_exercise_id, ec.name as exercise_name,e.workout_id, w.name as workout_name FROM workouts w LEFT JOIN exercises e on w.workout_id = e.workout_id LEFT JOIN exercise_catalog ec on ue.catalog_exercise_id = ec.exercise_id WHERE workout_id = $1',
        [workout.workout_id]
      );

      // Log after fetching exercises for a workout

      workout.exercises = exercises.rows.map(e => ({
        exercise_id: e.exercise_id,
        exercise_name: e.exercise_name,
        catalog_exercise_id: e.catalog_exercise_id
      }));
      // Log after modifying the workout object
    }

    res.json(workouts.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// POST endpoint to create a workout with selected exercises

router.post('/workout-templates', async (req, res) => {
  const { name, program_id } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const workout = await client.query(
      'INSERT INTO workouts (name, program_id) VALUES ($1, $2) RETURNING *',
      [name, program_id]
    );

    const workoutId = workout.rows[0].workout_id;

    for (const { exercise_id } of exercises) {
      await client.query(
        'INSERT INTO exercises (workout_id, catalog_exercise_id, order) VALUES ($1, $2, $3)',
        [workoutId, exercise_id, order]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(workout.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Server error');
  } finally {
    client.release();
  }
});

// DELETE endpoint to remove a workout template

router.delete('/workout-templates/:template_id', async (req, res) => {
  const { template_id } = req.params;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Remove associated exercises
    if (!template_id) {
      return res.status(400).send('No template ID provided');
    }
    await client.query('DELETE FROM exercises WHERE workout_id = $1', [
      template_id
    ]);

    // Remove the workout template
    await client.query('DELETE FROM workouts WHERE workout_id = $1', [
      template_id
    ]);

    await client.query('COMMIT');
    res.status(204).send('Workout template removed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Server error');
  } finally {
    client.release();
  }
});

// PUT endpoint to update a workout template
router.put('/workout-templates/:template_id', async (req, res) => {
  const { template_id } = req.params;
  const { name, program_id } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update the workout template details

    await client.query(
      'UPDATE workouts SET name = $1, program_id = $2 WHERE workout_id = $5',
      [workout_name, duration_unit, plan_type, difficulty_level, template_id]
    );

    // Remove all existing exercise associations

    await client.query('DELETE FROM exercises WHERE workout_id = $1', [
      template_id
    ]);

    // Insert new exercise associations

    for (const exerciseId of exercises) {
      await client.query(
        'INSERT INTO exercises (workout_id, catalog_exercise_id) VALUES ($1, $2)',
        [template_id, exerciseId]
      );
    }

    await client.query('COMMIT');
    res.status(200).send('Workout template updated successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Server error');
  } finally {
    client.release();
  }
});

module.exports = router;
