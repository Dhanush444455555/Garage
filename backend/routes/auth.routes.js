const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { signToken, setCookieToken, clearCookie } = require('../utils/jwt.utils');
const { authenticate } = require('../middleware/auth.middleware');
const { logAudit } = require('../utils/audit.utils');
const upload = require('../utils/upload.utils');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
  }
  return null;
}

// ─── Admin Login ─────────────────────────────────────────────────────────────
router.post(
  '/admin/login',
  [
    body('identifier').trim().notEmpty().withMessage('Email or username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    try {
      const { identifier, password } = req.body;

      const admin = db
        .prepare(`SELECT * FROM admins WHERE (email = ? OR username = ?) AND is_active = 1`)
        .get(identifier, identifier);

      if (!admin) {
        return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
      }

      const match = await bcrypt.compare(password, admin.password_hash);
      if (!match) {
        return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
      }

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      const ua = req.headers['user-agent'] || '';

      db.prepare(`
        INSERT INTO login_history (user_type, user_id, ip_address, user_agent)
        VALUES ('admin', ?, ?, ?)
      `).run(admin.id, ip, ua);

      logAudit({
        user_type: 'admin',
        user_id: admin.id,
        action: 'admin_login',
        ip_address: ip,
        details: { username: admin.username }
      });

      const token = signToken({
        id: admin.id,
        role: 'admin',
        email: admin.email,
        username: admin.username,
        full_name: admin.full_name
      });

      setCookieToken(res, token);

      return res.json({
        success: true,
        message: 'Admin login successful.',
        user: { id: admin.id, full_name: admin.full_name, email: admin.email, role: 'admin' },
        redirect: '/admin/dashboard',
      });
    } catch (err) {
      console.error('Admin login error:', err);
      return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
  }
);

// ─── Customer Register ───────────────────────────────────────────────────────
router.post(
  '/customer/register',
  [
    body('full_name').trim().notEmpty().withMessage('Full name is required').isLength({ min: 2, max: 100 }),
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('mobile')
      .trim()
      .notEmpty()
      .withMessage('Mobile number is required')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Enter a valid 10-digit Indian mobile number'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('confirm_password').custom((value, { req }) => {
      if (value !== req.body.password) throw new Error('Passwords do not match');
      return true;
    }),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    try {
      const { full_name, email, mobile, password } = req.body;

      const existing = db
        .prepare(`SELECT id, email, mobile FROM customers WHERE email = ? OR mobile = ?`)
        .get(email, mobile);

      if (existing) {
        const field = existing.email === email ? 'Email' : 'Mobile number';
        return res.status(409).json({ success: false, message: `${field} is already registered.` });
      }

      const password_hash = await bcrypt.hash(password, 12);

      const result = db
        .prepare(`INSERT INTO customers (full_name, email, mobile, password_hash) VALUES (?, ?, ?, ?)`)
        .run(full_name, email, mobile, password_hash);

      const customerId = result.lastInsertRowid;

      logAudit({
        user_type: 'customer',
        user_id: customerId,
        action: 'customer_register',
        details: { email, mobile }
      });

      return res.status(201).json({
        success: true,
        message: 'Registration successful! You can now log in.',
        customerId,
        redirect: '/user/login',
      });
    } catch (err) {
      console.error('Customer register error:', err);
      return res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
  }
);

// ─── Customer Login ──────────────────────────────────────────────────────────
router.post(
  '/customer/login',
  [
    body('identifier').trim().notEmpty().withMessage('Email or mobile number is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    try {
      const { identifier, password } = req.body;

      const customer = db
        .prepare(`SELECT * FROM customers WHERE (email = ? OR mobile = ?) AND is_active = 1`)
        .get(identifier, identifier);

      if (!customer) {
        return res.status(401).json({ success: false, message: 'Invalid email/mobile or password.' });
      }

      const match = await bcrypt.compare(password, customer.password_hash);
      if (!match) {
        return res.status(401).json({ success: false, message: 'Invalid email/mobile or password.' });
      }

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      const ua = req.headers['user-agent'] || '';

      db.prepare(`
        INSERT INTO login_history (user_type, user_id, ip_address, user_agent)
        VALUES ('customer', ?, ?, ?)
      `).run(customer.id, ip, ua);

      logAudit({
        user_type: 'customer',
        user_id: customer.id,
        action: 'customer_login',
        ip_address: ip
      });

      const token = signToken({
        id: customer.id,
        role: 'customer',
        email: customer.email,
        full_name: customer.full_name
      });

      setCookieToken(res, token);

      return res.json({
        success: true,
        message: 'Login successful.',
        user: {
          id: customer.id,
          full_name: customer.full_name,
          email: customer.email,
          mobile: customer.mobile,
          profile_image: customer.profile_image,
          loyalty_points: customer.loyalty_points,
          role: 'customer'
        },
        redirect: '/user/dashboard',
      });
    } catch (err) {
      console.error('Customer login error:', err);
      return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
  }
);

// ─── Logout ──────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearCookie(res);
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// ─── Current User ────────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  try {
    const { role, id } = req.user;
    if (role === 'admin') {
      const admin = db.prepare(`SELECT id, username, email, full_name, role FROM admins WHERE id = ?`).get(id);
      if (!admin) return res.status(401).json({ success: false, message: 'User not found.' });
      return res.json({ success: true, user: { ...admin, role: 'admin' }, role: 'admin' });
    } else {
      const customer = db.prepare(`
        SELECT id, full_name, email, mobile, profile_image, loyalty_points, email_verified, mobile_verified, created_at
        FROM customers WHERE id = ? AND is_active = 1
      `).get(id);
      if (!customer) return res.status(401).json({ success: false, message: 'User not found.' });
      return res.json({ success: true, user: { ...customer, role: 'customer' }, role: 'customer' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Change Password ─────────────────────────────────────────────────────────
router.post(
  '/change-password',
  authenticate,
  [
    body('current_password').notEmpty().withMessage('Current password is required'),
    body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    try {
      const { current_password, new_password } = req.body;
      const { role, id } = req.user;

      const table = role === 'admin' ? 'admins' : 'customers';
      const user = db.prepare(`SELECT id, password_hash FROM ${table} WHERE id = ?`).get(id);

      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

      const match = await bcrypt.compare(current_password, user.password_hash);
      if (!match) return res.status(400).json({ success: false, message: 'Incorrect current password.' });

      const newHash = await bcrypt.hash(new_password, 12);
      db.prepare(`UPDATE ${table} SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(newHash, id);

      logAudit({
        user_type: role,
        user_id: id,
        action: 'password_change'
      });

      return res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to change password.' });
    }
  }
);

// ─── Forgot Password / Reset Request ─────────────────────────────────────────
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
], (req, res) => {
  if (handleValidation(req, res)) return;
  const { email } = req.body;

  const customer = db.prepare(`SELECT id, full_name FROM customers WHERE email = ? AND is_active = 1`).get(email);
  if (!customer) {
    return res.json({ success: true, message: 'If that email exists in our records, password reset instructions have been dispatched.' });
  }

  // Temporary direct reset demo helper: allows setting temp password or generating token
  return res.json({
    success: true,
    message: 'Password reset link sent to your email. (In demo mode, contact garage support at +91 98765 43210 for an instant reset).'
  });
});

// ─── Upload Profile Photo ────────────────────────────────────────────────────
router.post('/profile-photo', authenticate, upload.single('profile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded.' });
    const photoUrl = `/uploads/profiles/${req.file.filename}`;

    if (req.user.role === 'customer') {
      db.prepare(`UPDATE customers SET profile_image = ?, updated_at = datetime('now') WHERE id = ?`).run(photoUrl, req.user.id);
    }

    return res.json({ success: true, message: 'Profile photo updated.', photoUrl });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update profile photo.' });
  }
});

// ─── Login History ───────────────────────────────────────────────────────────
router.get('/login-history', authenticate, (req, res) => {
  try {
    const history = db.prepare(`
      SELECT ip_address, user_agent, login_time
      FROM login_history
      WHERE user_type = ? AND user_id = ?
      ORDER BY login_time DESC
      LIMIT 10
    `).all(req.user.role, req.user.id);

    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve login history.' });
  }
});

module.exports = router;
