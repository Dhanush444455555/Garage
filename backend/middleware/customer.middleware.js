const { authenticate } = require('./auth.middleware');

/**
 * Customer-only middleware.
 * Must be used AFTER authenticate.
 */
function customerOnly(req, res, next) {
  if (req.user && req.user.role === 'customer') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied. Customer portal only.' });
}

module.exports = [authenticate, customerOnly];

