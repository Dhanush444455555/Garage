const db = require('../database/db');
const { notifyAdmin, notifyCustomer } = require('./socket.utils');

function createNotification({ recipient_type = 'customer', recipient_id, title, message, link = '', type = 'info' }) {
  try {
    const result = db.prepare(`
      INSERT INTO notifications (recipient_type, recipient_id, title, message, link, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(recipient_type, recipient_id, title, message, link, type);

    const notification = {
      id: result.lastInsertRowid,
      recipient_type,
      recipient_id,
      title,
      message,
      link,
      type,
      is_read: 0,
      created_at: new Date().toISOString()
    };

    if (recipient_type === 'admin') {
      notifyAdmin('new_notification', notification);
    } else {
      notifyCustomer(recipient_id, 'new_notification', notification);
    }

    return notification;
  } catch (err) {
    console.error('Failed to create notification:', err);
    return null;
  }
}

module.exports = { createNotification };
