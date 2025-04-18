const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require("dotenv").config();

// Set up AWS S3 to interact with Cloudflare R2

const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Helper function for generating signed URLs

const getPresignedUrl = async (bucket, key) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: "image/gif",
    ResponseCacheControl: "public, max-age=86400, stale-while-revalidate=43200",
  });

  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

// Endpoint to get all exercises in the catalog

router.get("/exercise-catalog", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const name = req.query.name;
    const muscles = req.query["muscles[]"] || req.query.muscles;
    const equipment = req.query["equipment[]"] || req.query.equipment;

    // Build WHERE clause dynamically
    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    if (name) {
      whereConditions.push(`LOWER(ec.name) LIKE $${paramIndex}`);
      queryParams.push(`%${name.toLowerCase()}%`);
      paramIndex++;
    }

    if (muscles) {
      // Handle array of muscles
      if (Array.isArray(muscles)) {
        const muscleParams = muscles
          .map((_, idx) => `$${paramIndex + idx}`)
          .join(",");
        whereConditions.push(`LOWER(mg.muscle) IN (${muscleParams})`);
        queryParams.push(...muscles.map((m) => m.toLowerCase()));
        paramIndex += muscles.length;
      } else {
        // Handle single muscle
        whereConditions.push(`LOWER(mg.muscle) = LOWER($${paramIndex})`);
        queryParams.push(muscles);
        paramIndex++;
      }
    }

    if (equipment) {
      // Handle array of equipment
      if (Array.isArray(equipment)) {
        const equipmentParams = equipment
          .map((_, idx) => `$${paramIndex + idx}`)
          .join(",");
        whereConditions.push(`LOWER(eq.name) IN (${equipmentParams})`);
        queryParams.push(...equipment.map((e) => e.toLowerCase()));
        paramIndex += equipment.length;
      } else {
        // Handle single equipment
        whereConditions.push(`LOWER(eq.name) = LOWER($${paramIndex})`);
        queryParams.push(equipment);
        paramIndex++;
      }
    }

    const whereClause =
      whereConditions.length > 0
        ? "WHERE " + whereConditions.join(" AND ")
        : "";

    // Get filtered count
    const countQuery = `
    SELECT COUNT(*)
    FROM exercise_catalog ec
    JOIN muscle_groups mg ON ec.muscle_group_id = mg.id
    JOIN equipment_catalog eq ON ec.equipment_id = eq.id
    ${whereClause}`;

    const {
      rows: [{ count }],
    } = await db.query(countQuery, queryParams);

    // Main query with filters
    const query = `
      SELECT
        ec.id,
        ec.name,
        mg.muscle,
        mg.muscle_group,
        mg.subcategory,
        eq.name as equipment,
        im.file_path
      FROM exercise_catalog ec
      JOIN muscle_groups mg ON ec.muscle_group_id = mg.id
      JOIN equipment_catalog eq ON ec.equipment_id = eq.id
      JOIN image_metadata im ON ec.image_id = im.id
      ${whereClause}
      ORDER BY ec.id
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

    const { rows } = await db.query(query, [...queryParams, limit, offset]);

    // Generate presigned URLs with longer expiration for caching
    // Generate presigned URLs with longer expiration for caching
    const resultsWithSignedUrl = await Promise.all(
      rows.map(async (row) => {
        const signedUrl = await getPresignedUrl(
          process.env.R2_BUCKET_NAME,
          row.file_path,
        );

        return {
          id: row.id,
          name: row.name,
          muscle: row.muscle,
          muscle_group: row.muscle_group,
          subcategory: row.subcategory,
          equipment: row.equipment,
          imageUrl: signedUrl,
        };
      }),
    );

    // Set cache headers
    res.set({
      "Cache-Control":
        "public, max-age=86400, stale-while-revalidate=3600, stale-if-error=86400",
      ETag: require("crypto")
        .createHash("md5")
        .update(JSON.stringify(resultsWithSignedUrl))
        .digest("hex"),
    });

    // Return paginated results with metadata
    res.json({
      exercises: resultsWithSignedUrl,
      pagination: {
        total: parseInt(count),
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        hasMore: offset + rows.length < count,
      },
    });
  } catch (error) {
    console.error("Error loading exercises:", error);
    res.status(500).send(error.message);
  }
});

// Get image URL for an exercise by ID
router.get("/exercise-catalog/:id/image", async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT im.file_path
      FROM exercise_catalog ec
      JOIN image_metadata im ON ec.image_id = im.id
      WHERE ec.id = $1
    `;

    const { rows } = await db.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Image not found" });
    }

    const params = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: rows[0].file_path,
      Expires: 3600, // 1 hour
      ResponseContentType: "image/gif",
      ResponseCacheControl:
        "public, max-age=86400, stale-while-revalidate=3600",
    };

    const signedUrl = await getPresignedUrl(
      process.env.R2_BUCKET_NAME,
      rows[0].file_path,
    );
    res.json({ imageUrl: signedUrl });
  } catch (error) {
    console.error("Error generating image URL:", error);
    res.status(500).json({ message: "Error generating image URL" });
  }
});

// Endpoint to get a specific exercise from the catalog by ID

router.get("/exercise-catalog/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const exerciseQuery = `
      SELECT
        ec.id,
        ec.name,
        mg.muscle,
        mg.muscle_group,
        mg.subcategory,
        eq.name as equipment,
        im.file_path
      FROM exercise_catalog ec
      JOIN muscle_groups mg ON ec.muscle_group_id = mg.id
      JOIN equipment_catalog eq ON ec.equipment_id = eq.id
      JOIN image_metadata im ON ec.image_id = im.id
      WHERE ec.id = $1`;

    const { rows } = await db.query(exerciseQuery, [parseInt(id)]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Exercise not found" });
    }

    // Add signed URL
    const signedUrl = await getPresignedUrl(
      process.env.R2_BUCKET_NAME,
      rows[0].file_path,
    );

    // Return cleaned up object without file_path
    const result = {
      id: rows[0].id,
      name: rows[0].name,
      muscle: rows[0].muscle,
      muscle_group: rows[0].muscle_group,
      subcategory: rows[0].subcategory,
      equipment: rows[0].equipment,
      imageUrl: signedUrl,
    };

    res.json(result);
  } catch (error) {
    console.error("Error fetching exercise:", error);
    res.status(500).json({ message: "Error fetching exercise" });
  }
});

// Endpoint to get exercises by specific muscle id

router.get("/exercise-catalog/muscles/:muscleId", async (req, res) => {
  try {
    const { muscleId } = req.params;
    const query = `
    SELECT ec.id, ec.name, ec.muscle_group_id, mg.muscle, mg.muscle_group, mg.subcategory, ec.equipment_id, eq.name as equipment, im.file_path
    FROM exercise_catalog ec
    JOIN muscle_groups mg ON ec.muscle_group_id = mg.id
    JOIN equipment_catalog eq ON ec.equipment_id = eq.id
    JOIN image_metadata im ON ec.image_id = im.id
    WHERE ec.muscle_group_id = $1;
    `;
    const { rows } = await db.query(query, [muscleId]);

    // Generate signed URLs for all results
    const resultsWithSignedUrls = await Promise.all(
      rows.map(async (row) => {
        const signedUrl = await getPresignedUrl(
          process.env.R2_BUCKET_NAME,
          row.file_path,
        );

        const { file_path, ...rest } = row;
        return {
          ...rest,
          imageUrl: signedUrl,
        };
      }),
    );
    res.json(resultsWithSignedUrls);
  } catch (error) {
    console.error("Error fetching exercises by muscle:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Endpoint to get exercises by specific equipment id

router.get("/exercise-catalog/equipments/:equipmentId", async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const query = `
    SELECT ec.id, ec.name, ec.muscle_group_id, mg.muscle, mg.muscle_group, mg.subcategory, ec.equipment_id, eq.name as equipment, im.file_path
    FROM exercise_catalog ec
    JOIN muscle_groups mg ON ec.muscle_group_id = mg.id
    JOIN equipment_catalog eq ON ec.equipment_id = eq.id
    JOIN image_metadata im ON ec.image_id = im.id
    WHERE ec.equipment_id = $1;
    `;
    const { rows } = await db.query(query, [equipmentId]);

    // Generate signed URLs for all results
    const resultsWithSignedUrls = await Promise.all(
      rows.map(async (row) => {
        const signedUrl = await getPresignedUrl(
          process.env.R2_BUCKET_NAME,
          row.file_path,
        );

        const { file_path, ...rest } = row;
        return {
          ...rest,
          imageUrl: signedUrl,
        };
      }),
    );

    res.json(resultsWithSignedUrls);
  } catch (error) {
    console.error("Error fetching exercises by equipment:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Endpoint to create an exercise

router.post("/exercise-catalog", async (req, res) => {
  try {
    const { name } = req.body;
    const { muscle_id } = req.body;
    const { equipment_id } = req.body;
    const { image_id } = req.body;
    const { rows } = await db.query(
      "INSERT INTO exercise_catalog (name, muscle_group_id, equipment_id, image_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, muscle_id, equipment_id, image_id],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Endpoint to update an exercise

router.put("/exercise-catalog/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, muscle_group_id, equipment_id, image_id } = req.body;

    // Construct the update part of the query based on provided fields

    const updateParts = [];
    const queryValues = [];
    let queryIndex = 1;

    if (name !== undefined) {
      updateParts.push(`name = $${queryIndex++}`);
      queryValues.push(name);
    }

    if (muscle_group_id !== undefined) {
      updateParts.push(`muscle_group_id = $${queryIndex++}`);
      queryValues.push(muscle_group_id);
    }

    if (equipment_id !== undefined) {
      updateParts.push(`equipment_id = $${queryIndex++}`);
      queryValues.push(equipment_id);
    }
    if (image_id !== undefined) {
      updateParts.push(`image_id = $${queryIndex++}`);
      queryValues.push(image_id);
    }

    queryValues.push(id); // For the WHERE condition

    if (updateParts.length === 0) {
      return res.status(400).send("No update fields provided.");
    }

    const queryString = `UPDATE exercise_catalog SET ${updateParts.join(
      ", ",
    )} WHERE id = $${queryIndex} RETURNING *`;

    const { rows } = await db.query(queryString, queryValues);

    if (rows.length === 0) {
      return res.status(404).send("Exercise not found.");
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Delete exercise

router.delete("/exercise-catalog/:id", async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    const { rowCount } = await db.query(
      "DELETE FROM exercise_catalog WHERE id = $1",
      [id],
    );

    if (rowCount > 0) {
      res.status(200).json({ message: "Exercise deleted successfully" });
    } else {
      // If no muscle was found and deleted, return a 404 Not Found response
      res.status(404).json({ message: "Exercise not found" });
    }
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error("Error deleting exercise:", error);
    res.status(500).json({ message: "Error deleting exercise" });
  }
});

module.exports = router;
