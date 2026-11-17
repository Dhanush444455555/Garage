-- ==============================================================================
-- KANNADA RIDERS GARAGE 14 — Centralized Database Schema (Production Ready)
-- Dialect: SQLite / PostgreSQL compatible
-- ==============================================================================

-- 1. Admins
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'admin',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Staff
CREATE TABLE IF NOT EXISTS staff (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'staff',
  phone         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 3. Customers
CREATE TABLE IF NOT EXISTS customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT    NOT NULL,
  email           TEXT    NOT NULL UNIQUE,
  mobile          TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  profile_image   TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  email_verified  INTEGER NOT NULL DEFAULT 1,
  mobile_verified INTEGER NOT NULL DEFAULT 1,
  loyalty_points  INTEGER NOT NULL DEFAULT 0,
  internal_notes  TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 4. Login History
CREATE TABLE IF NOT EXISTS login_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type   TEXT    NOT NULL,
  user_id     INTEGER NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  login_time  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 5. Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  make                TEXT    NOT NULL,
  model               TEXT    NOT NULL,
  year                INTEGER,
  registration_number TEXT    NOT NULL,
  color               TEXT,
  vin                 TEXT,
  fuel_type           TEXT    DEFAULT 'Petrol',
  odometer_reading    INTEGER DEFAULT 0,
  photo_url           TEXT,
  notes               TEXT,
  next_service_due    TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 6. Vehicle Documents
CREATE TABLE IF NOT EXISTS vehicle_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type    TEXT    NOT NULL,
  file_name   TEXT    NOT NULL,
  file_url    TEXT    NOT NULL,
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 7. Mechanics
CREATE TABLE IF NOT EXISTS mechanics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  mobile         TEXT,
  email          TEXT,
  specialization TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 8. Service Bookings (Online Booking)
CREATE TABLE IF NOT EXISTS service_bookings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id          INTEGER NOT NULL REFERENCES vehicles(id),
  service_type        TEXT    NOT NULL,
  problem_description TEXT,
  preferred_date      TEXT    NOT NULL,
  preferred_time      TEXT,
  pickup_drop         TEXT    DEFAULT 'no_pickup',
  address             TEXT,
  status              TEXT    NOT NULL DEFAULT 'pending',
  media_urls          TEXT,
  internal_notes      TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 9. Service Orders (Live 9-step tracking)
CREATE TABLE IF NOT EXISTS service_orders (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id           INTEGER REFERENCES service_bookings(id),
  customer_id          INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id           INTEGER NOT NULL REFERENCES vehicles(id),
  mechanic_id          INTEGER REFERENCES mechanics(id),
  status               TEXT NOT NULL DEFAULT 'booking_received',
  description          TEXT,
  notes                TEXT,
  inspection_notes     TEXT,
  inspection_images    TEXT,
  estimated_completion TEXT,
  delivered_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. Service Items (Parts & Labour Breakdown)
CREATE TABLE IF NOT EXISTS service_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  service_order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  item_type        TEXT    NOT NULL DEFAULT 'part',
  description      TEXT    NOT NULL,
  quantity         REAL    NOT NULL DEFAULT 1,
  unit_price       REAL    NOT NULL DEFAULT 0,
  total_price      REAL    NOT NULL DEFAULT 0
);

-- 11. Estimates
CREATE TABLE IF NOT EXISTS estimates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  service_order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  version          INTEGER NOT NULL DEFAULT 1,
  subtotal         REAL    NOT NULL DEFAULT 0,
  labour_charge    REAL    NOT NULL DEFAULT 0,
  tax_amount       REAL    NOT NULL DEFAULT 0,
  discount         REAL    NOT NULL DEFAULT 0,
  total_amount     REAL    NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'pending_approval',
  customer_notes   TEXT,
  admin_notes      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 12. Estimate Items
CREATE TABLE IF NOT EXISTS estimate_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id      INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  item_type        TEXT    NOT NULL DEFAULT 'part',
  part_id          INTEGER REFERENCES inventory(id),
  description      TEXT    NOT NULL,
  quantity         REAL    NOT NULL DEFAULT 1,
  unit_price       REAL    NOT NULL DEFAULT 0,
  total_price      REAL    NOT NULL DEFAULT 0
);

-- 13. Estimate Approvals (Audit decision trail)
CREATE TABLE IF NOT EXISTS estimate_approvals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  decision    TEXT    NOT NULL,
  comments    TEXT,
  decided_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 14. Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number   TEXT    NOT NULL UNIQUE,
  service_order_id INTEGER NOT NULL REFERENCES service_orders(id),
  estimate_id      INTEGER REFERENCES estimates(id),
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  subtotal         REAL    NOT NULL DEFAULT 0,
  labour_charge    REAL    NOT NULL DEFAULT 0,
  tax_rate         REAL    NOT NULL DEFAULT 18.0,
  tax_amount       REAL    NOT NULL DEFAULT 0,
  discount         REAL    NOT NULL DEFAULT 0,
  total_amount     REAL    NOT NULL DEFAULT 0,
  paid_amount      REAL    NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'sent',
  issued_date      TEXT    NOT NULL DEFAULT (date('now')),
  due_date         TEXT,
  pdf_url          TEXT,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 15. Invoice Items
CREATE TABLE IF NOT EXISTS invoice_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type   TEXT    NOT NULL DEFAULT 'part',
  description TEXT    NOT NULL,
  quantity    REAL    NOT NULL DEFAULT 1,
  unit_price  REAL    NOT NULL DEFAULT 0,
  total_price REAL    NOT NULL DEFAULT 0
);

-- 16. Payments
CREATE TABLE IF NOT EXISTS payments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id           INTEGER NOT NULL REFERENCES invoices(id),
  customer_id          INTEGER NOT NULL REFERENCES customers(id),
  amount               REAL    NOT NULL,
  payment_method       TEXT    NOT NULL DEFAULT 'cash',
  transaction_id       TEXT,
  razorpay_order_id    TEXT,
  razorpay_payment_id  TEXT,
  razorpay_signature   TEXT,
  status               TEXT    NOT NULL DEFAULT 'success',
  receipt_number       TEXT,
  payment_date         TEXT    NOT NULL DEFAULT (datetime('now')),
  notes                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 17. Payment Transactions
CREATE TABLE IF NOT EXISTS payment_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  INTEGER REFERENCES payments(id),
  gateway     TEXT    NOT NULL DEFAULT 'razorpay',
  raw_payload TEXT,
  status      TEXT    NOT NULL DEFAULT 'received',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 18. Inventory
CREATE TABLE IF NOT EXISTS inventory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  part_name       TEXT    NOT NULL,
  part_number     TEXT,
  category        TEXT,
  quantity        REAL    NOT NULL DEFAULT 0,
  unit_price      REAL    NOT NULL DEFAULT 0,
  selling_price   REAL    NOT NULL DEFAULT 0,
  min_stock_level REAL    NOT NULL DEFAULT 5,
  supplier_info   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 19. Inventory Transactions
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id        INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  type           TEXT    NOT NULL,
  quantity       REAL    NOT NULL,
  reference_type TEXT,
  reference_id   INTEGER,
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 20. Service History
CREATE TABLE IF NOT EXISTS service_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id       INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_order_id INTEGER REFERENCES service_orders(id),
  service_date     TEXT    NOT NULL DEFAULT (date('now')),
  mileage          INTEGER DEFAULT 0,
  description      TEXT    NOT NULL,
  total_cost       REAL    NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 21. Service Reminders
CREATE TABLE IF NOT EXISTS service_reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id),
  reminder_type TEXT    NOT NULL,
  due_date      TEXT    NOT NULL,
  notes         TEXT,
  is_sent       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 22. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT    NOT NULL DEFAULT 'customer',
  recipient_id   INTEGER NOT NULL,
  title          TEXT    NOT NULL,
  message        TEXT    NOT NULL,
  link           TEXT,
  type           TEXT    DEFAULT 'info',
  is_read        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 23. Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  subject      TEXT    NOT NULL,
  category     TEXT    DEFAULT 'general',
  priority     TEXT    DEFAULT 'normal',
  status       TEXT    NOT NULL DEFAULT 'open',
  messages     TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 24. Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  service_order_id INTEGER REFERENCES service_orders(id),
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  rating           INTEGER NOT NULL,
  feedback         TEXT,
  is_public        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 25. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type    TEXT    NOT NULL,
  user_id      INTEGER,
  action       TEXT    NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  details      TEXT,
  ip_address   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
