const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const customerGuard = require('../middleware/customer.middleware');
const { notifyAdmin } = require('../utils/socket.utils');
const { createNotification } = require('../utils/notification.utils');
const { logAudit } = require('../utils/audit.utils');
const upload = require('../utils/upload.utils');
const crypto = require('crypto');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
  return null;
}

// All customer routes enforce `req.user.id` matching customer record

// ─── Profile ──────────────────────────────────────────────────────────────────
router.get('/profile', customerGuard, (req, res) => {
  try {
    const customer = db.prepare(`
      SELECT id, full_name, email, mobile, profile_image, loyalty_points, email_verified, mobile_verified, created_at
      FROM customers WHERE id = ?
    `).get(req.user.id);

    if (!customer) return res.status(404).json({ success: false, message: 'Customer profile not found.' });
    return res.json({ success: true, customer });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/profile', customerGuard, [
  body('full_name').optional().trim().notEmpty().withMessage('Full name cannot be empty'),
  body('mobile').optional().trim().matches(/^[6-9]\d{9}$/).withMessage('Valid 10-digit mobile required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { full_name, mobile } = req.body;
    db.prepare(`
      UPDATE customers
      SET full_name = COALESCE(?, full_name),
          mobile = COALESCE(?, mobile),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(full_name || null, mobile || null, req.user.id);

    logAudit({
      user_type: 'customer',
      user_id: req.user.id,
      action: 'update_profile',
      details: { full_name, mobile }
    });

    return res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

// ─── Vehicle Management ───────────────────────────────────────────────────────
router.get('/vehicles', customerGuard, (req, res) => {
  try {
    const vehicles = db.prepare(`
      SELECT v.*,
             (SELECT COUNT(*) FROM service_orders WHERE vehicle_id = v.id) as service_count,
             (SELECT MAX(created_at) FROM service_orders WHERE vehicle_id = v.id) as last_service_date
      FROM vehicles v
      WHERE v.customer_id = ?
      ORDER BY v.created_at DESC
    `).all(req.user.id);

    return res.json({ success: true, vehicles });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load vehicles.' });
  }
});

router.post('/vehicles', customerGuard, [
  body('make').trim().notEmpty().withMessage('Motorcycle make/brand is required'),
  body('model').trim().notEmpty().withMessage('Motorcycle model is required'),
  body('registration_number').trim().notEmpty().withMessage('Registration number is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { make, model, year, registration_number, color, vin, fuel_type, odometer_reading, notes } = req.body;

    const r = db.prepare(`
      INSERT INTO vehicles (customer_id, make, model, year, registration_number, color, vin, fuel_type, odometer_reading, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      make,
      model,
      year || null,
      registration_number.toUpperCase(),
      color || null,
      vin || null,
      fuel_type || 'Petrol',
      odometer_reading || 0,
      notes || null
    );

    const vehicleId = r.lastInsertRowid;

    notifyAdmin('new_vehicle_registered', {
      vehicleId,
      customerId: req.user.id,
      customerName: req.user.full_name,
      make,
      model,
      registration_number
    });

    logAudit({
      user_type: 'customer',
      user_id: req.user.id,
      action: 'add_vehicle',
      entity_type: 'vehicle',
      entity_id: vehicleId
    });

    return res.status(201).json({ success: true, message: 'Vehicle added successfully.', id: vehicleId });
  } catch (err) {
    console.error('Add vehicle error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add vehicle.' });
  }
});

router.post('/vehicles/:id/photo', customerGuard, upload.single('vehicle_photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded.' });
    const vehicle = db.prepare(`SELECT id FROM vehicles WHERE id = ? AND customer_id = ?`).get(req.params.id, req.user.id);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });

    const photoUrl = `/uploads/vehicles/${req.file.filename}`;
    db.prepare(`UPDATE vehicles SET photo_url = ?, updated_at = datetime('now') WHERE id = ?`).run(photoUrl, req.params.id);

    return res.json({ success: true, message: 'Vehicle photo updated.', photoUrl });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to upload photo.' });
  }
});

router.put('/vehicles/:id', customerGuard, (req, res) => {
  try {
    const vehicle = db.prepare(`SELECT id FROM vehicles WHERE id = ? AND customer_id = ?`).get(req.params.id, req.user.id);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });

    const { make, model, year, registration_number, color, vin, fuel_type, odometer_reading, notes } = req.body;

    db.prepare(`
      UPDATE vehicles
      SET make = COALESCE(?, make),
          model = COALESCE(?, model),
          year = COALESCE(?, year),
          registration_number = COALESCE(?, registration_number),
          color = COALESCE(?, color),
          vin = COALESCE(?, vin),
          fuel_type = COALESCE(?, fuel_type),
          odometer_reading = COALESCE(?, odometer_reading),
          notes = COALESCE(?, notes),
          updated_at = datetime('now')
      WHERE id = ? AND customer_id = ?
    `).run(make || null, model || null, year || null, registration_number || null, color || null, vin || null, fuel_type || null, odometer_reading !== undefined ? odometer_reading : null, notes || null, req.params.id, req.user.id);

    return res.json({ success: true, message: 'Vehicle updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update vehicle.' });
  }
});

router.delete('/vehicles/:id', customerGuard, (req, res) => {
  try {
    const r = db.prepare(`DELETE FROM vehicles WHERE id = ? AND customer_id = ?`).run(req.params.id, req.user.id);
    if (r.changes === 0) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    return res.json({ success: true, message: 'Vehicle removed.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to remove vehicle.' });
  }
});

// Vehicle Documents
router.post('/vehicles/:id/documents', customerGuard, upload.single('document'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    const vehicle = db.prepare(`SELECT id FROM vehicles WHERE id = ? AND customer_id = ?`).get(req.params.id, req.user.id);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });

    const { doc_type = 'RC' } = req.body;
    const fileUrl = `/uploads/documents/${req.file.filename}`;

    const r = db.prepare(`
      INSERT INTO vehicle_documents (vehicle_id, doc_type, file_name, file_url)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, doc_type, req.file.originalname, fileUrl);

    return res.status(201).json({ success: true, message: 'Document uploaded.', id: r.lastInsertRowid, fileUrl });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to upload document.' });
  }
});

// ─── Online Service Bookings ──────────────────────────────────────────────────
router.get('/bookings', customerGuard, (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*, v.make, v.model, v.registration_number
      FROM service_bookings b
      LEFT JOIN vehicles v ON b.vehicle_id = v.id
      WHERE b.customer_id = ?
      ORDER BY b.created_at DESC
    `).all(req.user.id);

    return res.json({ success: true, bookings });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load bookings.' });
  }
});

router.post('/bookings', customerGuard, upload.array('booking_media', 5), (req, res) => {
  try {
    const { vehicle_id, service_type, problem_description, preferred_date, preferred_time, pickup_drop, address } = req.body;

    if (!vehicle_id || !service_type || !preferred_date) {
      return res.status(400).json({ success: false, message: 'Vehicle, service type, and preferred date are required.' });
    }

    // Verify ownership
    const vehicle = db.prepare(`SELECT * FROM vehicles WHERE id = ? AND customer_id = ?`).get(vehicle_id, req.user.id);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });

    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      mediaUrls = req.files.map(f => `/uploads/bookings/${f.filename}`);
    }

    const r = db.prepare(`
      INSERT INTO service_bookings (customer_id, vehicle_id, service_type, problem_description, preferred_date, preferred_time, pickup_drop, address, media_urls)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      vehicle_id,
      service_type,
      problem_description || null,
      preferred_date,
      preferred_time || '10:00 AM',
      pickup_drop || 'no_pickup',
      address || null,
      JSON.stringify(mediaUrls)
    );

    const bookingId = r.lastInsertRowid;

    // Send Real-time notification to Admin Portal
    createNotification({
      recipient_type: 'admin',
      recipient_id: 1,
      title: 'New Service Booking Request!',
      message: `${req.user.full_name} booked ${service_type} for ${vehicle.make} ${vehicle.model} (${vehicle.registration_number}) on ${preferred_date}.`,
      link: '/admin/dashboard',
      type: 'warning'
    });

    notifyAdmin('new_booking_created', {
      bookingId,
      customerId: req.user.id,
      customerName: req.user.full_name,
      vehicle: `${vehicle.make} ${vehicle.model}`,
      registration_number: vehicle.registration_number,
      service_type,
      preferred_date
    });

    return res.status(201).json({
      success: true,
      message: 'Service appointment request submitted! Our garage will confirm shortly.',
      bookingId
    });
  } catch (err) {
    console.error('Booking creation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create booking.' });
  }
});

// ─── Live Service Tracking & History ──────────────────────────────────────────
router.get('/service-orders', customerGuard, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT so.*,
             v.make, v.model, v.registration_number, v.photo_url as vehicle_photo,
             m.full_name as mechanic_name
      FROM service_orders so
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      LEFT JOIN mechanics m ON so.mechanic_id = m.id
      WHERE so.customer_id = ?
      ORDER BY so.created_at DESC
    `).all(req.user.id);

    return res.json({ success: true, orders });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load service orders.' });
  }
});

router.get('/service-orders/:id', customerGuard, (req, res) => {
  try {
    const order = db.prepare(`
      SELECT so.*,
             v.make, v.model, v.registration_number, v.color, v.year,
             m.full_name as mechanic_name
      FROM service_orders so
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      LEFT JOIN mechanics m ON so.mechanic_id = m.id
      WHERE so.id = ? AND so.customer_id = ?
    `).get(req.params.id, req.user.id);

    if (!order) return res.status(404).json({ success: false, message: 'Service order not found.' });

    const items = db.prepare(`SELECT * FROM service_items WHERE service_order_id = ?`).all(req.params.id);
    const estimates = db.prepare(`SELECT * FROM estimates WHERE service_order_id = ? ORDER BY version DESC`).all(req.params.id);
    const invoices = db.prepare(`SELECT * FROM invoices WHERE service_order_id = ? ORDER BY created_at DESC`).all(req.params.id);

    return res.json({ success: true, order, items, estimates, invoices });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Estimate Approval ────────────────────────────────────────────────────────
router.get('/estimates', customerGuard, (req, res) => {
  try {
    const estimates = db.prepare(`
      SELECT e.*,
             v.make, v.model, v.registration_number,
             so.description as service_description
      FROM estimates e
      LEFT JOIN service_orders so ON e.service_order_id = so.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      WHERE e.customer_id = ?
      ORDER BY e.created_at DESC
    `).all(req.user.id);

    return res.json({ success: true, estimates });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load estimates.' });
  }
});

router.get('/estimates/:id', customerGuard, (req, res) => {
  try {
    const estimate = db.prepare(`
      SELECT e.*,
             v.make, v.model, v.registration_number,
             so.description as service_description
      FROM estimates e
      LEFT JOIN service_orders so ON e.service_order_id = so.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      WHERE e.id = ? AND e.customer_id = ?
    `).get(req.params.id, req.user.id);

    if (!estimate) return res.status(404).json({ success: false, message: 'Estimate not found.' });

    const items = db.prepare(`SELECT * FROM estimate_items WHERE estimate_id = ?`).all(req.params.id);
    const approvals = db.prepare(`SELECT * FROM estimate_approvals WHERE estimate_id = ? ORDER BY decided_at DESC`).all(req.params.id);

    return res.json({ success: true, estimate, items, approvals });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Customer Decision on Estimate: Approve, Reject, or Request Clarification
router.post('/estimates/:id/respond', customerGuard, [
  body('decision').isIn(['approved', 'rejected', 'clarification_requested']).withMessage('Valid decision is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { decision, comments } = req.body;
    const estimate = db.prepare(`SELECT * FROM estimates WHERE id = ? AND customer_id = ?`).get(req.params.id, req.user.id);
    if (!estimate) return res.status(404).json({ success: false, message: 'Estimate not found.' });

    // Record decision in estimate_approvals audit table
    db.prepare(`
      INSERT INTO estimate_approvals (estimate_id, customer_id, decision, comments)
      VALUES (?, ?, ?, ?)
    `).run(estimate.id, req.user.id, decision, comments || null);

    // Update estimate status
    const statusMap = {
      approved: 'approved',
      rejected: 'rejected',
      clarification_requested: 'revision_requested'
    };
    const newStatus = statusMap[decision] || 'pending_approval';

    db.prepare(`
      UPDATE estimates
      SET status = ?, customer_notes = COALESCE(?, customer_notes), updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, comments || null, estimate.id);

    // If approved, advance service order to 'service_in_progress'
    if (decision === 'approved') {
      db.prepare(`UPDATE service_orders SET status = 'service_in_progress', updated_at = datetime('now') WHERE id = ?`).run(estimate.service_order_id);
    }

    // Real-time notification to Admin Portal
    createNotification({
      recipient_type: 'admin',
      recipient_id: 1,
      title: `Estimate ${decision.toUpperCase()} by Customer`,
      message: `${req.user.full_name} has ${decision.replace('_', ' ')} estimate #${estimate.id} (Rs. ${estimate.total_amount}). Note: "${comments || 'None'}"`,
      link: '/admin/dashboard',
      type: decision === 'approved' ? 'success' : 'warning'
    });

    notifyAdmin('estimate_decision_received', {
      estimateId: estimate.id,
      serviceOrderId: estimate.service_order_id,
      customerName: req.user.full_name,
      decision,
      comments
    });

    return res.json({ success: true, message: `Estimate has been ${decision.replace('_', ' ')}. Thank you!` });
  } catch (err) {
    console.error('Estimate response error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record decision.' });
  }
});

// ─── Invoices ─────────────────────────────────────────────────────────────────
router.get('/invoices', customerGuard, (req, res) => {
  try {
    const invoices = db.prepare(`
      SELECT i.*,
             v.make, v.model, v.registration_number,
             so.description as service_description
      FROM invoices i
      LEFT JOIN service_orders so ON i.service_order_id = so.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      WHERE i.customer_id = ?
      ORDER BY i.created_at DESC
    `).all(req.user.id);

    return res.json({ success: true, invoices });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load invoices.' });
  }
});

router.get('/invoices/:id', customerGuard, (req, res) => {
  try {
    const invoice = db.prepare(`
      SELECT i.*,
             v.make, v.model, v.registration_number,
             so.description as service_description
      FROM invoices i
      LEFT JOIN service_orders so ON i.service_order_id = so.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      WHERE i.id = ? AND i.customer_id = ?
    `).get(req.params.id, req.user.id);

    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(req.params.id);
    const payments = db.prepare(`SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC`).all(req.params.id);

    return res.json({ success: true, invoice, items, payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Payments & Gateway Integration ───────────────────────────────────────────
router.get('/payments', customerGuard, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.*, i.invoice_number, i.total_amount as invoice_total
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      WHERE p.customer_id = ?
      ORDER BY p.payment_date DESC
    `).all(req.user.id);

    const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE customer_id = ? AND status='success'`).get(req.user.id).s;
    const pendingInvoices = db.prepare(`SELECT COALESCE(SUM(total_amount - paid_amount), 0) as s FROM invoices WHERE customer_id = ? AND status IN ('sent','partially_paid')`).get(req.user.id).s;

    return res.json({ success: true, payments, summary: { totalPaid, pendingInvoices } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load payments.' });
  }
});

// Create Razorpay Order / Direct Gateway Initiation
router.post('/payments/create-order', customerGuard, [
  body('invoice_id').isInt().withMessage('Invoice is required'),
], async (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND customer_id = ?`).get(req.body.invoice_id, req.user.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const dueAmount = invoice.total_amount - (invoice.paid_amount || 0);
    if (dueAmount <= 0) {
      return res.status(400).json({ success: false, message: 'This invoice has already been fully paid.' });
    }

    // Razorpay Integration
    const rzKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_KRG14_DEMO';
    const orderId = `order_${Date.now()}_${Math.round(Math.random() * 1000)}`;

    return res.json({
      success: true,
      order: {
        id: orderId,
        amount: Math.round(dueAmount * 100), // in paise
        currency: 'INR',
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        key_id: rzKeyId
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to initiate payment gateway.' });
  }
});

// Verify Payment and Record
router.post('/payments/verify', customerGuard, [
  body('invoice_id').isInt().withMessage('Invoice is required'),
  body('amount').isNumeric().withMessage('Valid amount is required'),
  body('payment_method').isIn(['upi', 'card', 'razorpay', 'cash', 'bank_transfer']).withMessage('Payment method required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { invoice_id, amount, payment_method, transaction_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND customer_id = ?`).get(invoice_id, req.user.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const dueAmount = invoice.total_amount - (invoice.paid_amount || 0);
    if (dueAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invoice is already fully paid.' });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero.' });
    }

    const txnId = transaction_id || razorpay_payment_id || `TXN-${Date.now()}`;

    // Prevent duplicate payment processing
    const duplicate = db.prepare(`SELECT id FROM payments WHERE transaction_id = ?`).get(txnId);
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'Duplicate transaction detected. This transaction has already been recorded.' });
    }

    // Backend verification of Razorpay HMAC SHA-256 signature
    if (payment_method === 'razorpay' && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_KEY_SECRET !== 'rzp_test_secret_key') {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Missing Razorpay signature verification parameters.' });
      }
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Invalid payment signature. Verification failed.' });
      }
    }

    const receipt_number = `RCPT-${Date.now().toString().slice(-6)}`;

    const r = db.prepare(`
      INSERT INTO payments (invoice_id, customer_id, amount, payment_method, transaction_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, status, receipt_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)
    `).run(
      invoice_id,
      req.user.id,
      amount,
      payment_method,
      txnId,
      razorpay_order_id || null,
      razorpay_payment_id || null,
      razorpay_signature || null,
      receipt_number
    );

    const paymentId = r.lastInsertRowid;

    // Record into payment_transactions audit table
    db.prepare(`
      INSERT INTO payment_transactions (payment_id, gateway, raw_payload, status)
      VALUES (?, ?, ?, 'verified')
    `).run(paymentId, payment_method, JSON.stringify({ txnId, amount, invoice_id }));

    // Update invoice
    const newPaid = Number(invoice.paid_amount || 0) + Number(amount);
    const newStatus = newPaid >= invoice.total_amount ? 'paid' : 'partially_paid';

    db.prepare(`UPDATE invoices SET paid_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(newPaid, newStatus, invoice_id);

    // Award loyalty points
    const points = Math.floor(amount / 100);
    if (points > 0) {
      db.prepare(`UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?`).run(points, req.user.id);
    }

    createNotification({
      recipient_type: 'admin',
      recipient_id: 1,
      title: 'Customer Payment Received!',
      message: `${req.user.full_name} paid Rs. ${amount} for Invoice ${invoice.invoice_number} via ${payment_method.toUpperCase()}.`,
      link: '/admin/dashboard',
      type: 'success'
    });

    notifyAdmin('payment_received', {
      paymentId,
      customerName: req.user.full_name,
      amount,
      invoiceNumber: invoice.invoice_number,
      receipt_number
    });

    return res.status(201).json({
      success: true,
      message: 'Payment verified and recorded successfully!',
      receipt_number,
      status: newStatus
    });
  } catch (err) {
    console.error('Verify payment error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify payment.' });
  }
});

// ─── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications', customerGuard, (req, res) => {
  try {
    const list = db.prepare(`
      SELECT * FROM notifications
      WHERE recipient_type = 'customer' AND recipient_id = ?
      ORDER BY created_at DESC
      LIMIT 25
    `).all(req.user.id);

    return res.json({ success: true, notifications: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load notifications.' });
  }
});

router.put('/notifications/:id/read', customerGuard, (req, res) => {
  try {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?`).run(req.params.id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

// ─── Reviews / Feedback ───────────────────────────────────────────────────────
router.post('/reviews', customerGuard, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5 stars'),
  body('feedback').trim().notEmpty().withMessage('Feedback text is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { service_order_id, rating, feedback } = req.body;
    db.prepare(`
      INSERT INTO reviews (service_order_id, customer_id, rating, feedback)
      VALUES (?, ?, ?, ?)
    `).run(service_order_id || null, req.user.id, rating, feedback);

    createNotification({
      recipient_type: 'admin',
      recipient_id: 1,
      title: 'New Customer Review Received',
      message: `${req.user.full_name} gave a ${rating}-star review: "${feedback.slice(0, 40)}..."`,
      link: '/admin/dashboard',
      type: 'info'
    });

    return res.status(201).json({ success: true, message: 'Thank you for your rating and feedback!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to submit review.' });
  }
});

// ─── Support Tickets ──────────────────────────────────────────────────────────
router.get('/tickets', customerGuard, (req, res) => {
  try {
    const tickets = db.prepare(`SELECT * FROM support_tickets WHERE customer_id = ? ORDER BY created_at DESC`).all(req.user.id);
    return res.json({ success: true, tickets });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load tickets.' });
  }
});

router.post('/tickets', customerGuard, [
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('message').trim().notEmpty().withMessage('Initial message is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { subject, category = 'general', priority = 'normal', message } = req.body;
    const initialMsg = [{ sender: 'customer', text: message, time: new Date().toISOString() }];

    const r = db.prepare(`
      INSERT INTO support_tickets (customer_id, subject, category, priority, status, messages)
      VALUES (?, ?, ?, ?, 'open', ?)
    `).run(req.user.id, subject, category, priority, JSON.stringify(initialMsg));

    createNotification({
      recipient_type: 'admin',
      recipient_id: 1,
      title: 'New Support Ticket Raised',
      message: `${req.user.full_name} raised ticket: "${subject}"`,
      link: '/admin/dashboard',
      type: 'warning'
    });

    return res.status(201).json({ success: true, message: 'Support ticket submitted.', ticketId: r.lastInsertRowid });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to create ticket.' });
  }
});

module.exports = router;
