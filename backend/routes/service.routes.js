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

// GET /api/service-orders or /api/services
router.get('/', authenticate, (req, res) => {
  try {
    let orders;
    if (req.user.role === 'admin') {
      const customerId = req.query.customer_id;
      if (customerId) {
        orders = db.prepare(`
          SELECT so.*, c.full_name as customer_name, c.email as customer_email,
                 v.make, v.model, v.registration_number, m.full_name as mechanic_name
          FROM service_orders so
          LEFT JOIN customers c ON so.customer_id = c.id
          LEFT JOIN vehicles v ON so.vehicle_id = v.id
          LEFT JOIN mechanics m ON so.mechanic_id = m.id
          WHERE so.customer_id = ?
          ORDER BY so.created_at DESC
        `).all(customerId);
      } else {
        orders = db.prepare(`
          SELECT so.*, c.full_name as customer_name, c.email as customer_email,
                 v.make, v.model, v.registration_number, m.full_name as mechanic_name
          FROM service_orders so
          LEFT JOIN customers c ON so.customer_id = c.id
          LEFT JOIN vehicles v ON so.vehicle_id = v.id
          LEFT JOIN mechanics m ON so.mechanic_id = m.id
          ORDER BY so.created_at DESC
        `).all();
      }
    } else {
      orders = db.prepare(`
        SELECT so.*, v.make, v.model, v.registration_number, m.full_name as mechanic_name
        FROM service_orders so
        LEFT JOIN vehicles v ON so.vehicle_id = v.id
        LEFT JOIN mechanics m ON so.mechanic_id = m.id
        WHERE so.customer_id = ?
        ORDER BY so.created_at DESC
      `).all(req.user.id);
    }
    return res.json({ success: true, orders });
  } catch (err) {
    console.error('Service orders GET error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching service orders.' });
  }
});

// GET /api/service-orders/:id
router.get('/:id', authenticate, (req, res) => {
  try {
    let order;
    if (req.user.role === 'admin') {
      order = db.prepare(`
        SELECT so.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile,
               v.make, v.model, v.registration_number, m.full_name as mechanic_name
        FROM service_orders so
        LEFT JOIN customers c ON so.customer_id = c.id
        LEFT JOIN vehicles v ON so.vehicle_id = v.id
        LEFT JOIN mechanics m ON so.mechanic_id = m.id
        WHERE so.id = ?
      `).get(req.params.id);
    } else {
      order = db.prepare(`
        SELECT so.*, v.make, v.model, v.registration_number, m.full_name as mechanic_name
        FROM service_orders so
        LEFT JOIN vehicles v ON so.vehicle_id = v.id
        LEFT JOIN mechanics m ON so.mechanic_id = m.id
        WHERE so.id = ? AND so.customer_id = ?
      `).get(req.params.id, req.user.id);
    }

    if (!order) return res.status(404).json({ success: false, message: 'Service order not found.' });

    const items = db.prepare(`SELECT * FROM service_items WHERE service_order_id = ?`).all(req.params.id);
    return res.json({ success: true, order, items });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/service-orders (Admin only or Customer requesting service)
router.post('/', authenticate, [
  body('vehicle_id').isInt().withMessage('Vehicle ID is required'),
  body('description').trim().notEmpty().withMessage('Service description is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { vehicle_id, description, notes, estimated_completion, mechanic_id, items } = req.body;
    let customer_id;

    if (req.user.role === 'admin') {
      customer_id = req.body.customer_id;
      if (!customer_id) {
        const v = db.prepare(`SELECT customer_id FROM vehicles WHERE id = ?`).get(vehicle_id);
        customer_id = v ? v.customer_id : req.user.id;
      }
    } else {
      customer_id = req.user.id;
      // verify vehicle belongs to customer
      const v = db.prepare(`SELECT id FROM vehicles WHERE id = ? AND customer_id = ?`).get(vehicle_id, req.user.id);
      if (!v) return res.status(403).json({ success: false, message: 'Invalid vehicle selected.' });
    }

    const insertOrder = db.prepare(`
      INSERT INTO service_orders (customer_id, vehicle_id, mechanic_id, description, notes, estimated_completion)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = insertOrder.run(
      customer_id,
      vehicle_id,
      req.user.role === 'admin' ? (mechanic_id || null) : null,
      description,
      notes || null,
      estimated_completion || null
    );

    const orderId = result.lastInsertRowid;

    // Insert items if provided
    if (Array.isArray(items) && items.length > 0) {
      const insertItem = db.prepare(`
        INSERT INTO service_items (service_order_id, description, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        const qty = item.quantity || 1;
        const price = item.unit_price || 0;
        insertItem.run(orderId, item.description, qty, price, qty * price);
      }
    }

    return res.status(201).json({ success: true, message: 'Service order created.', id: orderId });
  } catch (err) {
    console.error('Create service order error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create service order.' });
  }
});

// PUT /api/service-orders/:id (Admin update or status change)
router.put('/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only administrators can update service orders.' });
  }

  try {
    const { mechanic_id, status, notes, estimated_completion } = req.body;
    db.prepare(`
      UPDATE service_orders
      SET mechanic_id = COALESCE(?, mechanic_id),
          status = COALESCE(?, status),
          notes = COALESCE(?, notes),
          estimated_completion = COALESCE(?, estimated_completion),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(mechanic_id || null, status || null, notes || null, estimated_completion || null, req.params.id);

    return res.json({ success: true, message: 'Service order updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update service order.' });
  }
});

module.exports = router;
