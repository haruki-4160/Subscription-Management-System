const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware } = require('../auth');
const { sendPaymentReceiptEmail } = require('../services/emailService');

const router = express.Router();
router.use(authMiddleware);

// Get Customer Subscriptions
router.get('/my-subscriptions', (req, res) => {
  const subs = db.prepare(`
    SELECT s.*, p.name as plan_name, p.billing_interval, p.cost as plan_cost,
           p.allow_early_close, p.allow_pause, p.allow_renewal
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.customer_id = ?
    ORDER BY s.created_at DESC
  `).all(req.user.id);

  const items = db.prepare(`
    SELECT si.*, pr.name as product_name, pv.variant_name
    FROM subscription_items si
    JOIN subscriptions s ON si.subscription_id = s.id
    JOIN products pr ON si.product_id = pr.id
    LEFT JOIN product_variants pv ON si.variant_id = pv.id
    WHERE s.customer_id = ?
  `).all(req.user.id);

  const result = subs.map(s => ({
    ...s,
    items: items.filter(i => i.subscription_id === s.id)
  }));

  res.json({ subscriptions: result });
});

// Customer Lifecycle Action: Pause / Resume / Cancel (if allowed by plan)
router.post('/my-subscriptions/:id/action', (req, res) => {
  const { action } = req.body; // 'pause', 'resume', 'cancel'
  const sub = db.prepare(`
    SELECT s.*, p.allow_early_close, p.allow_pause, p.allow_renewal
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.id = ? AND s.customer_id = ?
  `).get(req.params.id, req.user.id);

  if (!sub) {
    return res.status(404).json({ error: 'Subscription not found.' });
  }

  if (action === 'cancel') {
    if (!sub.allow_early_close) {
      return res.status(403).json({ error: 'This plan does not permit early closure.' });
    }
    db.prepare("UPDATE subscriptions SET status = 'Closed' WHERE id = ?").run(sub.id);
    return res.json({ message: 'Subscription has been cancelled.', status: 'Closed' });
  }

  if (action === 'pause') {
    if (!sub.allow_pause) {
      return res.status(403).json({ error: 'This plan does not permit pausing.' });
    }
    // We update status to 'Quotation' or a paused state, or closed early
    db.prepare("UPDATE subscriptions SET status = 'Draft' WHERE id = ?").run(sub.id);
    return res.json({ message: 'Subscription has been paused.', status: 'Draft' });
  }

  if (action === 'resume') {
    db.prepare("UPDATE subscriptions SET status = 'Active' WHERE id = ?").run(sub.id);
    return res.json({ message: 'Subscription has been resumed.', status: 'Active' });
  }

  res.status(400).json({ error: 'Invalid action requested.' });
});

// Get Customer Invoices
router.get('/my-invoices', (req, res) => {
  const invoices = db.prepare(`
    SELECT i.*, s.subscription_number
    FROM invoices i
    LEFT JOIN subscriptions s ON i.subscription_id = s.id
    WHERE i.customer_id = ?
    ORDER BY i.created_at DESC
  `).all(req.user.id);

  const items = db.prepare(`
    SELECT it.* 
    FROM invoice_items it
    JOIN invoices i ON it.invoice_id = i.id
    WHERE i.customer_id = ?
  `).all(req.user.id);

  const result = invoices.map(inv => ({
    ...inv,
    items: items.filter(it => it.invoice_id === inv.id)
  }));

  res.json({ invoices: result });
});

// Demo Payment Gateway Endpoint (Supports QR, UPI, NETBANKING, CARD)
router.post('/pay/:invoice_id', async (req, res) => {
  const { payment_method, note } = req.body;
  const invoice = db.prepare(`
    SELECT * FROM invoices 
    WHERE id = ? AND customer_id = ?
  `).get(req.params.invoice_id, req.user.id);

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  if (invoice.status === 'Paid') {
    return res.status(400).json({ error: 'Invoice is already fully paid.' });
  }

  const validMethods = ['QR', 'UPI', 'NETBANKING', 'CARD'];
  const method = (payment_method || 'UPI').toUpperCase();
  if (!validMethods.includes(method)) {
    return res.status(400).json({ error: `Invalid payment method. Options: ${validMethods.join(', ')}` });
  }

  const remaining = Math.max(0, invoice.total_amount - invoice.paid_amount);
  const paymentId = 'pay_' + crypto.randomUUID();
  const txRef = 'TXN-DEMO-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 9000);

  const recordTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO payments (id, invoice_id, payment_method, amount, transaction_reference, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      paymentId, invoice.id, method, remaining, txRef,
      note || `Demo Payment via ${method}`
    );

    db.prepare(`
      UPDATE invoices 
      SET paid_amount = total_amount, status = 'Paid'
      WHERE id = ?
    `).run(invoice.id);
  });

  recordTx();

  let emailResult = { success: false };
  try {
    emailResult = await sendPaymentReceiptEmail({
      to: req.user.email,
      payment: { amount: remaining, payment_method: method, transaction_reference: txRef },
      invoice
    });
  } catch (err) {
    console.error('[CustomerRoutes] Payment receipt email error:', err.message);
  }

  res.json({
    message: 'Payment completed successfully!',
    payment: {
      id: paymentId,
      amount: remaining,
      method,
      reference: txRef,
      status: 'SUCCESS',
      email_receipt_dispatched: emailResult.success,
      preview_url: emailResult.previewUrl || null
    }
  });
});

module.exports = router;
