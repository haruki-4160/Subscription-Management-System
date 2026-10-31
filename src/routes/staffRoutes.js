const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware, requireStaffOrAdmin } = require('../auth');
const { calculateNextDate } = require('../billingEngine');
const { sendPaymentReceiptEmail, sendDunningNoticeEmail } = require('../services/emailService');

const router = express.Router();
router.use(authMiddleware, requireStaffOrAdmin);

// ================= Customers List =================
router.get('/customers', (req, res) => {
  const customers = db.prepare(`
    SELECT id, email, created_at FROM users 
    WHERE role = 'CUSTOMER' 
    ORDER BY created_at DESC
  `).all();
  res.json({ customers });
});

// ================= Subscriptions & Quotations =================
router.get('/subscriptions', (req, res) => {
  const subs = db.prepare(`
    SELECT s.*, u.email as customer_email, p.name as plan_name, p.billing_interval, p.cost as plan_cost
    FROM subscriptions s
    JOIN users u ON s.customer_id = u.id
    JOIN plans p ON s.plan_id = p.id
    ORDER BY s.created_at DESC
  `).all();

  const items = db.prepare(`
    SELECT si.*, pr.name as product_name, pv.variant_name
    FROM subscription_items si
    JOIN products pr ON si.product_id = pr.id
    LEFT JOIN product_variants pv ON si.variant_id = pv.id
  `).all();

  const result = subs.map(s => ({
    ...s,
    items: items.filter(i => i.subscription_id === s.id)
  }));

  res.json({ subscriptions: result });
});

router.post('/subscriptions', (req, res) => {
  const {
    customer_id, plan_id, template_id, start_date,
    expiry_date, payment_terms, items
  } = req.body;

  if (!customer_id || !plan_id) {
    return res.status(400).json({ error: 'Customer and plan are required.' });
  }

  const subId = 'sub_' + crypto.randomUUID();
  const subNumber = 'SUB-' + Math.floor(1000 + Math.random() * 9000);
  const startDate = start_date || new Date().toISOString().split('T')[0];

  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan_id);
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found.' });
  }

  // Next billing date is set to start_date
  const nextBillingDate = startDate;

  const createSub = db.transaction(() => {
    db.prepare(`
      INSERT INTO subscriptions (
        id, subscription_number, customer_id, plan_id, status,
        start_date, expiry_date, next_billing_date, payment_terms
      ) VALUES (?, ?, ?, ?, 'Draft', ?, ?, ?, ?)
    `).run(
      subId, subNumber, customer_id, plan_id,
      startDate, expiry_date || null, nextBillingDate, payment_terms || 'Net 15'
    );

    // If template was selected and no custom items provided, load from template
    let lineItems = items;
    if ((!lineItems || lineItems.length === 0) && template_id) {
      const templateItems = db.prepare(`
        SELECT qti.*, pr.sales_price, COALESCE(pv.price_adjustment, 0) as price_adjustment
        FROM quotation_template_items qti
        JOIN products pr ON qti.product_id = pr.id
        LEFT JOIN product_variants pv ON qti.variant_id = pv.id
        WHERE qti.template_id = ?
      `).all(template_id);

      lineItems = templateItems.map(t => ({
        product_id: t.product_id,
        variant_id: t.variant_id,
        quantity: t.quantity,
        unit_price: t.sales_price + t.price_adjustment
      }));
    }

    if (Array.isArray(lineItems)) {
      for (const item of lineItems) {
        const qty = Number(item.quantity || 1);
        const unitPrice = Number(item.unit_price || 0);
        const amount = qty * unitPrice;
        db.prepare(`
          INSERT INTO subscription_items (
            id, subscription_id, product_id, variant_id, quantity, unit_price, tax_rate, amount
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `).run(
          'sitem_' + crypto.randomUUID(), subId, item.product_id,
          item.variant_id || null, qty, unitPrice, amount
        );
      }
    }
  });

  createSub();

  res.status(201).json({
    message: 'Subscription created in Draft status',
    id: subId,
    subscription_number: subNumber
  });
});

// Update Subscription Status
// Workflow: Draft -> Quotation -> Confirmed -> Active -> Closed
router.patch('/subscriptions/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Valid values: ${validStatuses.join(', ')}` });
  }

  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) {
    return res.status(404).json({ error: 'Subscription not found.' });
  }

  db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(status, sub.id);
  res.json({ message: `Subscription status updated to ${status}`, status });
});

// ================= Invoices =================
router.get('/invoices', (req, res) => {
  const invoices = db.prepare(`
    SELECT i.*, u.email as customer_email, s.subscription_number
    FROM invoices i
    JOIN users u ON i.customer_id = u.id
    LEFT JOIN subscriptions s ON i.subscription_id = s.id
    ORDER BY i.created_at DESC
  `).all();

  const items = db.prepare('SELECT * FROM invoice_items').all();

  const result = invoices.map(inv => ({
    ...inv,
    items: items.filter(it => it.invoice_id === inv.id)
  }));

  res.json({ invoices: result });
});

router.patch('/invoices/:id/status', (req, res) => {
  const { status } = req.body;
  const valid = ['Draft', 'Confirmed', 'Paid', 'Cancelled'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Invalid invoice status.' });
  }

  db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ message: `Invoice status updated to ${status}` });
});

// ================= Payments Recording =================
router.post('/payments', async (req, res) => {
  const { invoice_id, payment_method, amount, note } = req.body;

  if (!invoice_id || !payment_method || amount === undefined) {
    return res.status(400).json({ error: 'Invoice ID, payment method, and amount are required.' });
  }

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  const payAmount = Number(amount);
  const paymentId = 'pay_' + crypto.randomUUID();
  const txRef = 'TXN-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900);

  const recordPaymentTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO payments (id, invoice_id, payment_method, amount, transaction_reference, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(paymentId, invoice_id, payment_method, payAmount, txRef, note || '');

    const newPaidAmount = invoice.paid_amount + payAmount;
    let newStatus = invoice.status;
    if (newPaidAmount >= invoice.total_amount) {
      newStatus = 'Paid';
    }

    db.prepare(`
      UPDATE invoices 
      SET paid_amount = ?, status = ?
      WHERE id = ?
    `).run(newPaidAmount, newStatus, invoice_id);
  });

  recordPaymentTx();

  // Dispatch payment receipt email
  const customer = db.prepare('SELECT email FROM users WHERE id = ?').get(invoice.customer_id);
  if (customer && customer.email) {
    sendPaymentReceiptEmail({
      to: customer.email,
      payment: { amount: payAmount, payment_method, transaction_reference: txRef },
      invoice
    }).catch(err => console.error('[StaffRoutes] Payment email error:', err.message));
  }

  res.status(201).json({
    message: 'Payment recorded successfully',
    payment_id: paymentId,
    transaction_reference: txRef
  });
});

// Dispatch manual/automated dunning notice for overdue invoice
router.post('/invoices/:id/send-dunning', async (req, res) => {
  const invoice = db.prepare(`
    SELECT i.*, u.email as customer_email 
    FROM invoices i 
    JOIN users u ON i.customer_id = u.id 
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  const today = new Date();
  const due = new Date(invoice.due_date);
  const diffDays = Math.max(1, Math.ceil((today - due) / (1000 * 60 * 60 * 24)));

  const result = await sendDunningNoticeEmail({
    to: invoice.customer_email,
    invoice,
    daysOverdue: diffDays
  });

  res.json({
    message: `Dunning notice dispatched to ${invoice.customer_email}`,
    preview_url: result.previewUrl || null,
    status: result.success ? 'SENT' : 'FAILED'
  });
});

module.exports = router;
