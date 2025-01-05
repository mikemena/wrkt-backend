const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Endpoint to get the workout history for a given user, month/year

const getLastDayOfMonth = (year, month) => {
  // Month in JavaScript Date is 0-indexed (0 = January, 11 = December)
  return new Date(year, month, 0).getDate();
};

router.get('/workout-history/:user_id/:year/:month', async (req, res) => {
  const { user_id, year, month } = req.params;

  try {
    // Pad the month with a zero if it is a single digit
    const monthPadded = month.padStart(2, '0');

    // Calculate the last day of the month
    const lastDay = getLastDayOfMonth(year, monthPadded);

    // Define the start and end of the month
    const startDate = `${year}-${monthPadded}-01`;
    const endDate = `${year}-${monthPadded}-${lastDay}`;

    // Fetch workout history for the user within the specified month and year
    const { rows } = await db.query(
      'SELECT * FROM workout_history WHERE user_id = $1 AND workout_date >= $2 AND workout_date <= $3 ORDER BY workout_date',
      [user_id, startDate, endDate]
    );

    if (rows.length === 0) {
      // If no workouts are found for the given user_id, month, and year, return a 404 Not Found response
      return res
        .status(404)
        .json({ message: 'No workouts found for this period' });
    }

    // Return the workouts for the specified month and year
    res.json(rows);
  } catch (error) {
    console.error('Error fetching workouts by month:', error);
    res.status(500).json({ message: 'Error fetching workouts by month' });
  }
});

// Endpoint to create a workout in history

router.post('/create-workout', async (req, res) => {
  // Start a database transaction
  const client = await db.connect();

  try {
    // Begin transaction
    await client.query('BEGIN');

    // Insert into workout_history and get the workout_id
    const workoutRes = await client.query(
      'INSERT INTO workout_history (user_id, workout_date, workout_name, plan_type, difficulty_level, duration) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [
        /* user_id, workout_date, workout_name, plan_type, difficulty_level, duration values */
      ]
    );
    const workoutId = workoutRes.rows[0].workout_id;

    // For each exercise in the request, insert into exercise_history
    for (const exercise of req.body.exercises) {
      const exerciseRes = await client.query(
        'INSERT INTO exercise_history (workout_id, exercise_name, muscle_group_id) VALUES ($1, $2, $3) RETURNING id',
        [workoutId, exercise.name, exercise.muscle_group_id]
      );
      const exerciseId = exerciseRes.rows[0].exercise_id;

      // For each set in the exercise, insert into sets_history
      for (const set of exercise.sets) {
        await client.query(
          'INSERT INTO sets_history (exercise_id, reps, weight) VALUES ($1, $2, $3)',
          [exerciseId, set.reps, set.weight]
        );
      }
    }

    // If all inserts are successful, commit the transaction
    await client.query('COMMIT');
    res.status(201).json({ message: 'Workout created successfully' });
  } catch (error) {
    // If any error occurs, rollback the transaction
    await client.query('ROLLBACK');
    console.error('Transaction error creating workout:', error);
    res.status(500).json({ message: 'Error creating workout' });
  } finally {
    // Release the client back to the pool
    client.release();
  }
});

module.exports = router;
