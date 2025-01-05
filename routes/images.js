const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/db');
const fs = require('fs');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './images/');
  },
  filename: function (req, file, cb) {
    cb(
      null,
      new Date().toISOString().replace(/:/g, '-') + '-' + file.originalname
    );
  }
});

const upload = multer({ storage: storage });

// Endpoint for uploading an image and adding metadata

router.post('/images', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image was uploaded.');
  }

  const { description, category, status } = req.body;
  // const imageStatus = req.body.status;

  try {
    // metadata from the uploaded file
    const { path, filename, mimetype, size } = req.file;

    // Insert metadata into the 'image_metadata' table
    // Assuming 'upload_date' can be set to the current timestamp in PostgreSQL
    // 'checksum' is not directly available from req.file; you would need additional logic to calculate it

    const { rows } = await db.query(
      'INSERT INTO image_metadata (description, status, file_path, image_name, content_type, file_size, category, upload_date) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING *',
      [description, status, path, filename, mimetype, size, category]
    );

    res.json({
      message: 'Image uploaded successfully',
      file: {
        description: description,
        status: status,
        path,
        filename,
        mimetype,
        size,
        category: category
      },
      metadata: rows[0]
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).send('Error uploading image');
  }
});

// Endpoint to get all images

router.get('/images', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM image_metadata');
    res.json(rows);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Endpoint to get one image and its metadata by ID
router.get('/images/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    const { rows } = await db.query(
      'SELECT * FROM image_metadata WHERE id = $1',
      [id]
    );

    if (rows.length === 0) {
      // If no image metadata is found with the given ID, return a 404 Not Found response
      return res.status(404).json({ message: 'Image metadata not found' });
    }

    // If image metadata is found, return it in the response
    res.json(rows[0]);
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error fetching image metadata:', error);
    res.status(500).json({ message: 'Error fetching image metadata' });
  }
});

// Endpoint for deleting an image metadata entry by ID

router.delete('/images/:id', async (req, res) => {
  const { id } = req.params; // Extract the ID from the route parameters

  try {
    // First, retrieve the file path of the image to delete

    const result = await db.query(
      'SELECT file_path FROM image_metadata WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      // If no record was found, return a 404 Not Found response

      return res.status(404).json({ message: 'Image metadata not found' });
    }

    const filePath = result.rows[0].file_path;

    // Delete the image metadata record from the database

    const { rowCount } = await db.query(
      'DELETE FROM image_metadata WHERE id = $1',
      [id]
    );

    if (rowCount > 0) {
      // If the database record was successfully deleted, also delete the file from the filesystem

      fs.unlink(path.join(__dirname, '..', filePath), err => {
        if (err) {
          console.error('Error deleting image file:', err);
          // Optionally, you could choose to send a 500 error here or just log the error
        }
      });
    }

    // Respond that the image metadata (and optionally the file) was successfully deleted
    res.status(200).json({ message: 'Image metadata deleted successfully' });
  } catch (error) {
    // Log the error and return a 500 Internal Server Error response if an error occurs
    console.error('Error deleting image metadata:', error);
    res.status(500).json({ message: 'Error deleting image metadata' });
  }
});

module.exports = router;
