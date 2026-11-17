require('dotenv').config();

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initSocket } = require('./backend/utils/socket.utils');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ─── Socket.IO Setup ──────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  }
});
initSocket(io);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for inline styles/scripts in local dark UI
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/admin/login', authLimiter);
app.use('/api/auth/customer/login', authLimiter);

// ─── API Routes ───────────────────────────────────────────────────────────────
const authRoutes     = require('./backend/routes/auth.routes');
const adminRoutes    = require('./backend/routes/admin.routes');
const customerRoutes = require('./backend/routes/customer.routes');
const vehicleRoutes  = require('./backend/routes/vehicle.routes');
const serviceRoutes  = require('./backend/routes/service.routes');
const invoiceRoutes  = require('./backend/routes/invoice.routes');
const paymentRoutes  = require('./backend/routes/payment.routes');

app.use('/api/auth',           authRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/customer',       customerRoutes);
app.use('/api/vehicles',       vehicleRoutes);
app.use('/api/service-orders', serviceRoutes);
app.use('/api/services',       serviceRoutes);
app.use('/api/invoices',       invoiceRoutes);
app.use('/api/payments',       paymentRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    platform: 'Kannada Riders Garage 14',
    status: 'ONLINE',
    realtime: 'Socket.IO Active',
    timestamp: new Date().toISOString()
  });
});

// ─── Static Files & Uploads ───────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Direct URL Routes ────────────────────────────────────────────────────────
// Admin Portal Pages
app.use('/admin', (req, res) => {
  if (req.path === '' || req.path === '/' || req.path === '/login') {
    return res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
  }
  return res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});

// Customer Portal Pages
app.use('/user', (req, res) => {
  if (req.path === '' || req.path === '/' || req.path === '/login') {
    return res.sendFile(path.join(__dirname, 'public', 'user', 'login.html'));
  }
  if (req.path === '/register') {
    return res.sendFile(path.join(__dirname, 'public', 'user', 'register.html'));
  }
  return res.sendFile(path.join(__dirname, 'public', 'user', 'dashboard.html'));
});

// Home Landing Page
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found.' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), err => {
    if (err) res.status(404).send('Page not found.');
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server unhandled error:', err);
  res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  🏍️  KANNADA RIDERS GARAGE 14 — PLATFORM ONLINE');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`  🌐 Website URL        : http://localhost:${PORT}`);
    console.log(`  🛡️  Admin Portal       : http://localhost:${PORT}/admin/login`);
    console.log(`  👤 Customer Portal    : http://localhost:${PORT}/user/login`);
    console.log(`  ⚡ Real-Time Socket   : ws://localhost:${PORT}`);
    console.log(`  🗄️  Central Database   : SQLite (${process.env.DB_PATH || './garage.db'})`);
    console.log(`  🌱 Seed Admin Account : node backend/utils/seed.js`);
    console.log('════════════════════════════════════════════════════════════\n');
  });
}

module.exports = { app, server };
