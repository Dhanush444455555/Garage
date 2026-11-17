const db = require('../database/db');

function logAudit({ user_type = 'system', user_id = null, action, entity_type = null, entity_id = null, details = null, ip_address = null }) {
  try {
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : (details || null);
    db.prepare(`
      INSERT INTO audit_logs (user_type, user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user_type, user_id, action, entity_type, entity_id, detailsStr, ip_address);
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

module.exports = { logAudit };
