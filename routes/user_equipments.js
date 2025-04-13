const express = require('express');
const router = express.Router();
const db = require('../config/db');
require('dotenv').config();

// Get equipment for a specific user
router.get('/users/:userId/equipment', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Get the equipment IDs for this user
    const userEquipmentQuery = await db.query(
      `SELECT e.id, e.name
       FROM equipment_catalog e
       JOIN user_equipment ue ON e.id = ue.equipment_id
       WHERE ue.user_id = $1
       ORDER BY e.name`,
      [userId]
    );

    // Extract just the equipment names for the client
    const equipmentNames = userEquipmentQuery.rows.map(item => item.name);

    res.json({ equipment: equipmentNames });
  } catch (error) {
    console.error('Error fetching user equipment:', error);
    res.status(500).json({ error: 'Failed to fetch user equipment' });
  }
});

// Update user equipment (handles add, remove, and update in one call)
router.put('/users/:userId/equipment', async (req, res) => {
  // Start a transaction to ensure data consistency
  const client = await db.getClient();

  try {
    const { userId } = req.params;
    const { equipment } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!equipment || !Array.isArray(equipment)) {
      return res
        .status(400)
        .json({ error: 'Equipment must be provided as an array' });
    }

    await client.query('BEGIN');

    // Step 1: Delete all current equipment associations for this user
    await client.query('DELETE FROM user_equipment WHERE user_id = $1', [
      userId
    ]);

    // Step 2: Insert the new equipment selections
    if (equipment.length > 0) {
      // Get all equipment to map names to IDs
      const equipmentRecords = await client.query(
        'SELECT id, name FROM equipment_catalog WHERE name = ANY($1)',
        [equipment]
      );

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

        await client.query(
          'INSERT INTO user_equipment (user_id, equipment_id) VALUES ($1, $2)',
          [userId, equipmentId]
        );
      }
    }

    await client.query('COMMIT');

    res.status(200).json({ message: 'User equipment updated successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user equipment:', error);
    res.status(500).json({ error: 'Failed to update user equipment' });
  } finally {
    client.release();
  }
});

module.exports = router;
