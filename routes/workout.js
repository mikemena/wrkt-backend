const express = require("express");
const router = express.Router();
const { pool } = require("../config/db");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Add helper function for generating signed URLs
const getPresignedUrl = async (bucket, key) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: "image/gif",
    ResponseCacheControl: "public, max-age=86400, stale-while-revalidate=43200",
  });

  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

// Endpoint to get a workout by ID
router.get("/workout/:workout_id", async (req, res) => {
  const startTime = Date.now();
  const { workout_id } = req.params;

  try {
    // Validate workout_id
    const parsedId = parseInt(workout_id);
    if (!workout_id || isNaN(parsedId)) {
      console.log("Invalid workout ID:", workout_id);
      return res.status(400).json({ message: "Invalid workout ID" });
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
      return res.status(404).json({ message: "Workout not found" });
    }

    // Transform the flat query results into a nested structure
    const workout = {
      id: workoutResult.rows[0].workout_id,
      name: workoutResult.rows[0].workout_name,
      exercises: [],
    };

    // Use a Map to group exercises and their sets
    const exercisesMap = new Map();

    workoutResult.rows.forEach((row) => {
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
          sets: [],
        });
      }

      // Add set to exercise if it exists
      if (row.set_id) {
        const exercise = exercisesMap.get(row.exercise_id);
        exercise.sets.push({
          id: row.set_id,
          order: row.set_order,
          weight: row.weight,
          reps: row.reps,
        });
      }
    });

    // Convert Map to array and sort exercises by order
    workout.exercises = await Promise.all(
      Array.from(exercisesMap.values())
        .sort((a, b) => a.order - b.order)
        .map(async (exercise) => {
          // Generate signed URL for each exercise image using new method
          const signedUrl = exercise.imageUrl
            ? await getPresignedUrl(
                process.env.R2_BUCKET_NAME,
                exercise.imageUrl,
              )
            : null;

          return {
            ...exercise,
            sets: exercise.sets.sort((a, b) => a.order - b.order),
            imageUrl: signedUrl,
          };
        }),
    );

    res.json(workout);
  } catch (error) {
    console.error("Error fetching workout details:", {
      error: error.message,
      stack: error.stack,
      workoutId: workout_id,
      timestamp: new Date().toISOString(),
    });

    // Check for specific database errors
    if (error.code === "23505") {
      // Unique violation
      return res.status(409).json({
        message: "Conflict with existing data",
        error: error.message,
      });
    }

    if (error.code === "23503") {
      // Foreign key violation
      return res.status(400).json({
        message: "Referenced data does not exist",
        error: error.message,
      });
    }

    res.status(500).json({
      message: "Server error while fetching workout details",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// POST route to save a completed workout
router.post("/workout/complete", async (req, res) => {
  console.log("req", req);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { userId, programId, name, duration, exercises } = req.body;
    console.log("userId", userId);

    // Validate required fields
    if (
      !userId ||
      !name ||
      !duration ||
      !exercises ||
      !Array.isArray(exercises)
    ) {
      return res.status(400).json({
        message: "Missing or invalid required fields",
      });
    }

    // Insert completed workout
    const workoutResult = await client.query(
      `INSERT INTO completed_workouts
       (user_id, program_id, name, duration, is_completed, date)
       VALUES ($1, $2, $3, $4, true, CURRENT_DATE)
       RETURNING id`,
      [userId, programId || null, name, duration],
    );

    const workoutId = workoutResult.rows[0].id;

    // Insert exercises and their sets
    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];

      // Insert exercise record with catalog_exercise_id
      const exerciseResult = await client.query(
        `INSERT INTO completed_exercises
         (workout_id, catalog_exercise_id, "order")
         VALUES ($1, $2, $3)
         RETURNING id`,
        [workoutId, exercise.catalogExerciseId, i + 1],
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
            [completedExerciseId, set.weight, set.reps, j + 1],
          );
        }
      }
    }

    await client.query(
      `INSERT INTO user_progress (user_id, date, workouts_this_month, workouts_this_week, last_updated)
       VALUES ($1, CURRENT_DATE,
         (SELECT COUNT(*) FROM completed_workouts
          WHERE user_id = $1
          AND date >= date_trunc('month', CURRENT_DATE)
          AND date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'),
         (SELECT COUNT(*) FROM completed_workouts
          WHERE user_id = $1
          AND date >= date_trunc('week', CURRENT_DATE)
          AND date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')
       )
       ON CONFLICT (user_id, date)
       DO UPDATE SET
         workouts_this_month = EXCLUDED.workouts_this_month,
         workouts_this_week = EXCLUDED.workouts_this_week,
         last_updated = NOW()`,
      [userId],
    );

    // Update daily minutes JSON
    await client.query(
      `WITH daily_minutes AS (
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
       UPDATE user_progress
       SET daily_minutes = (
         SELECT json_object_agg(to_char(workout_date, 'Dy'), total_minutes)
         FROM daily_minutes
       )
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId],
    );

    // Calculate and update exercise records
    await client.query(
      `WITH new_records AS (
         SELECT
           e.catalog_exercise_id,
           w.date,
           s.weight,
           s.reps,
           s.weight * (1 + s.reps/30.0) as estimated_1rm
         FROM completed_exercises e
         JOIN completed_sets s ON e.id = s.exercise_id
         JOIN completed_workouts w ON w.id = e.workout_id
         WHERE w.id = $1
       ),
       current_records AS (
         SELECT
           catalog_exercise_id,
           MAX(estimated_1rm) as max_1rm
         FROM exercise_records
         WHERE user_id = $2 AND is_current_record = true
         GROUP BY catalog_exercise_id
       )
       INSERT INTO exercise_records (
         user_id, catalog_exercise_id, date, weight, reps, estimated_1rm, is_current_record
       )
       SELECT
         $2, nr.catalog_exercise_id, nr.date, nr.weight, nr.reps, nr.estimated_1rm, true
       FROM new_records nr
       LEFT JOIN current_records cr ON nr.catalog_exercise_id = cr.catalog_exercise_id
       WHERE cr.max_1rm IS NULL OR nr.estimated_1rm > cr.max_1rm`,
      [workoutId, userId],
    );

    // Set old records for this exercise to not current

    await client.query(
      `WITH new_records AS (
         SELECT catalog_exercise_id
         FROM exercise_records
         WHERE user_id = $1 AND date = CURRENT_DATE AND is_current_record = true
       )
       UPDATE exercise_records
       SET is_current_record = false
       WHERE user_id = $1
         AND catalog_exercise_id IN (SELECT catalog_exercise_id FROM new_records)
         AND date < CURRENT_DATE
         AND is_current_record = true`,
      [userId],
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Workout completed successfully",
      workoutId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error saving completed workout:", error);

    res.status(500).json({
      message: "Failed to save workout",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

router.get("/workout/test", (req, res) => {
  res.json({ message: "Workout route is working" });
});

module.exports = router;
