const { authenticate } = require('./auth.middleware');

/**
 * Admin-only middleware.
 * Must be used AFTER authenticate.
 */
function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
}

module.exports = [authenticate, adminOnly];

