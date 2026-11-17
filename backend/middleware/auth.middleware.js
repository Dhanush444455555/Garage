const { verifyToken } = require('../utils/jwt.utils');

/**
 * Verifies the JWT from the HTTP-only cookie.
 * Attaches req.user = { id, role, email/username }.
 */
function authenticate(req, res, next) {
  try {
    const token = req.cookies && req.cookies.auth_token;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
    }
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Session expired or invalid. Please log in again.' });
  }
}

module.exports = { authenticate };

