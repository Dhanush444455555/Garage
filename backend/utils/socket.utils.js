let ioInstance = null;

function initSocket(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    // Client joins room based on role & ID
    socket.on('join_portal', (data) => {
      if (!data) return;
      if (data.role === 'admin') {
        socket.join('admin_room');
      } else if (data.role === 'customer' && data.customerId) {
        socket.join(`customer_${data.customerId}`);
      }
    });

    socket.on('disconnect', () => {
      // Clean disconnect
    });
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

// Helpers for targeted emissions
function notifyAdmin(event, payload) {
  if (ioInstance) {
    ioInstance.to('admin_room').emit(event, payload);
  }
}

function notifyCustomer(customerId, event, payload) {
  if (ioInstance) {
    ioInstance.to(`customer_${customerId}`).emit(event, payload);
  }
}

function broadcastEvent(event, payload) {
  if (ioInstance) {
    ioInstance.emit(event, payload);
  }
}

module.exports = {
  initSocket,
  getIO,
  notifyAdmin,
  notifyCustomer,
  broadcastEvent
};
