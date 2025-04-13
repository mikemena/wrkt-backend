const express = require('express');
const router = express.Router();
const db = require('../config/db');
require('dotenv').config();

// Get equipment for a specific user
router.get('/users/:userId/equipment', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`GET equipment request for user ${userId}`);

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if the user exists
    const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [
      userId
    ]);
    if (userCheck.rows.length === 0) {
      console.log(`User ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Get the equipment for this user
    const userEquipmentQuery = await db.query(
      `SELECT e.name
       FROM equipment_catalog e
       JOIN user_equipment ue ON e.id = ue.equipment_id
       WHERE ue.user_id = $1
       ORDER BY e.name`,
      [userId]
    );

    // Extract just the equipment names for the client
    const equipmentNames = userEquipmentQuery.rows.map(item => item.name);

    console.log(
      `Found ${equipmentNames.length} equipment items for user ${userId}`
    );
    res.json({ equipment: equipmentNames });
  } catch (error) {
    console.error('Error fetching user equipment:', error);
    res.status(500).json({ error: 'Failed to fetch user equipment' });
  }
});

// Update user equipment (handles add, remove, and update in one call)
router.put('/users/:userId/equipment', async (req, res) => {
  try {
    console.log('PUT /users/:userId/equipment route hit');
    console.log('Request body:', req.body);

    const { userId } = req.params;
    const { equipment } = req.body;

    console.log(`PUT equipment request for user ${userId}`);
    console.log('Equipment data received:', JSON.stringify(equipment));

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if the user exists
    const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [
      userId
    ]);
    if (userCheck.rows.length === 0) {
      console.log(`User ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }

    if (!equipment || !Array.isArray(equipment)) {
      console.log(`Invalid equipment data format: ${JSON.stringify(req.body)}`);
      return res
        .status(400)
        .json({ error: 'Equipment must be provided as an array' });
    }

    // Start a transaction
    await db.query('BEGIN');

    try {
      // Step 1: Delete all current equipment associations for this user
      console.log(`Deleting existing equipment for user ${userId}`);
      const deleteResult = await db.query(
        'DELETE FROM user_equipment WHERE user_id = $1',
        [userId]
      );
      console.log(
        `Deleted ${deleteResult.rowCount} existing equipment associations`
      );

      // Step 2: Insert the new equipment selections
      let insertedCount = 0;
      if (equipment.length > 0) {
        // Get all equipment to map names to IDs
        console.log(`Fetching equipment IDs for: ${equipment.join(', ')}`);
        const equipmentRecords = await db.query(
          'SELECT id, name FROM equipment_catalog WHERE name = ANY($1)',
          [equipment]
        );
        console.log(
          `Found ${equipmentRecords.rowCount} matching equipment records in catalog`
        );

        if (equipmentRecords.rowCount === 0) {
          console.warn(
            'No matching equipment found in database for the provided names'
          );
        }

        // Create a map of equipment names to IDs
        const equipmentMap = {};
        equipmentRecords.rows.forEach(item => {
          equipmentMap[item.name] = item.id;
        });

        // Insert each equipment selection
        for (const equipmentName of equipment) {
          const equipmentId = equipmentMap[equipmentName];

          // Skip if equipment name doesn't exist in our database
          if (!equipmentId) {
            console.warn(`Equipment "${equipmentName}" not found in database`);
            continue;
          }

          console.log(
            `Inserting equipment: ${equipmentName} (ID: ${equipmentId}) for user ${userId}`
          );
          await db.query(
            'INSERT INTO user_equipment (user_id, equipment_id) VALUES ($1, $2)',
            [userId, equipmentId]
          );
          insertedCount++;
        }
      }

      // Commit the transaction
      await db.query('COMMIT');
      console.log(
        `Equipment update transaction completed successfully. Inserted ${insertedCount} items.`
      );

      res.status(200).json({
        message: 'User equipment updated successfully',
        updated: insertedCount
      });
    } catch (transactionError) {
      // If there's an error, roll back the transaction
      await db.query('ROLLBACK');
      console.error('Transaction error:', transactionError);
      throw transactionError; // Re-throw to be caught by the outer catch
    }
  } catch (error) {
    console.error('Error updating user equipment:', error);
    res.status(500).json({
      error: 'Failed to update user equipment',
      details: error.message
    });
  }
});

module.exports = router;
