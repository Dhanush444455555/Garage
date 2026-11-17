const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth.middleware');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  return null;
}

// GET /api/vehicles - Admin gets all vehicles or filtered by customer_id; Customer gets only own
router.get('/', authenticate, (req, res) => {
  try {
    let vehicles;
    if (req.user.role === 'admin') {
      const customerId = req.query.customer_id;
      if (customerId) {
        vehicles = db.prepare(`
          SELECT v.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile
          FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id
          WHERE v.customer_id = ?
          ORDER BY v.created_at DESC
        `).all(customerId);
      } else {
        vehicles = db.prepare(`
          SELECT v.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile
          FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id
          ORDER BY v.created_at DESC
        `).all();
      }
    } else {
      vehicles = db.prepare(`SELECT * FROM vehicles WHERE customer_id = ? ORDER BY created_at DESC`).all(req.user.id);
    }
    return res.json({ success: true, vehicles });
  } catch (err) {
    console.error('Vehicles GET error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching vehicles.' });
  }
});

// GET /api/vehicles/:id
router.get('/:id', authenticate, (req, res) => {
  try {
    let vehicle;
    if (req.user.role === 'admin') {
      vehicle = db.prepare(`
        SELECT v.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile
        FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id
        WHERE v.id = ?
      `).get(req.params.id);
    } else {
      vehicle = db.prepare(`SELECT * FROM vehicles WHERE id = ? AND customer_id = ?`).get(req.params.id, req.user.id);
    }

    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    return res.json({ success: true, vehicle });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/vehicles - Customer or Admin
router.post('/', authenticate, [
  body('make').trim().notEmpty().withMessage('Make is required'),
  body('model').trim().notEmpty().withMessage('Model is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { make, model, year, registration_number, color, vin, fuel_type, notes } = req.body;
    let customer_id = req.user.role === 'admin' ? (req.body.customer_id || req.user.id) : req.user.id;

    const r = db.prepare(`
      INSERT INTO vehicles (customer_id, make, model, year, registration_number, color, vin, fuel_type, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(customer_id, make, model, year || null, registration_number || null, color || null, vin || null, fuel_type || null, notes || null);

    return res.status(201).json({ success: true, message: 'Vehicle added successfully.', id: r.lastInsertRowid });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to add vehicle.' });
  }
});

// PUT /api/vehicles/:id
router.put('/:id', authenticate, (req, res) => {
  try {
    const { make, model, year, registration_number, color, vin, fuel_type, notes } = req.body;

    let existing;
    if (req.user.role === 'admin') {
      existing = db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(req.params.id);
    } else {
      existing = db.prepare(`SELECT * FROM vehicles WHERE id = ? AND customer_id = ?`).get(req.params.id, req.user.id);
    }

    if (!existing) return res.status(404).json({ success: false, message: 'Vehicle not found.' });

    db.prepare(`
      UPDATE vehicles
      SET make = COALESCE(?, make),
          model = COALESCE(?, model),
          year = COALESCE(?, year),
          registration_number = COALESCE(?, registration_number),
          color = COALESCE(?, color),
          vin = COALESCE(?, vin),
          fuel_type = COALESCE(?, fuel_type),
          notes = COALESCE(?, notes),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(make || null, model || null, year || null, registration_number || null, color || null, vin || null, fuel_type || null, notes || null, req.params.id);

    return res.json({ success: true, message: 'Vehicle updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update vehicle.' });
  }
});

// DELETE /api/vehicles/:id
router.delete('/:id', authenticate, (req, res) => {
  try {
    let r;
    if (req.user.role === 'admin') {
      r = db.prepare(`DELETE FROM vehicles WHERE id = ?`).run(req.params.id);
    } else {
      r = db.prepare(`DELETE FROM vehicles WHERE id = ? AND customer_id = ?`).run(req.params.id, req.user.id);
    }

    if (r.changes === 0) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    return res.json({ success: true, message: 'Vehicle removed successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete vehicle.' });
  }
});

module.exports = router;
