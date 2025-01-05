const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

const AWS = require('aws-sdk');
require('dotenv').config();

const s3 = new AWS.S3({
  accessKeyId: process.env.R2_ACCESS_KEY,
  secretAccessKey: process.env.R2_SECRET_KEY,
  endpoint: process.env.R2_URL,
  region: 'auto',
  signatureVersion: 'v4',
  s3ForcePathStyle: true
});

// Get active program for a user
router.get('/active-program/user/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    // The initial program query remains the same
    const result = await pool.query(
      `SELECT ap.*, p.name, p.main_goal, p.program_duration, p.duration_unit, p.days_per_week
       FROM active_programs ap
       JOIN programs p ON ap.program_id = p.id
       WHERE ap.user_id = $1 AND ap.is_active = TRUE
       ORDER BY ap.start_date DESC
       LIMIT 1`,
      [userId]
    );

    if (!result?.rows || result.rows.length === 0) {
      return res.status(200).json({ activeProgram: null });
    }

    const activeProgram = result.rows[0];
    const programId = activeProgram.program_id;

    // Workouts query remains the same
    const workoutsResult = await pool.query(
      'SELECT * FROM workouts WHERE program_id = $1',
      [programId]
    );

    activeProgram.workouts = workoutsResult.rows;

    // Process each workout and its exercises
    for (const workout of workoutsResult.rows) {
      // Fixed the SQL query by adding a space before WHERE
      const exercisesResult = await pool.query(
        'SELECT e.*, ex.name as name, mg.muscle, mg.muscle_group, mg.subcategory, eq.name as equipment, im.file_path ' +
          'FROM exercises e ' +
          'JOIN exercise_catalog ex ON e.catalog_exercise_id = ex.id ' +
          'JOIN muscle_groups mg ON ex.muscle_group_id = mg.id ' +
          'JOIN equipment_catalog eq ON ex.equipment_id = eq.id ' +
          'JOIN image_metadata im ON ex.image_id = im.id ' +
          'WHERE e.workout_id = $1',
        [workout.id]
      );

      workout.exercises = [];

      // Process each exercise and generate signed URLs for images
      for (const exercise of exercisesResult.rows) {
        const setsResult = await pool.query(
          'SELECT * FROM sets WHERE exercise_id = $1',
          [exercise.id]
        );

        // Generate signed URL for the exercise image
        const params = {
          Bucket: process.env.R2_BUCKET_NAME,
          Key: exercise.file_path,
          Expires: 3600, // 1 hour expiration
          ResponseContentType: 'image/gif',
          ResponseCacheControl:
            'public, max-age=86400, stale-while-revalidate=3600'
        };

        const imageUrl = s3.getSignedUrl('getObject', params);

        // Add the exercise to the workout with the signed URL
        workout.exercises.push({
          ...exercise,
          sets: setsResult.rows,
          imageUrl: imageUrl,
          // Remove the raw file_path as it's not needed in the response
          file_path: undefined
        });
      }
    }

    // Set cache headers for the response
    res.set({
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=1800',
      ETag: require('crypto')
        .createHash('md5')
        .update(JSON.stringify(activeProgram))
        .digest('hex')
    });

    res.json({ activeProgram });
  } catch (error) {
    console.error(
      'Backend active_programs.js Error fetching active program:',
      error
    );
    res.status(500).json({
      error: 'Failed to fetch active program',
      details: error.message
    });
  }
});

// Backend: active_program.js
router.post('/active-program', async (req, res) => {
  const { user_id, program_id } = req.body;

  // Validate required fields
  if (!user_id || !program_id) {
    return res.status(400).json({
      error: 'Missing required fields',
      details: 'Both userId and programId are required'
    });
  }

  try {
    // Start a transaction
    await pool.query('BEGIN');

    // First check if program exists
    const programExists = await pool.query(
      'SELECT id, program_duration, duration_unit FROM programs WHERE id = $1',
      [program_id]
    );

    if (programExists.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({
        error: 'Program not found',
        details: `Program with id ${program_id} not found`
      });
    }

    const { program_duration, duration_unit } = programExists.rows[0];

    const startDate = new Date();
    let endDate = new Date(startDate);

    switch (duration_unit) {
      case 'weeks':
        endDate.setDate(endDate.getDate() + program_duration * 7);
        break;
      case 'months':
        endDate.setMonth(endDate.getMonth() + program_duration);
        break;
      default: // days
        endDate.setDate(endDate.getDate() + program_duration);
    }

    // Deactivate current active program if exists
    await pool.query(
      'UPDATE active_programs SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE',
      [user_id]
    );

    // Insert new active program
    const result = await pool.query(
      `INSERT INTO active_programs
       (user_id, program_id, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING *`,
      [user_id, program_id, startDate, endDate]
    );

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Program activated successfully',
      activeProgram: result.rows[0]
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error activating program:', error);
    res.status(500).json({
      error: 'Failed to save active program',
      details: error.message
    });
  }
});

// delete active program for a user
router.delete('/active-program/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    await pool.query('BEGIN');

    const result = await pool.query(
      'DELETE FROM active_programs WHERE user_id = $1 AND is_active = TRUE RETURNING *',
      [userId]
    );

    await pool.query('COMMIT');

    if (result.rows.length === 0) {
      console.log('No active program found to delete');
      return res.status(200).json({
        message: 'No active program to delete',
        deactivatedProgram: null
      });
    }

    res.json({
      message: 'Active program deleted successfully',
      deactivatedProgram: result.rows[0]
    });
  } catch (error) {
    console.error('Detailed deletion error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      userId: userId
    });

    await pool.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to deactivate program',
      details: error.message
    });
  }
});

module.exports = router;
