const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'recur_sms.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance concurrent operations
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'STAFF', 'CUSTOMER')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS staff_whitelist (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      added_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      sales_price REAL NOT NULL,
      cost_price REAL NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      price_adjustment REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cost REAL NOT NULL,
      billing_interval TEXT NOT NULL CHECK(billing_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
      min_quantity INTEGER NOT NULL DEFAULT 1,
      available_from DATE,
      available_to DATE,
      auto_close_on_end INTEGER NOT NULL DEFAULT 0,
      allow_early_close INTEGER NOT NULL DEFAULT 1,
      allow_pause INTEGER NOT NULL DEFAULT 1,
      allow_renewal INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotation_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plan_id TEXT,
      validity_days INTEGER NOT NULL DEFAULT 15,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS quotation_template_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (template_id) REFERENCES quotation_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (variant_id) REFERENCES product_variants(id)
    );

    CREATE TABLE IF NOT EXISTS tax_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rate_percentage REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL COLLATE NOCASE,
      discount_type TEXT NOT NULL CHECK(discount_type IN ('FIXED', 'PERCENTAGE')),
      value REAL NOT NULL,
      min_purchase_amount REAL DEFAULT 0,
      min_quantity INTEGER DEFAULT 0,
      valid_from DATE,
      valid_until DATE,
      max_usage_limit INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      scope TEXT NOT NULL CHECK(scope IN ('SUBSCRIPTION', 'PRODUCT')),
      target_product_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (target_product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      subscription_number TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Draft', 'Quotation', 'Confirmed', 'Active', 'Closed')) DEFAULT 'Draft',
      start_date DATE,
      expiry_date DATE,
      next_billing_date DATE,
      last_invoiced_date DATE,
      payment_terms TEXT DEFAULT 'Immediate',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS subscription_items (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      tax_rate REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (variant_id) REFERENCES product_variants(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      subscription_id TEXT,
      customer_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Draft', 'Confirmed', 'Paid', 'Cancelled')) DEFAULT 'Draft',
      issue_date DATE NOT NULL,
      due_date DATE NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_total REAL NOT NULL DEFAULT 0,
      tax_total REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      billing_cycle_start DATE,
      billing_cycle_end DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
      FOREIGN KEY (customer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('QR', 'UPI', 'NETBANKING', 'CARD')),
      amount REAL NOT NULL,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      transaction_reference TEXT,
      note TEXT,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS billing_batch_logs (
      id TEXT PRIMARY KEY,
      run_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      invoices_created INTEGER NOT NULL DEFAULT 0,
      total_billed REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      details TEXT
    );

    -- Indexes for sub-2-second query performance and zero-double-billing lookups
    CREATE INDEX IF NOT EXISTS idx_subs_billing ON subscriptions(status, next_billing_date);
    CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id, status);
    CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id, status);
    CREATE INDEX IF NOT EXISTS idx_inv_finance ON invoices(status, issue_date, due_date);
    CREATE INDEX IF NOT EXISTS idx_inv_sub_cycle ON invoices(subscription_id, billing_cycle_start, billing_cycle_end);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
  `);

  // Ensure designated Admin user exists
  const adminEmail = 'ashishsunil4160@gmail.com';
  const existingAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);
  if (!existingAdmin) {
    const defaultPasswordHash = bcrypt.hashSync('Admin@12345', 10);
    db.prepare(`
      INSERT INTO users (id, email, password_hash, role)
      VALUES (?, ?, ?, 'ADMIN')
    `).run('usr_admin_001', adminEmail, defaultPasswordHash);
    console.log(`[Database] Initialized designated Admin: ${adminEmail}`);
  }
}

initSchema();

module.exports = db;
