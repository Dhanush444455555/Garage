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

// GET /api/payments
router.get('/', authenticate, (req, res) => {
  try {
    let payments;
    if (req.user.role === 'admin') {
      payments = db.prepare(`
        SELECT p.*, c.full_name as customer_name, i.invoice_number, i.total_amount as invoice_total
        FROM payments p
        LEFT JOIN customers c ON p.customer_id = c.id
        LEFT JOIN invoices i ON p.invoice_id = i.id
        ORDER BY p.payment_date DESC
      `).all();
    } else {
      payments = db.prepare(`
        SELECT p.*, i.invoice_number, i.total_amount as invoice_total
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE p.customer_id = ?
        ORDER BY p.payment_date DESC
      `).all(req.user.id);
    }
    return res.json({ success: true, payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error fetching payments.' });
  }
});

// POST /api/payments (Record payment)
router.post('/', authenticate, [
  body('invoice_id').isInt().withMessage('Invoice ID is required'),
  body('amount').isNumeric().withMessage('Amount is required'),
  body('payment_method').isIn(['cash','card','upi','razorpay','bank_transfer']).withMessage('Valid payment method is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { invoice_id, amount, payment_method, transaction_id, notes } = req.body;
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoice_id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const customer_id = req.user.role === 'admin' ? invoice.customer_id : req.user.id;
    const receipt_number = `RCPT-${Date.now().toString().slice(-6)}`;

    const r = db.prepare(`
      INSERT INTO payments (invoice_id, customer_id, amount, payment_method, transaction_id, status, receipt_number, notes)
      VALUES (?, ?, ?, ?, ?, 'success', ?, ?)
    `).run(invoice_id, customer_id, amount, payment_method, transaction_id || null, receipt_number, notes || null);

    const newPaid = Number(invoice.paid_amount || 0) + Number(amount);
    const newStatus = newPaid >= invoice.total_amount ? 'paid' : 'partially_paid';

    db.prepare(`UPDATE invoices SET paid_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(newPaid, newStatus, invoice_id);

    return res.status(201).json({ success: true, message: 'Payment recorded.', id: r.lastInsertRowid, receipt_number });
  } catch (err) {
    console.error('Payment error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record payment.' });
  }
});

module.exports = router;
