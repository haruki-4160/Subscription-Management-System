const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');

function seedDatabase() {
  console.log('[Seed] Seeding RECUR SMS initial baseline data...');

  // Ensure Admin exists
  const adminEmail = 'ashishsunil4160@gmail.com';
  const adminHash = bcrypt.hashSync('Admin@12345', 10);
  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, role)
    VALUES ('usr_admin_001', ?, ?, 'ADMIN')
  `).run(adminEmail, adminHash);

  // Seed Staff
  const staffEmail = 'staff.sarah@recursms.com';
  const staffHash = bcrypt.hashSync('Staff@12345', 10);
  db.prepare('INSERT OR REPLACE INTO staff_whitelist (email, added_by) VALUES (?, ?)').run(staffEmail, adminEmail);
  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, role)
    VALUES ('usr_staff_001', ?, ?, 'STAFF')
  `).run(staffEmail, staffHash);

  // Seed Customers
  const cust1Email = 'corner.grocery@store.com';
  const cust2Email = 'acme.enterprises@global.com';
  const custHash = bcrypt.hashSync('Customer@12345', 10);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, role)
    VALUES ('usr_cust_001', ?, ?, 'CUSTOMER')
  `).run(cust1Email, custHash);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, role)
    VALUES ('usr_cust_002', ?, ?, 'CUSTOMER')
  `).run(cust2Email, custHash);

  // Seed Products with Variants (including Odoo +560)
  const prod1Id = 'prod_suite_01';
  db.prepare(`
    INSERT OR REPLACE INTO products (id, name, type, sales_price, cost_price, notes)
    VALUES (?, 'Business Cloud Suite', 'Service', 1200.00, 450.00, 'Core SaaS platform')
  `).run(prod1Id);

  db.prepare(`
    INSERT OR REPLACE INTO product_variants (id, product_id, variant_name, price_adjustment)
    VALUES ('var_odoo_01', ?, 'Odoo Brand Edition', 560.00),
           ('var_custom_01', ?, 'White Label Edition', 800.00)
  `).run(prod1Id, prod1Id);

  const prod2Id = 'prod_sms_gateway';
  db.prepare(`
    INSERT OR REPLACE INTO products (id, name, type, sales_price, cost_price, notes)
    VALUES (?, 'Priority SMS Gateway', 'Digital', 350.00, 100.00, 'High-throughput transactional routing')
  `).run(prod2Id);

  // Seed Plans
  db.prepare(`
    INSERT OR REPLACE INTO plans (
      id, name, cost, billing_interval, min_quantity,
      auto_close_on_end, allow_early_close, allow_pause, allow_renewal
    ) VALUES 
    ('plan_starter_monthly', 'Starter Monthly', 120.00, 'monthly', 1, 0, 1, 1, 1),
    ('plan_pro_monthly', 'Professional Monthly', 350.00, 'monthly', 1, 0, 1, 1, 1),
    ('plan_enterprise_yearly', 'Enterprise Annual Contract', 4200.00, 'yearly', 5, 1, 1, 1, 1)
  `).run();

  // Seed Tax Rules
  db.prepare(`
    INSERT OR REPLACE INTO tax_rules (id, name, rate_percentage, is_active)
    VALUES ('tax_gst_standard', 'Standard GST / VAT', 18.00, 1)
  `).run();

  // Seed Admin Discount Rule
  db.prepare(`
    INSERT OR REPLACE INTO discounts (
      id, code, discount_type, value, min_purchase_amount,
      min_quantity, max_usage_limit, times_used, scope, is_active
    ) VALUES (
      'disc_volume_seats', 'SEATS10', 'PERCENTAGE', 10.00, 500.00,
      1, 100, 0, 'SUBSCRIPTION', 1
    )
  `).run();

  // Seed Quotation Template
  db.prepare(`
    INSERT OR REPLACE INTO quotation_templates (id, name, plan_id, validity_days)
    VALUES ('tpl_starter_pack', 'Quick Starter Pack Template', 'plan_starter_monthly', 15)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO quotation_template_items (id, template_id, product_id, variant_id, quantity)
    VALUES ('tpl_item_01', 'tpl_starter_pack', 'prod_suite_01', 'var_odoo_01', 1)
  `).run();

  console.log('[Seed] Database seeded successfully!');
  console.log('Credentials:');
  console.log(' - Admin: ashishsunil4160@gmail.com / Admin@12345');
  console.log(' - Staff: staff.sarah@recursms.com / Staff@12345');
  console.log(' - Customer 1: corner.grocery@store.com / Customer@12345');
  console.log(' - Customer 2: acme.enterprises@global.com / Customer@12345');
}

seedDatabase();
