const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const adminGuard = require('../middleware/admin.middleware');
const { notifyCustomer } = require('../utils/socket.utils');
const { createNotification } = require('../utils/notification.utils');
const { logAudit } = require('../utils/audit.utils');
const { generateInvoicePDF } = require('../utils/pdf.utils');
const upload = require('../utils/upload.utils');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
  return null;
}

// ─── Admin Dashboard Stats ───────────────────────────────────────────────────
router.get('/stats', adminGuard, (req, res) => {
  try {
    const totalCustomers      = db.prepare(`SELECT COUNT(*) as c FROM customers WHERE is_active=1`).get().c;
    const newRegistrations    = db.prepare(`SELECT COUNT(*) as c FROM customers WHERE date(created_at) >= date('now', '-7 days')`).get().c;
    const totalVehicles       = db.prepare(`SELECT COUNT(*) as c FROM vehicles`).get().c;
    const newServiceRequests  = db.prepare(`SELECT COUNT(*) as c FROM service_bookings WHERE status='pending'`).get().c;
    const todayAppointments   = db.prepare(`SELECT COUNT(*) as c FROM service_bookings WHERE date(preferred_date) = date('now')`).get().c;
    const activeServices      = db.prepare(`SELECT COUNT(*) as c FROM service_orders WHERE status NOT IN ('delivered','cancelled')`).get().c;
    const pendingApprovals    = db.prepare(`SELECT COUNT(*) as c FROM estimates WHERE status='pending_approval'`).get().c;
    const completedServices   = db.prepare(`SELECT COUNT(*) as c FROM service_orders WHERE status='delivered'`).get().c;
    const totalRevenue        = db.prepare(`SELECT COALESCE(SUM(amount),0) as r FROM payments WHERE status='success'`).get().r;
    const pendingInvoices     = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE status IN ('draft','sent','partially_paid')`).get().c;
    const pendingAmount       = db.prepare(`SELECT COALESCE(SUM(total_amount - paid_amount), 0) as r FROM invoices WHERE status IN ('sent','partially_paid')`).get().r;
    const lowStock            = db.prepare(`SELECT COUNT(*) as c FROM inventory WHERE quantity <= min_stock_level`).get().c;
    const totalMechanics      = db.prepare(`SELECT COUNT(*) as c FROM mechanics WHERE is_active=1`).get().c;

    const recentActivities    = db.prepare(`
      SELECT al.*,
             CASE
               WHEN al.user_type='customer' THEN (SELECT full_name FROM customers WHERE id=al.user_id)
               WHEN al.user_type='admin' THEN (SELECT full_name FROM admins WHERE id=al.user_id)
               ELSE 'System'
             END as user_name
      FROM audit_logs al
      ORDER BY al.created_at DESC
      LIMIT 10
    `).all();

    const statsData = {
      totalCustomers,
      total_customers: totalCustomers,
      newRegistrations,
      new_registrations: newRegistrations,
      totalVehicles,
      total_vehicles: totalVehicles,
      newServiceRequests,
      new_service_requests: newServiceRequests,
      todayAppointments,
      today_appointments: todayAppointments,
      activeServices,
      active_services: activeServices,
      pendingApprovals,
      pending_approvals: pendingApprovals,
      completedServices,
      completed_services: completedServices,
      totalRevenue,
      total_revenue: totalRevenue,
      pendingInvoices,
      pending_invoices: pendingInvoices,
      pendingAmount,
      pending_amount: pendingAmount,
      lowStock,
      low_stock_items: lowStock,
      totalMechanics,
      active_mechanics: totalMechanics,
    };

    return res.json({
      success: true,
      stats: statsData,
      recentActivities
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ success: false, message: 'Server error loading stats.' });
  }
});

// ─── Customer Management ──────────────────────────────────────────────────────
router.get('/customers', adminGuard, (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q.trim()}%` : null;
    let customers;
    if (q) {
      customers = db.prepare(`
        SELECT id, full_name, email, mobile, is_active, loyalty_points, internal_notes, created_at,
               (SELECT COUNT(*) FROM vehicles WHERE customer_id = customers.id) as vehicle_count,
               (SELECT COUNT(*) FROM service_orders WHERE customer_id = customers.id) as order_count
        FROM customers
        WHERE full_name LIKE ? OR email LIKE ? OR mobile LIKE ?
        ORDER BY created_at DESC
      `).all(q, q, q);
    } else {
      customers = db.prepare(`
        SELECT id, full_name, email, mobile, is_active, loyalty_points, internal_notes, created_at,
               (SELECT COUNT(*) FROM vehicles WHERE customer_id = customers.id) as vehicle_count,
               (SELECT COUNT(*) FROM service_orders WHERE customer_id = customers.id) as order_count
        FROM customers
        ORDER BY created_at DESC
      `).all();
    }
    return res.json({ success: true, customers });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error loading customers.' });
  }
});

router.get('/customers/:id', adminGuard, (req, res) => {
  try {
    const customer = db.prepare(`
      SELECT id, full_name, email, mobile, is_active, loyalty_points, internal_notes, created_at
      FROM customers WHERE id = ?
    `).get(req.params.id);

    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

    const vehicles = db.prepare(`SELECT * FROM vehicles WHERE customer_id = ? ORDER BY created_at DESC`).all(req.params.id);
    const bookings = db.prepare(`
      SELECT b.*, v.make, v.model, v.registration_number
      FROM service_bookings b
      LEFT JOIN vehicles v ON b.vehicle_id = v.id
      WHERE b.customer_id = ?
      ORDER BY b.created_at DESC
    `).all(req.params.id);

    const orders = db.prepare(`
      SELECT so.*, v.make, v.model, v.registration_number, m.full_name as mechanic_name
      FROM service_orders so
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      LEFT JOIN mechanics m ON so.mechanic_id = m.id
      WHERE so.customer_id = ?
      ORDER BY so.created_at DESC
    `).all(req.params.id);

    const estimates = db.prepare(`
      SELECT e.*, so.description as service_description
      FROM estimates e
      LEFT JOIN service_orders so ON e.service_order_id = so.id
      WHERE e.customer_id = ?
      ORDER BY e.created_at DESC
    `).all(req.params.id);

    const invoices = db.prepare(`
      SELECT i.*, so.description as service_description
      FROM invoices i
      LEFT JOIN service_orders so ON i.service_order_id = so.id
      WHERE i.customer_id = ?
      ORDER BY i.created_at DESC
    `).all(req.params.id);

    const payments = db.prepare(`
      SELECT p.*, i.invoice_number
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      WHERE p.customer_id = ?
      ORDER BY p.payment_date DESC
    `).all(req.params.id);

    return res.json({
      success: true,
      customer,
      vehicles,
      bookings,
      orders,
      estimates,
      invoices,
      payments
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/customers/:id', adminGuard, (req, res) => {
  try {
    const { full_name, email, mobile, is_active, internal_notes, loyalty_points } = req.body;
    db.prepare(`
      UPDATE customers
      SET full_name = COALESCE(?, full_name),
          email = COALESCE(?, email),
          mobile = COALESCE(?, mobile),
          is_active = COALESCE(?, is_active),
          internal_notes = COALESCE(?, internal_notes),
          loyalty_points = COALESCE(?, loyalty_points),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      full_name || null,
      email || null,
      mobile || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      internal_notes || null,
      loyalty_points !== undefined ? loyalty_points : null,
      req.params.id
    );

    logAudit({
      user_type: 'admin',
      user_id: req.user.id,
      action: 'customer_update',
      entity_type: 'customer',
      entity_id: req.params.id,
      details: req.body
    });

    return res.json({ success: true, message: 'Customer updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update customer.' });
  }
});

// ─── Vehicle Management ───────────────────────────────────────────────────────
router.get('/vehicles', adminGuard, (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q.trim()}%` : null;
    let vehicles;
    if (q) {
      vehicles = db.prepare(`
        SELECT v.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile
        FROM vehicles v
        LEFT JOIN customers c ON v.customer_id = c.id
        WHERE v.registration_number LIKE ? OR v.make LIKE ? OR v.model LIKE ? OR c.full_name LIKE ?
        ORDER BY v.created_at DESC
      `).all(q, q, q, q);
    } else {
      vehicles = db.prepare(`
        SELECT v.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile
        FROM vehicles v
        LEFT JOIN customers c ON v.customer_id = c.id
        ORDER BY v.created_at DESC
      `).all();
    }
    return res.json({ success: true, vehicles });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error loading vehicles.' });
  }
});

// ─── Service Bookings (Online Booking Requests) ───────────────────────────────
router.get('/bookings', adminGuard, (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*,
             c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile,
             v.make, v.model, v.registration_number, v.year as vehicle_year
      FROM service_bookings b
      LEFT JOIN customers c ON b.customer_id = c.id
      LEFT JOIN vehicles v ON b.vehicle_id = v.id
      ORDER BY b.created_at DESC
    `).all();
    return res.json({ success: true, bookings });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load bookings.' });
  }
});

router.put('/bookings/:id/status', adminGuard, (req, res) => {
  try {
    const { status, internal_notes } = req.body;
    db.prepare(`
      UPDATE service_bookings
      SET status = ?, internal_notes = COALESCE(?, internal_notes), updated_at = datetime('now')
      WHERE id = ?
    `).run(status, internal_notes || null, req.params.id);

    const booking = db.prepare(`SELECT * FROM service_bookings WHERE id = ?`).get(req.params.id);
    if (booking) {
      createNotification({
        recipient_type: 'customer',
        recipient_id: booking.customer_id,
        title: `Service Booking ${status.toUpperCase()}`,
        message: `Your booking for ${booking.service_type} has been ${status}.`,
        link: '/user/dashboard',
        type: status === 'confirmed' ? 'success' : 'info'
      });
    }

    return res.json({ success: true, message: `Booking marked as ${status}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update booking status.' });
  }
});

// Convert Booking to Live Service Order
router.post('/bookings/:id/convert', adminGuard, (req, res) => {
  try {
    const booking = db.prepare(`SELECT * FROM service_bookings WHERE id = ?`).get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });

    const { mechanic_id, estimated_completion, notes } = req.body;

    const r = db.prepare(`
      INSERT INTO service_orders (booking_id, customer_id, vehicle_id, mechanic_id, status, description, notes, estimated_completion)
      VALUES (?, ?, ?, ?, 'vehicle_accepted', ?, ?, ?)
    `).run(
      booking.id,
      booking.customer_id,
      booking.vehicle_id,
      mechanic_id || null,
      booking.problem_description || booking.service_type,
      notes || booking.internal_notes || null,
      estimated_completion || null
    );

    db.prepare(`UPDATE service_bookings SET status='converted', updated_at=datetime('now') WHERE id=?`).run(booking.id);

    const orderId = r.lastInsertRowid;

    createNotification({
      recipient_type: 'customer',
      recipient_id: booking.customer_id,
      title: 'Bike Checked In at Garage 14!',
      message: 'Your motorcycle has been accepted and is queued for preliminary inspection.',
      link: '/user/dashboard',
      type: 'info'
    });

    notifyCustomer(booking.customer_id, 'service_status_updated', {
      orderId,
      status: 'vehicle_accepted',
      statusText: 'Vehicle Accepted'
    });

    return res.status(201).json({ success: true, message: 'Service order created from booking.', orderId });
  } catch (err) {
    console.error('Convert booking error:', err);
    return res.status(500).json({ success: false, message: 'Failed to convert booking.' });
  }
});

// ─── Live Service Orders (9-Step Timeline) ───────────────────────────────────
router.get('/service-orders', adminGuard, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT so.*,
             c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile,
             v.make, v.model, v.registration_number,
             m.full_name as mechanic_name
      FROM service_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      LEFT JOIN mechanics m ON so.mechanic_id = m.id
      ORDER BY so.created_at DESC
    `).all();
    return res.json({ success: true, orders });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load service orders.' });
  }
});

router.get('/service-orders/:id', adminGuard, (req, res) => {
  try {
    const order = db.prepare(`
      SELECT so.*,
             c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile,
             v.make, v.model, v.registration_number, v.color, v.vin,
             m.full_name as mechanic_name
      FROM service_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      LEFT JOIN mechanics m ON so.mechanic_id = m.id
      WHERE so.id = ?
    `).get(req.params.id);

    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    const items = db.prepare(`SELECT * FROM service_items WHERE service_order_id = ?`).all(req.params.id);
    const estimates = db.prepare(`SELECT * FROM estimates WHERE service_order_id = ? ORDER BY version DESC`).all(req.params.id);
    const invoices = db.prepare(`SELECT * FROM invoices WHERE service_order_id = ? ORDER BY created_at DESC`).all(req.params.id);

    return res.json({ success: true, order, items, estimates, invoices });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/service-orders', adminGuard, [
  body('customer_id').isInt().withMessage('Customer is required'),
  body('vehicle_id').isInt().withMessage('Vehicle is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { customer_id, vehicle_id, mechanic_id, description, notes, estimated_completion, status } = req.body;
    const initialStatus = status || 'booking_received';

    const r = db.prepare(`
      INSERT INTO service_orders (customer_id, vehicle_id, mechanic_id, status, description, notes, estimated_completion)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(customer_id, vehicle_id, mechanic_id || null, initialStatus, description, notes || null, estimated_completion || null);

    const orderId = r.lastInsertRowid;

    createNotification({
      recipient_type: 'customer',
      recipient_id: customer_id,
      title: 'New Service Job Created',
      message: `Your motorcycle has a new service job: ${description}`,
      link: '/user/dashboard',
      type: 'info'
    });

    notifyCustomer(customer_id, 'service_status_updated', {
      orderId,
      status: initialStatus
    });

    logAudit({
      user_type: 'admin',
      user_id: req.user.id,
      action: 'create_service_order',
      entity_type: 'service_order',
      entity_id: orderId
    });

    return res.status(201).json({ success: true, message: 'Service order created.', id: orderId });
  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create service order.' });
  }
});

// Update 9-Stage Timeline Status (Real-time Socket.IO emission)
router.put('/service-orders/:id/status', adminGuard, (req, res) => {
  try {
    const { status, notes, inspection_notes, mechanic_id } = req.body;
    const order = db.prepare(`SELECT * FROM service_orders WHERE id = ?`).get(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Service order not found.' });

    const delivered_at = status === 'delivered' ? new Date().toISOString() : order.delivered_at;

    db.prepare(`
      UPDATE service_orders
      SET status = ?,
          notes = COALESCE(?, notes),
          inspection_notes = COALESCE(?, inspection_notes),
          mechanic_id = COALESCE(?, mechanic_id),
          delivered_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(status, notes || null, inspection_notes || null, mechanic_id || null, delivered_at, req.params.id);

    const stageTitles = {
      booking_received: 'Booking Received',
      vehicle_accepted: 'Vehicle Accepted',
      inspection_started: 'Inspection Started',
      estimate_generated: 'Estimate Generated',
      customer_approval: 'Customer Approval Requested',
      service_in_progress: 'Service In Progress',
      quality_inspection: 'Quality Inspection',
      ready_for_delivery: 'Ready for Delivery',
      delivered: 'Vehicle Delivered',
      cancelled: 'Service Cancelled'
    };

    const statusTitle = stageTitles[status] || status;

    // Send real-time notification to the customer
    createNotification({
      recipient_type: 'customer',
      recipient_id: order.customer_id,
      title: `Service Update: ${statusTitle}`,
      message: `Your bike service status has been updated to ${statusTitle}.`,
      link: '/user/dashboard',
      type: status === 'ready_for_delivery' || status === 'delivered' ? 'success' : 'info'
    });

    notifyCustomer(order.customer_id, 'service_status_updated', {
      orderId: order.id,
      status,
      statusTitle,
      updated_at: new Date().toISOString()
    });

    logAudit({
      user_type: 'admin',
      user_id: req.user.id,
      action: 'update_service_status',
      entity_type: 'service_order',
      entity_id: order.id,
      details: { from: order.status, to: status }
    });

    return res.json({ success: true, message: `Status updated to ${statusTitle}.` });
  } catch (err) {
    console.error('Update status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update service status.' });
  }
});

// ─── Estimate Management ──────────────────────────────────────────────────────
router.get('/estimates', adminGuard, (req, res) => {
  try {
    const estimates = db.prepare(`
      SELECT e.*,
             c.full_name as customer_name, c.email as customer_email,
             v.make, v.model, v.registration_number,
             so.description as service_description
      FROM estimates e
      LEFT JOIN customers c ON e.customer_id = c.id
      LEFT JOIN service_orders so ON e.service_order_id = so.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      ORDER BY e.created_at DESC
    `).all();
    return res.json({ success: true, estimates });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load estimates.' });
  }
});

router.post('/estimates', adminGuard, [
  body('service_order_id').isInt().withMessage('Service order ID is required'),
  body('customer_id').isInt().withMessage('Customer ID is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { service_order_id, customer_id, labour_charge = 0, discount = 0, tax_rate = 18.0, admin_notes, items = [] } = req.body;

    // Calculate subtotal from items
    let partsSubtotal = 0;
    for (const item of items) {
      partsSubtotal += (Number(item.quantity || 1) * Number(item.unit_price || 0));
    }

    const subtotal = partsSubtotal;
    const taxableAmount = subtotal + Number(labour_charge) - Number(discount);
    const taxAmount = (taxableAmount * (tax_rate / 100));
    const totalAmount = Math.max(0, taxableAmount + taxAmount);

    const r = db.prepare(`
      INSERT INTO estimates (service_order_id, customer_id, subtotal, labour_charge, tax_amount, discount, total_amount, status, admin_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)
    `).run(service_order_id, customer_id, subtotal, labour_charge, taxAmount, discount, totalAmount, admin_notes || null);

    const estimateId = r.lastInsertRowid;

    if (items.length > 0) {
      const insItem = db.prepare(`
        INSERT INTO estimate_items (estimate_id, item_type, part_id, description, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        const qty = Number(item.quantity || 1);
        const price = Number(item.unit_price || 0);
        insItem.run(estimateId, item.item_type || 'part', item.part_id || null, item.description, qty, price, qty * price);
      }
    }

    // Advance service order status to 'estimate_generated'
    db.prepare(`UPDATE service_orders SET status='estimate_generated', updated_at=datetime('now') WHERE id=?`).run(service_order_id);

    // Notify customer in real-time
    createNotification({
      recipient_type: 'customer',
      recipient_id: customer_id,
      title: 'New Service Estimate Ready for Approval',
      message: `An estimate of Rs. ${totalAmount.toFixed(2)} is ready for your review and approval.`,
      link: '/user/dashboard',
      type: 'warning'
    });

    notifyCustomer(customer_id, 'new_estimate_generated', {
      estimateId,
      totalAmount
    });

    return res.status(201).json({ success: true, message: 'Estimate created and sent to customer.', estimateId, totalAmount });
  } catch (err) {
    console.error('Create estimate error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create estimate.' });
  }
});

// ─── Invoice & Payment Management ─────────────────────────────────────────────
router.get('/invoices', adminGuard, (req, res) => {
  try {
    const invoices = db.prepare(`
      SELECT i.*,
             c.full_name as customer_name, c.email as customer_email,
             v.make, v.model, v.registration_number,
             so.description as service_description
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN service_orders so ON i.service_order_id = so.id
      LEFT JOIN vehicles v ON so.vehicle_id = v.id
      ORDER BY i.created_at DESC
    `).all();
    return res.json({ success: true, invoices });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load invoices.' });
  }
});

router.post('/invoices', adminGuard, [
  body('service_order_id').isInt().withMessage('Service order ID is required'),
  body('customer_id').isInt().withMessage('Customer ID is required'),
], async (req, res) => {
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
      console.error('PDF generation error:', e);
    }

    createNotification({
      recipient_type: 'customer',
      recipient_id: customer_id,
      title: 'Invoice Generated',
      message: `Invoice ${invoiceNumber} for Rs. ${total_amount.toFixed(2)} is now available.`,
      link: '/user/dashboard',
      type: 'info'
    });

    return res.status(201).json({ success: true, message: 'Invoice generated.', invoiceId, invoiceNumber, pdfUrl });
  } catch (err) {
    console.error('Generate invoice error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate invoice.' });
  }
});

// Payments
router.get('/payments', adminGuard, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.*,
             c.full_name as customer_name, c.email as customer_email,
             i.invoice_number, i.total_amount as invoice_total
      FROM payments p
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN invoices i ON p.invoice_id = i.id
      ORDER BY p.payment_date DESC
    `).all();
    return res.json({ success: true, payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load payments.' });
  }
});

router.post('/payments', adminGuard, [
  body('invoice_id').isInt().withMessage('Invoice is required'),
  body('amount').isNumeric().withMessage('Valid amount is required'),
  body('payment_method').isIn(['cash','card','upi','razorpay','bank_transfer']).withMessage('Valid payment method required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { invoice_id, amount, payment_method, transaction_id, notes } = req.body;
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoice_id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const receipt_number = `REC-${Date.now().toString().slice(-6)}`;

    const r = db.prepare(`
      INSERT INTO payments (invoice_id, customer_id, amount, payment_method, transaction_id, status, receipt_number, notes)
      VALUES (?, ?, ?, ?, ?, 'success', ?, ?)
    `).run(invoice_id, invoice.customer_id, amount, payment_method, transaction_id || null, receipt_number, notes || null);

    // Update invoice paid amount & status
    const newPaid = Number(invoice.paid_amount || 0) + Number(amount);
    const newStatus = newPaid >= invoice.total_amount ? 'paid' : 'partially_paid';

    db.prepare(`
      UPDATE invoices
      SET paid_amount = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newPaid, newStatus, invoice_id);

    // If fully paid, award loyalty points (1 point per 100 Rs)
    const pointsAwarded = Math.floor(amount / 100);
    if (pointsAwarded > 0) {
      db.prepare(`UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?`).run(pointsAwarded, invoice.customer_id);
    }

    createNotification({
      recipient_type: 'customer',
      recipient_id: invoice.customer_id,
      title: 'Payment Confirmed',
      message: `Your payment of Rs. ${amount} for invoice ${invoice.invoice_number} was received via ${payment_method.toUpperCase()}. Receipt: ${receipt_number}`,
      link: '/user/dashboard',
      type: 'success'
    });

    notifyCustomer(invoice.customer_id, 'payment_received', {
      invoiceId: invoice.id,
      amount,
      receipt_number,
      status: newStatus
    });

    return res.status(201).json({ success: true, message: 'Payment recorded successfully.', receipt_number });
  } catch (err) {
    console.error('Payment record error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record payment.' });
  }
});

// ─── Inventory Management ─────────────────────────────────────────────────────
router.get('/inventory', adminGuard, (req, res) => {
  try {
    const items = db.prepare(`SELECT * FROM inventory ORDER BY part_name ASC`).all();
    return res.json({ success: true, items });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load inventory.' });
  }
});

router.post('/inventory', adminGuard, [
  body('part_name').trim().notEmpty().withMessage('Part name is required'),
  body('quantity').isNumeric().withMessage('Quantity is required'),
  body('unit_price').isNumeric().withMessage('Cost price is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { part_name, part_number, category, quantity, unit_price, selling_price, min_stock_level, supplier_info } = req.body;
    const r = db.prepare(`
      INSERT INTO inventory (part_name, part_number, category, quantity, unit_price, selling_price, min_stock_level, supplier_info)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      part_name,
      part_number || null,
      category || 'Spares',
      quantity,
      unit_price,
      selling_price || unit_price * 1.25,
      min_stock_level || 5,
      supplier_info || null
    );

    const partId = r.lastInsertRowid;

    // Log initial stock transaction
    db.prepare(`
      INSERT INTO inventory_transactions (part_id, type, quantity, reference_type, notes)
      VALUES (?, 'in', ?, 'purchase', 'Initial stock entry')
    `).run(partId, quantity);

    return res.status(201).json({ success: true, message: 'Inventory item added.', id: partId });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to add inventory item.' });
  }
});

router.put('/inventory/:id', adminGuard, (req, res) => {
  try {
    const { part_name, part_number, category, quantity, unit_price, selling_price, min_stock_level, supplier_info } = req.body;
    db.prepare(`
      UPDATE inventory
      SET part_name = COALESCE(?, part_name),
          part_number = COALESCE(?, part_number),
          category = COALESCE(?, category),
          quantity = COALESCE(?, quantity),
          unit_price = COALESCE(?, unit_price),
          selling_price = COALESCE(?, selling_price),
          min_stock_level = COALESCE(?, min_stock_level),
          supplier_info = COALESCE(?, supplier_info),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      part_name || null,
      part_number || null,
      category || null,
      quantity !== undefined ? quantity : null,
      unit_price !== undefined ? unit_price : null,
      selling_price !== undefined ? selling_price : null,
      min_stock_level !== undefined ? min_stock_level : null,
      supplier_info || null,
      req.params.id
    );

    return res.json({ success: true, message: 'Inventory updated.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update item.' });
  }
});

router.delete('/inventory/:id', adminGuard, (req, res) => {
  try {
    db.prepare(`DELETE FROM inventory WHERE id = ?`).run(req.params.id);
    return res.json({ success: true, message: 'Inventory item deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete item.' });
  }
});

// ─── Mechanics Management ─────────────────────────────────────────────────────
router.get('/mechanics', adminGuard, (req, res) => {
  try {
    const mechanics = db.prepare(`
      SELECT m.*,
             (SELECT COUNT(*) FROM service_orders WHERE mechanic_id = m.id AND status NOT IN ('delivered','cancelled')) as active_jobs,
             (SELECT COUNT(*) FROM service_orders WHERE mechanic_id = m.id AND status = 'delivered') as completed_jobs
      FROM mechanics m
      ORDER BY m.full_name ASC
    `).all();
    return res.json({ success: true, mechanics });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load mechanics.' });
  }
});

router.post('/mechanics', adminGuard, [
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { full_name, mobile, email, specialization } = req.body;
    const r = db.prepare(`
      INSERT INTO mechanics (full_name, mobile, email, specialization)
      VALUES (?, ?, ?, ?)
    `).run(full_name, mobile || null, email || null, specialization || 'General Mechanic');

    return res.status(201).json({ success: true, message: 'Mechanic profile created.', id: r.lastInsertRowid });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to create mechanic.' });
  }
});

router.put('/mechanics/:id', adminGuard, (req, res) => {
  try {
    const { full_name, mobile, email, specialization, is_active } = req.body;
    db.prepare(`
      UPDATE mechanics
      SET full_name = COALESCE(?, full_name),
          mobile = COALESCE(?, mobile),
          email = COALESCE(?, email),
          specialization = COALESCE(?, specialization),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      full_name || null,
      mobile || null,
      email || null,
      specialization || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id
    );

    return res.json({ success: true, message: 'Mechanic profile updated.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update mechanic.' });
  }
});

// ─── Service Reminders ────────────────────────────────────────────────────────
router.get('/reminders', adminGuard, (req, res) => {
  try {
    const reminders = db.prepare(`
      SELECT sr.*,
             c.full_name as customer_name, c.mobile as customer_mobile, c.email as customer_email,
             v.make, v.model, v.registration_number
      FROM service_reminders sr
      LEFT JOIN customers c ON sr.customer_id = c.id
      LEFT JOIN vehicles v ON sr.vehicle_id = v.id
      ORDER BY sr.due_date ASC
    `).all();
    return res.json({ success: true, reminders });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load reminders.' });
  }
});

router.post('/reminders', adminGuard, [
  body('customer_id').isInt().withMessage('Customer is required'),
  body('vehicle_id').isInt().withMessage('Vehicle is required'),
  body('reminder_type').trim().notEmpty().withMessage('Reminder type is required'),
  body('due_date').notEmpty().withMessage('Due date is required'),
], (req, res) => {
  if (handleValidation(req, res)) return;

  try {
    const { customer_id, vehicle_id, reminder_type, due_date, notes } = req.body;
    const r = db.prepare(`
      INSERT INTO service_reminders (customer_id, vehicle_id, reminder_type, due_date, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(customer_id, vehicle_id, reminder_type, due_date, notes || null);

    createNotification({
      recipient_type: 'customer',
      recipient_id: customer_id,
      title: 'Upcoming Service Reminder',
      message: `Your vehicle is scheduled for ${reminder_type} on ${due_date}.`,
      link: '/user/dashboard',
      type: 'warning'
    });

    return res.status(201).json({ success: true, message: 'Reminder set successfully.', id: r.lastInsertRowid });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to set reminder.' });
  }
});

// ─── Reports & Analytics ──────────────────────────────────────────────────────
router.get('/reports/revenue', adminGuard, (req, res) => {
  try {
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', payment_date) as month,
             COALESCE(SUM(amount), 0) as revenue,
             COUNT(*) as transactions
      FROM payments
      WHERE status = 'success'
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all();

    const daily = db.prepare(`
      SELECT date(payment_date) as day,
             COALESCE(SUM(amount), 0) as revenue
      FROM payments
      WHERE status = 'success' AND date(payment_date) >= date('now', '-30 days')
      GROUP BY day
      ORDER BY day ASC
    `).all();

    const brandDemand = db.prepare(`
      SELECT v.make as brand, COUNT(so.id) as service_count
      FROM service_orders so
      JOIN vehicles v ON so.vehicle_id = v.id
      GROUP BY brand
      ORDER BY service_count DESC
      LIMIT 6
    `).all();

    const mechanicPerformance = db.prepare(`
      SELECT m.full_name, COUNT(so.id) as completed_jobs
      FROM service_orders so
      JOIN mechanics m ON so.mechanic_id = m.id
      WHERE so.status = 'delivered'
      GROUP BY m.id
      ORDER BY completed_jobs DESC
    `).all();

    return res.json({
      success: true,
      monthly,
      daily,
      brandDemand,
      mechanicPerformance
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to generate reports.' });
  }
});

// ─── Support Tickets ──────────────────────────────────────────────────────────
router.get('/tickets', adminGuard, (req, res) => {
  try {
    const tickets = db.prepare(`
      SELECT t.*, c.full_name as customer_name, c.email as customer_email, c.mobile as customer_mobile
      FROM support_tickets t
      LEFT JOIN customers c ON t.customer_id = c.id
      ORDER BY t.created_at DESC
    `).all();
    return res.json({ success: true, tickets });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load tickets.' });
  }
});

router.put('/tickets/:id', adminGuard, (req, res) => {
  try {
    const { status, reply } = req.body;
    const ticket = db.prepare(`SELECT * FROM support_tickets WHERE id = ?`).get(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    let msgList = [];
    try {
      msgList = ticket.messages ? JSON.parse(ticket.messages) : [];
    } catch(e) {}

    if (reply) {
      msgList.push({
        sender: 'admin',
        text: reply,
        time: new Date().toISOString()
      });
    }

    db.prepare(`
      UPDATE support_tickets
      SET status = COALESCE(?, status), messages = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status || null, JSON.stringify(msgList), req.params.id);

    if (reply) {
      createNotification({
        recipient_type: 'customer',
        recipient_id: ticket.customer_id,
        title: 'New Reply to Support Ticket',
        message: `Garage support replied: "${reply.slice(0, 50)}..."`,
        link: '/user/dashboard',
        type: 'info'
      });
    }

    return res.json({ success: true, message: 'Ticket updated.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update ticket.' });
  }
});

module.exports = router;
