const crypto = require('crypto');
const db = require('./db');
const { sendInvoiceIssuedEmail } = require('./services/emailService');

function calculateNextDate(currentDateStr, interval) {
  const d = new Date(currentDateStr || new Date());
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split('T')[0];
  }
  switch (interval.toLowerCase()) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split('T')[0];
}

function runAutomatedBillingBatch() {
  const today = new Date().toISOString().split('T')[0];
  const batchId = 'bat_' + crypto.randomUUID().substring(0, 8);
  
  // Find all active subscriptions due for billing
  const dueSubscriptions = db.prepare(`
    SELECT s.*, u.email as customer_email, p.billing_interval, p.auto_close_on_end, p.cost as plan_cost
    FROM subscriptions s
    JOIN users u ON s.customer_id = u.id
    JOIN plans p ON s.plan_id = p.id
    WHERE s.status = 'Active' 
      AND (s.next_billing_date IS NULL OR s.next_billing_date <= ?)
  `).all(today);

  let invoicesCreated = 0;
  let totalBilled = 0;
  let duplicateSkips = 0;
  const invoicesToNotify = [];

  const activeTaxes = db.prepare('SELECT * FROM tax_rules WHERE is_active = 1').all();
  const taxRateSum = activeTaxes.reduce((sum, t) => sum + t.rate_percentage, 0);

  // Run in a single transaction for atomicity and idempotency
  const processBatch = db.transaction(() => {
    for (const sub of dueSubscriptions) {
      const cycleStart = sub.next_billing_date || today;
      const cycleEnd = calculateNextDate(cycleStart, sub.billing_interval);

      // Check if invoice already exists for this subscription cycle (Idempotency guard)
      const existingInvoice = db.prepare(`
        SELECT id FROM invoices 
        WHERE subscription_id = ? AND billing_cycle_start = ? AND billing_cycle_end = ?
      `).get(sub.id, cycleStart, cycleEnd);

      if (existingInvoice) {
        duplicateSkips++;
        continue;
      }

      // Fetch subscription items
      const items = db.prepare(`
        SELECT si.*, p.name as product_name, pv.variant_name, pv.price_adjustment
        FROM subscription_items si
        JOIN products p ON si.product_id = p.id
        LEFT JOIN product_variants pv ON si.variant_id = pv.id
        WHERE si.subscription_id = ?
      `).all(sub.id);

      let subtotal = 0;
      const invoiceLineItems = [];

      for (const item of items) {
        const lineTotal = item.amount;
        subtotal += lineTotal;
        invoiceLineItems.push({
          product_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_amount: 0,
          tax_amount: (lineTotal * (taxRateSum / 100)),
          total_amount: lineTotal
        });
      }

      // Check applicable discounts
      let discountTotal = 0;
      const eligibleDiscounts = db.prepare(`
        SELECT * FROM discounts 
        WHERE is_active = 1 
          AND (valid_from IS NULL OR valid_from <= ?)
          AND (valid_until IS NULL OR valid_until >= ?)
          AND (max_usage_limit = 0 OR times_used < max_usage_limit)
          AND (min_purchase_amount <= ?)
      `).all(today, today, subtotal);

      if (eligibleDiscounts.length > 0) {
        // Pick best matching discount
        const disc = eligibleDiscounts[0];
        if (disc.discount_type === 'PERCENTAGE') {
          discountTotal = (subtotal * (disc.value / 100));
        } else {
          discountTotal = Math.min(disc.value, subtotal);
        }
        // Increment usage
        db.prepare('UPDATE discounts SET times_used = times_used + 1 WHERE id = ?').run(disc.id);
      }

      const taxableBase = Math.max(0, subtotal - discountTotal);
      const taxTotal = (taxableBase * (taxRateSum / 100));
      const finalTotal = taxableBase + taxTotal;

      const invoiceId = 'inv_' + crypto.randomUUID();
      const invoiceNum = 'INV-' + Math.floor(100000 + Math.random() * 900000);
      const dueDate = calculateNextDate(today, 'weekly'); // Net 7 days for payment

      db.prepare(`
        INSERT INTO invoices (
          id, invoice_number, subscription_id, customer_id, status,
          issue_date, due_date, subtotal, discount_total, tax_total,
          total_amount, paid_amount, billing_cycle_start, billing_cycle_end
        ) VALUES (?, ?, ?, ?, 'Confirmed', ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        invoiceId, invoiceNum, sub.id, sub.customer_id,
        today, dueDate, subtotal, discountTotal, taxTotal,
        finalTotal, cycleStart, cycleEnd
      );

      for (const line of invoiceLineItems) {
        db.prepare(`
          INSERT INTO invoice_items (
            id, invoice_id, product_name, quantity, unit_price, discount_amount, tax_amount, total_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'item_' + crypto.randomUUID(), invoiceId, line.product_name, line.quantity,
          line.unit_price, line.discount_amount, line.tax_amount, line.total_amount
        );
      }

      // Advance subscription's next_billing_date
      const nextDate = cycleEnd;
      let newStatus = 'Active';
      if (sub.auto_close_on_end && sub.expiry_date && nextDate > sub.expiry_date) {
        newStatus = 'Closed';
      }

      db.prepare(`
        UPDATE subscriptions 
        SET next_billing_date = ?, last_invoiced_date = ?, status = ?
        WHERE id = ?
      `).run(nextDate, today, newStatus, sub.id);

      invoicesCreated++;
      totalBilled += finalTotal;
      invoicesToNotify.push({
        customer_email: sub.customer_email,
        invoice: { id: invoiceId, invoice_number: invoiceNum, total_amount: finalTotal, due_date: dueDate, subtotal, discount_total: discountTotal, tax_total: taxTotal },
        items: invoiceLineItems
      });
    }

    // Log the batch
    db.prepare(`
      INSERT INTO billing_batch_logs (id, run_timestamp, invoices_created, total_billed, status, details)
      VALUES (?, CURRENT_TIMESTAMP, ?, ?, 'SUCCESS', ?)
    `).run(
      batchId, invoicesCreated, totalBilled,
      `Processed ${dueSubscriptions.length} subscriptions. Generated: ${invoicesCreated}. Skipped duplicates: ${duplicateSkips}.`
    );
  });

  processBatch();

  // Asynchronously dispatch transactional invoice notifications
  for (const n of invoicesToNotify) {
    if (n.customer_email) {
      sendInvoiceIssuedEmail({
        to: n.customer_email,
        invoice: n.invoice,
        items: n.items
      }).catch(err => console.error('[BillingEngine] Invoice email dispatch error:', err.message));
    }
  }

  return {
    batchId,
    processed: dueSubscriptions.length,
    invoicesCreated,
    totalBilled,
    duplicateSkips
  };
}

module.exports = {
  calculateNextDate,
  runAutomatedBillingBatch
};
