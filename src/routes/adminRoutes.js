const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware, requireAdmin } = require('../auth');
const { runAutomatedBillingBatch } = require('../billingEngine');

const router = express.Router();
router.use(authMiddleware, requireAdmin);

// ================= Staff Management =================
router.get('/staff', (req, res) => {
  const staffList = db.prepare(`
    SELECT u.id, u.email, u.role, u.created_at 
    FROM users u
    WHERE u.role = 'STAFF'
    UNION
    SELECT NULL as id, w.email, 'STAFF' as role, w.created_at
    FROM staff_whitelist w
    WHERE w.email NOT IN (SELECT email FROM users)
  `).all();
  res.json({ staff: staffList });
});

router.post('/staff', (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid email is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: 'Admin is already registered with supreme privileges.' });
  }

  // Add to whitelist
  db.prepare(`
    INSERT OR REPLACE INTO staff_whitelist (email, added_by)
    VALUES (?, ?)
  `).run(cleanEmail, req.user.email);

  // If user already registered as customer, upgrade to STAFF
  db.prepare(`
    UPDATE users SET role = 'STAFF' WHERE email = ?
  `).run(cleanEmail);

  res.json({ message: `Staff member ${cleanEmail} added successfully.` });
});

router.delete('/staff/:email', (req, res) => {
  const cleanEmail = req.params.email.trim().toLowerCase();
  
  db.prepare('DELETE FROM staff_whitelist WHERE email = ?').run(cleanEmail);
  db.prepare("UPDATE users SET role = 'CUSTOMER' WHERE email = ?").run(cleanEmail);

  res.json({ message: `Staff member ${cleanEmail} removed.` });
});

// ================= Products & Variants =================
router.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  const variants = db.prepare('SELECT * FROM product_variants').all();

  const productsWithVariants = products.map(p => ({
    ...p,
    variants: variants.filter(v => v.product_id === p.id)
  }));

  res.json({ products: productsWithVariants });
});

router.post('/products', (req, res) => {
  const { name, type, sales_price, cost_price, notes, variants } = req.body;
  if (!name || sales_price === undefined) {
    return res.status(400).json({ error: 'Product name and sales price are required.' });
  }

  const productId = 'prod_' + crypto.randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(productId, name, type || 'Service', Number(sales_price), Number(cost_price || 0), notes || '');

  if (Array.isArray(variants)) {
    for (const v of variants) {
      if (v.variant_name) {
        db.prepare(`
          INSERT INTO product_variants (id, product_id, variant_name, price_adjustment)
          VALUES (?, ?, ?, ?)
        `).run('var_' + crypto.randomUUID(), productId, v.variant_name, Number(v.price_adjustment || 0));
      }
    }
  }

  res.status(201).json({ message: 'Product created successfully', id: productId });
});

router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ message: 'Product deleted.' });
});

// ================= Plans =================
router.get('/plans', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans ORDER BY created_at DESC').all();
  res.json({ plans });
});

router.post('/plans', (req, res) => {
  const {
    name, cost, billing_interval, min_quantity,
    available_from, available_to, auto_close_on_end,
    allow_early_close, allow_pause, allow_renewal
  } = req.body;

  if (!name || cost === undefined || !billing_interval) {
    return res.status(400).json({ error: 'Name, cost, and billing interval are required.' });
  }

  const planId = 'plan_' + crypto.randomUUID();
  db.prepare(`
    INSERT INTO plans (
      id, name, cost, billing_interval, min_quantity,
      available_from, available_to, auto_close_on_end,
      allow_early_close, allow_pause, allow_renewal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    planId, name, Number(cost), billing_interval.toLowerCase(), Number(min_quantity || 1),
    available_from || null, available_to || null, auto_close_on_end ? 1 : 0,
    allow_early_close !== undefined ? (allow_early_close ? 1 : 0) : 1,
    allow_pause !== undefined ? (allow_pause ? 1 : 0) : 1,
    allow_renewal !== undefined ? (allow_renewal ? 1 : 0) : 1
  );

  res.status(201).json({ message: 'Plan created successfully', id: planId });
});

router.delete('/plans/:id', (req, res) => {
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
  res.json({ message: 'Plan deleted.' });
});

// ================= Tax Rules =================
router.get('/taxes', (req, res) => {
  const taxes = db.prepare('SELECT * FROM tax_rules ORDER BY created_at DESC').all();
  res.json({ taxes });
});

router.post('/taxes', (req, res) => {
  const { name, rate_percentage } = req.body;
  if (!name || rate_percentage === undefined) {
    return res.status(400).json({ error: 'Name and rate percentage are required.' });
  }

  const taxId = 'tax_' + crypto.randomUUID();
  db.prepare(`
    INSERT INTO tax_rules (id, name, rate_percentage, is_active)
    VALUES (?, ?, ?, 1)
  `).run(taxId, name, Number(rate_percentage));

  res.status(201).json({ message: 'Tax rule created successfully', id: taxId });
});

router.delete('/taxes/:id', (req, res) => {
  db.prepare('DELETE FROM tax_rules WHERE id = ?').run(req.params.id);
  res.json({ message: 'Tax rule deleted.' });
});

// ================= Discounts =================
router.get('/discounts', (req, res) => {
  const discounts = db.prepare(`
    SELECT d.*, p.name as target_product_name 
    FROM discounts d
    LEFT JOIN products p ON d.target_product_id = p.id
    ORDER BY d.created_at DESC
  `).all();
  res.json({ discounts });
});

router.post('/discounts', (req, res) => {
  const {
    code, discount_type, value, min_purchase_amount,
    min_quantity, valid_from, valid_until, max_usage_limit,
    scope, target_product_id
  } = req.body;

  if (!code || !discount_type || value === undefined) {
    return res.status(400).json({ error: 'Code, type, and value are required.' });
  }

  const discountId = 'disc_' + crypto.randomUUID();
  db.prepare(`
    INSERT INTO discounts (
      id, code, discount_type, value, min_purchase_amount,
      min_quantity, valid_from, valid_until, max_usage_limit,
      times_used, scope, target_product_id, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
  `).run(
    discountId, code.toUpperCase(), discount_type.toUpperCase(), Number(value),
    Number(min_purchase_amount || 0), Number(min_quantity || 0),
    valid_from || null, valid_until || null, Number(max_usage_limit || 0),
    scope ? scope.toUpperCase() : 'SUBSCRIPTION', target_product_id || null
  );

  res.status(201).json({ message: 'Discount rule created successfully', id: discountId });
});

router.delete('/discounts/:id', (req, res) => {
  db.prepare('DELETE FROM discounts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Discount deleted.' });
});

// ================= Quotation Templates =================
router.get('/templates', (req, res) => {
  const templates = db.prepare(`
    SELECT t.*, p.name as plan_name, p.cost as plan_cost, p.billing_interval
    FROM quotation_templates t
    LEFT JOIN plans p ON t.plan_id = p.id
    ORDER BY t.created_at DESC
  `).all();

  const items = db.prepare(`
    SELECT qti.*, pr.name as product_name, pr.sales_price, pv.variant_name, pv.price_adjustment
    FROM quotation_template_items qti
    JOIN products pr ON qti.product_id = pr.id
    LEFT JOIN product_variants pv ON qti.variant_id = pv.id
  `).all();

  const result = templates.map(t => ({
    ...t,
    items: items.filter(i => i.template_id === t.id)
  }));

  res.json({ templates: result });
});

router.post('/templates', (req, res) => {
  const { name, plan_id, validity_days, items } = req.body;
  if (!name || !plan_id) {
    return res.status(400).json({ error: 'Template name and plan are required.' });
  }

  const templateId = 'tpl_' + crypto.randomUUID();
  db.prepare(`
    INSERT INTO quotation_templates (id, name, plan_id, validity_days)
    VALUES (?, ?, ?, ?)
  `).run(templateId, name, plan_id, Number(validity_days || 15));

  if (Array.isArray(items)) {
    for (const item of items) {
      if (item.product_id) {
        db.prepare(`
          INSERT INTO quotation_template_items (id, template_id, product_id, variant_id, quantity)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          'tpl_item_' + crypto.randomUUID(), templateId, item.product_id,
          item.variant_id || null, Number(item.quantity || 1)
        );
      }
    }
  }

  res.status(201).json({ message: 'Quotation template created', id: templateId });
});

// ================= Dedicated Automated Invoicing Window =================
router.get('/automated-invoicing/metrics', (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const dueCount = db.prepare(`
    SELECT COUNT(*) as count 
    FROM subscriptions 
    WHERE status = 'Active' AND (next_billing_date IS NULL OR next_billing_date <= ?)
  `).get(today).count;

  const totalAutoInvoices = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total_billed
    FROM invoices
  `).get();

  const logs = db.prepare(`
    SELECT * FROM billing_batch_logs 
    ORDER BY run_timestamp DESC LIMIT 20
  `).all();

  res.json({
    engine_status: 'ACTIVE_ONLINE',
    due_subscriptions_count: dueCount,
    total_invoices_generated: totalAutoInvoices.count,
    total_amount_billed: totalAutoInvoices.total_billed,
    recent_batches: logs
  });
});

router.post('/automated-invoicing/run-batch', (req, res) => {
  try {
    const result = runAutomatedBillingBatch();
    res.json({
      message: 'Automated billing batch executed cleanly.',
      result
    });
  } catch (err) {
    console.error('Billing error:', err);
    res.status(500).json({ error: 'Failed to run automated billing batch: ' + err.message });
  }
});

// ================= Email Audit Logs =================
router.get('/email-logs', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const logs = db.prepare(`
    SELECT * FROM email_logs 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(limit);

  res.json({ email_logs: logs });
});

module.exports = router;
