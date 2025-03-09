const express = require("express");
const router = express.Router();
const { pool } = require("../config/db");

router.get("/progress/summary/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const userId = parseInt(user_id, 10);

  try {
    // Get pre-calculated progress data
    const result = await pool.query(
      `SELECT
        workouts_this_month as "monthlyCount",
        daily_minutes as "dailyMinutes"
       FROM user_progress
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId],
    );

    // If no pre-calculated data exists, fall back to original calculation
    if (result.rows.length === 0) {
      // Your existing calculation logic here
    } else {
      // Format the response
      const dailyMinutes = result.rows[0].dailyMinutes || {};

      // Convert to your existing format
      const weeklyWorkouts = [
        "Mon",
        "Tue",
        "Wed",
        "Thu",
        "Fri",
        "Sat",
        "Sun",
      ].map((day) => ({
        day_name: day,
        minutes: dailyMinutes[day] || 0,
      }));

      res.json({
        monthlyCount: result.rows[0].monthlyCount || 0,
        weeklyWorkouts,
      });
    }
  } catch (err) {
    console.error("Progress fetch error:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
});

// get records - Epley formula to estimate one-rep max (1RM)

router.get("/progress/records/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const userId = parseInt(user_id, 10);

  try {
    // Get pre-calculated records
    const result = await pool.query(
      `SELECT
        er.catalog_exercise_id,
        ec.name,
        er.date,
        er.weight,
        er.reps,
        er.estimated_1rm
       FROM exercise_records er
       JOIN exercise_catalog ec ON er.catalog_exercise_id = ec.id
       WHERE er.user_id = $1
         AND er.is_current_record = true
         AND er.date >= date_trunc('month', CURRENT_DATE)
       ORDER BY er.estimated_1rm DESC`,
      [userId],
    );

    res.json({
      records: result.rows,
    });
  } catch (err) {
    console.error("Records fetch error:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
});

module.exports = router;
