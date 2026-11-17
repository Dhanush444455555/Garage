require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../database/db');

async function seed() {
  console.log('\n🌱 Seeding Kannada Riders Garage 14 database...\n');

  const username  = 'admin';
  const email     = 'admin@kannadariders.com';
  const password  = 'Admin@123';
  const full_name = 'Super Admin';

  // Check if admin already exists
  const existing = db.prepare(`SELECT id FROM admins WHERE email = ? OR username = ?`).get(email, username);
  if (existing) {
    console.log('⚠️  Admin account already exists. Skipping seed.\n');
    console.log('────────────────────────────────────────────');
    console.log('  Admin Login URL : http://localhost:3000/admin/login');
    console.log('  Username        :', username);
    console.log('  Email           :', email);
    console.log('  Password        :', password);
    console.log('────────────────────────────────────────────\n');
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(password, 12);

  db.prepare(`INSERT INTO admins (username, email, password_hash, full_name) VALUES (?, ?, ?, ?)`)
    .run(username, email, password_hash, full_name);

  console.log('✅  Admin account created successfully!\n');
  console.log('════════════════════════════════════════════');
  console.log('  KANNADA RIDERS GARAGE 14 — ADMIN CREDENTIALS');
  console.log('════════════════════════════════════════════');
  console.log('  Admin Login URL : http://localhost:3000/admin/login');
  console.log('  Username        :', username);
  console.log('  Email           :', email);
  console.log('  Password        :', password);
  console.log('════════════════════════════════════════════');
  console.log('\n⚠️  IMPORTANT: Change the default password after first login!\n');

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});

