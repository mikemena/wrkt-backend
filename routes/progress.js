const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

router.get('/progress/summary/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const userId = parseInt(user_id, 10);

  try {
    // Get both monthly count and weekly data in parallel
    const [monthlyResult, weeklyResult] = await Promise.all([
      // Monthly workouts query
      pool.query(
        `SELECT COUNT(id) as count
         FROM public.completed_workouts
         WHERE date >= date_trunc('month', CURRENT_DATE)
         AND date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         AND user_id = $1`,
        [userId]
      ),

      // Weekly workouts query
      pool.query(
        `WITH RECURSIVE dates AS (
          SELECT date_trunc('week', CURRENT_DATE) as date
          UNION ALL
          SELECT date + interval '1 day'
          FROM dates
          WHERE date < date_trunc('week', CURRENT_DATE) + interval '6 days'
        ),
        daily_minutes AS (
          SELECT
            date_trunc('day', date) as workout_date,
            COALESCE(SUM(duration), 0) as total_minutes
          FROM completed_workouts
          WHERE
            user_id = $1
            AND is_completed = true
            AND date >= date_trunc('week', CURRENT_DATE)
            AND date < date_trunc('week', CURRENT_DATE) + interval '7 days'
          GROUP BY date_trunc('day', date)
        )
        SELECT
          dates.date as day,
          to_char(dates.date, 'Dy') as day_name,
          COALESCE(daily_minutes.total_minutes, 0) as minutes
        FROM dates
        LEFT JOIN daily_minutes ON date_trunc('day', dates.date) = daily_minutes.workout_date
        ORDER BY dates.date`,
        [userId]
      )
    ]);

    // Combine the results
    const response = {
      monthlyCount: parseInt(monthlyResult.rows[0].count) || 0,
      weeklyWorkouts:
        weeklyResult.rows.length > 0
          ? weeklyResult.rows
          : Array(7).fill({ minutes: 0 })
    };

    res.json(response);
  } catch (err) {
    console.error('Progress fetch error:', err);
    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
});

// get records - Epley formula to estimate one-rep max (1RM)

router.get('/progress/records/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const userId = parseInt(user_id, 10);

  try {
    const result = await pool.query(
      `WITH max_lifts AS (
          SELECT
            e.catalog_exercise_id,
            ec.name,
            w.date,
            s.weight,
            s.reps,
            -- Epley formula: weight * (1 + reps/30)
            s.weight * (1 + s.reps/30.0) as estimated_1rm,
            ROW_NUMBER() OVER (
              PARTITION BY e.catalog_exercise_id
              ORDER BY (s.weight * (1 + s.reps/30.0)) DESC
            ) as rank
          FROM completed_exercises e
          JOIN completed_workouts w ON w.id = e.workout_id
          JOIN completed_sets s ON e.id = s.exercise_id
          JOIN exercise_catalog ec ON e.catalog_exercise_id = ec.id
          WHERE
            w.user_id = $1
            AND w.date >= date_trunc('month', CURRENT_DATE)
        )
        SELECT
          catalog_exercise_id,
          name,
          date,
          weight,
          reps,
          estimated_1rm
        FROM max_lifts
        WHERE rank = 1
        ORDER BY estimated_1rm DESC;`,
      [userId]
    );

    res.json({
      records: result.rows
    });
  } catch (err) {
    console.error('Progress fetch error:', err);
    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
});

module.exports = router;
