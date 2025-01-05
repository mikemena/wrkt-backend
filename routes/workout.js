const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  accessKeyId: process.env.R2_ACCESS_KEY,
  secretAccessKey: process.env.R2_SECRET_KEY,
  endpoint: process.env.R2_URL,
  region: 'auto',
  signatureVersion: 'v4',
  s3ForcePathStyle: true
});

// Endpoint to get a workout by ID
router.get('/workout/:workout_id', async (req, res) => {
  const startTime = Date.now();
  const { workout_id } = req.params;

  try {
    // Validate workout_id
    const parsedId = parseInt(workout_id);
    if (!workout_id || isNaN(parsedId)) {
      console.log('Invalid workout ID:', workout_id);
      return res.status(400).json({ message: 'Invalid workout ID' });
    }

    const query = `
      SELECT
        w.id as workout_id,
        w.name as workout_name,
        e.id as exercise_id,
        e.catalog_exercise_id,
        e.order as exercise_order,
        ex.name as exercise_name,
        mg.muscle,
        mg.muscle_group,
        eq.name as equipment,
        im.file_path as image_url,
        s.id as set_id,
        s.order as set_order,
        s.reps,
        s.weight
      FROM workouts w
      JOIN exercises e ON e.workout_id = w.id
      JOIN exercise_catalog ex ON e.catalog_exercise_id = ex.id
      JOIN muscle_groups mg ON ex.muscle_group_id = mg.id
      JOIN equipment_catalog eq ON ex.equipment_id = eq.id
      LEFT JOIN sets s ON s.exercise_id = e.id
      LEFT JOIN image_metadata im ON ex.image_id = im.id
      WHERE w.id = $1
      ORDER BY e.order, s.order`;

    const workoutResult = await pool.query(query, [parsedId]);

    if (workoutResult.rows.length === 0) {
      return res.status(404).json({ message: 'Workout not found' });
    }

    // Transform the flat query results into a nested structure
    const workout = {
      id: workoutResult.rows[0].workout_id,
      name: workoutResult.rows[0].workout_name,
      exercises: []
    };

    // Use a Map to group exercises and their sets
    const exercisesMap = new Map();

    workoutResult.rows.forEach(row => {
      if (!exercisesMap.has(row.exercise_id)) {
        // Create new exercise entry
        exercisesMap.set(row.exercise_id, {
          id: row.exercise_id,
          catalog_exercise_id: row.catalog_exercise_id,
          name: row.exercise_name,
          order: row.exercise_order,
          muscle: row.muscle,
          muscleGroup: row.muscle_group,
          equipment: row.equipment,
          imageUrl: row.image_url,
          sets: []
        });
      }

      // Add set to exercise if it exists
      if (row.set_id) {
        const exercise = exercisesMap.get(row.exercise_id);
        exercise.sets.push({
          id: row.set_id,
          order: row.set_order,
          weight: row.weight,
          reps: row.reps
        });
      }
    });

    // Convert Map to array and sort exercises by order
    workout.exercises = Array.from(exercisesMap.values())
      .sort((a, b) => a.order - b.order)
      .map(exercise => {
        // Generate signed URL for each exercise image
        const signedUrl = exercise.imageUrl
          ? s3.getSignedUrl('getObject', {
              Bucket: process.env.R2_BUCKET_NAME,
              Key: exercise.imageUrl,
              Expires: 60 * 60, // URL expires in 1 hour
              ResponseContentType: 'image/gif',
              ResponseCacheControl: 'public, max-age=86400'
            })
          : null;

        return {
          ...exercise,
          sets: exercise.sets.sort((a, b) => a.order - b.order),
          imageUrl: signedUrl // Replace file_path with signed URL
        };
      });

    res.json(workout);
  } catch (error) {
    console.error('Error fetching workout details:', {
      error: error.message,
      stack: error.stack,
      workoutId: workout_id,
      timestamp: new Date().toISOString()
    });

    // Check for specific database errors
    if (error.code === '23505') {
      // Unique violation
      return res.status(409).json({
        message: 'Conflict with existing data',
        error: error.message
      });
    }

    if (error.code === '23503') {
      // Foreign key violation
      return res.status(400).json({
        message: 'Referenced data does not exist',
        error: error.message
      });
    }

    res.status(500).json({
      message: 'Server error while fetching workout details',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST route to save a completed workout
router.post('/workout/complete', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { userId, programId, name, duration, exercises } = req.body;

    // Validate required fields
    if (
      !userId ||
      !name ||
      !duration ||
      !exercises ||
      !Array.isArray(exercises)
    ) {
      return res.status(400).json({
        message: 'Missing or invalid required fields'
      });
    }

    // Insert completed workout
    const workoutResult = await client.query(
      `INSERT INTO completed_workouts
       (user_id, program_id, name, duration, is_completed, date)
       VALUES ($1, $2, $3, $4, true, CURRENT_DATE)
       RETURNING id`,
      [userId, programId || null, name, duration]
    );

    const workoutId = workoutResult.rows[0].id;

    // Insert exercises and their sets
    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];

      // First get the catalog_exercise_id from the original exercise
      // const catalogExerciseQuery = await client.query(
      //   `SELECT catalog_exercise_id
      //    FROM exercises
      //    WHERE id = $1`,
      //   [exercise.id]
      // );

      // const catalogExerciseId =
      //   catalogExerciseQuery.rows[0]?.catalog_exercise_id;

      // if (!catalogExerciseId) {
      //   throw new Error(
      //     `No catalog exercise found for exercise ID: ${exercise.id}`
      //   );
      // }

      // Insert exercise record with catalog_exercise_id
      const exerciseResult = await client.query(
        `INSERT INTO completed_exercises
         (workout_id, catalog_exercise_id, "order")
         VALUES ($1, $2, $3)
         RETURNING id`,
        [workoutId, exercise.catalogExerciseId, i + 1]
      );

      const completedExerciseId = exerciseResult.rows[0].id;

      // Insert sets into completed_sets table
      if (exercise.sets && Array.isArray(exercise.sets)) {
        for (let j = 0; j < exercise.sets.length; j++) {
          const set = exercise.sets[j];
          await client.query(
            `INSERT INTO completed_sets
             (exercise_id, weight, reps, "order")
             VALUES ($1, $2, $3, $4)`,
            [completedExerciseId, set.weight, set.reps, j + 1]
          );
        }
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Workout completed successfully',
      workoutId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving completed workout:', error);

    res.status(500).json({
      message: 'Failed to save workout',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// test endpoint to verify the route is mounted correctly
router.get('/workout/test', (req, res) => {
  res.json({ message: 'Workout route is working' });
});

module.exports = router;
