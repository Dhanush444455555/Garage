const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth.middleware');
const { generateInvoicePDF } = require('../utils/pdf.utils');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  return null;
}

// GET /api/invoices
router.get('/', authenticate, (req, res) => {
  try {
    let invoices;
    if (req.user.role === 'admin') {
      const customerId = req.query.customer_id;
      if (customerId) {
        invoices = db.prepare(`
          SELECT i.*, c.full_name as customer_name, c.email as customer_email, so.description as service_description
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          LEFT JOIN service_orders so ON i.service_order_id = so.id
          WHERE i.customer_id = ?
          ORDER BY i.created_at DESC
        `).all(customerId);
      } else {
        invoices = db.prepare(`
          SELECT i.*, c.full_name as customer_name, c.email as customer_email, so.description as service_description
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          LEFT JOIN service_orders so ON i.service_order_id = so.id
          ORDER BY i.created_at DESC
        `).all();
      }
    } else {
      invoices = db.prepare(`
        SELECT i.*, so.description as service_description
        FROM invoices i
        LEFT JOIN service_orders so ON i.service_order_id = so.id
        WHERE i.customer_id = ?
        ORDER BY i.created_at DESC
      `).all(req.user.id);
    }
    return res.json({ success: true, invoices });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error fetching invoices.' });
  }
});

// GET /api/invoices/:id
router.get('/:id', authenticate, (req, res) => {
  try {
    let invoice;
    if (req.user.role === 'admin') {
      invoice = db.prepare(`
        SELECT i.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile,
               so.description as service_description, v.make, v.model, v.registration_number
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN service_orders so ON i.service_order_id = so.id
        LEFT JOIN vehicles v ON so.vehicle_id = v.id
        WHERE i.id = ?
      `).get(req.params.id);
    } else {
      invoice = db.prepare(`
        SELECT i.*, so.description as service_description, v.make, v.model, v.registration_number
        FROM invoices i
        LEFT JOIN service_orders so ON i.service_order_id = so.id
        LEFT JOIN vehicles v ON so.vehicle_id = v.id
        WHERE i.id = ? AND i.customer_id = ?
      `).get(req.params.id, req.user.id);
    }

    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(invoice.id);
    const payments = db.prepare(`SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC`).all(invoice.id);

    return res.json({ success: true, invoice, items, payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/invoices (Admin only)
router.post('/', authenticate, [
  body('service_order_id').isInt().withMessage('Service Order ID is required'),
  body('customer_id').isInt().withMessage('Customer ID is required'),
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only administrators can generate invoices.' });
  }
  if (handleValidation(req, res)) return;

  try {
    const { service_order_id, customer_id, estimate_id, subtotal = 0, labour_charge = 0, discount = 0, tax_rate = 18.0, due_date, notes, items = [] } = req.body;

    const invoiceNumber = `KRG14-${Date.now().toString().slice(-6)}`;
    const taxable = Number(subtotal) + Number(labour_charge) - Number(discount);
    const tax_amount = taxable * (tax_rate / 100);
    const total_amount = Math.max(0, taxable + tax_amount);

    const r = db.prepare(`
      INSERT INTO invoices (invoice_number, service_order_id, estimate_id, customer_id, subtotal, labour_charge, tax_rate, tax_amount, discount, total_amount, status, due_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)
    `).run(invoiceNumber, service_order_id, estimate_id || null, customer_id, subtotal, labour_charge, tax_rate, tax_amount, discount, total_amount, due_date || null, notes || null);

    const invoiceId = r.lastInsertRowid;

    if (items.length > 0) {
      const insItem = db.prepare(`
        INSERT INTO invoice_items (invoice_id, item_type, description, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        const qty = Number(item.quantity || 1);
        const price = Number(item.unit_price || 0);
        insItem.run(invoiceId, item.item_type || 'part', item.description, qty, price, qty * price);
      }
    }

    // Generate PDF
    const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(customer_id);
    const order = db.prepare(`SELECT * FROM service_orders WHERE id = ?`).get(service_order_id);
    const vehicle = order ? db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(order.vehicle_id) : null;
    const invData = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId);

    let pdfUrl = null;
    try {
      pdfUrl = await generateInvoicePDF(invData, items, customer, order, vehicle);
      db.prepare(`UPDATE invoices SET pdf_url = ? WHERE id = ?`).run(pdfUrl, invoiceId);
    } catch (e) {
      console.error('PDF error:', e);
    }

    return res.status(201).json({ success: true, message: 'Invoice created successfully.', id: invoiceId, invoiceNumber, pdfUrl });
  } catch (err) {
    console.error('Create invoice error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create invoice.' });
  }
});

module.exports = router;
