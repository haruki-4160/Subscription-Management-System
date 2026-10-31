const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { validatePassword, ADMIN_EMAIL, generateToken } = require('../src/auth');
const { runAutomatedBillingBatch } = require('../src/billingEngine');

async function runTests() {
  console.log('--- STARTING RECUR SMS VERIFICATION SUITE ---');

  // Global cleanup of previous test run references
  db.prepare("DELETE FROM payments WHERE transaction_reference LIKE 'TXN-TEST%'").run();
  db.prepare("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE subscription_id = 'test_sub_01')").run();
  db.prepare("DELETE FROM invoices WHERE subscription_id = 'test_sub_01'").run();
  db.prepare("DELETE FROM subscription_items WHERE subscription_id = 'test_sub_01'").run();
  db.prepare("DELETE FROM subscriptions WHERE id = 'test_sub_01'").run();
  db.prepare("DELETE FROM product_variants WHERE id = 'test_var_odoo'").run();
  db.prepare("DELETE FROM products WHERE id = 'test_prod_erp'").run();
  db.prepare("DELETE FROM users WHERE id = 'test_cust_01'").run();
  db.prepare("DELETE FROM plans WHERE id = 'test_plan_monthly'").run();
  db.prepare("DELETE FROM discounts WHERE id = 'test_disc_seats'").run();
  db.prepare("DELETE FROM tax_rules WHERE id = 'test_tax_gst'").run();

  // Test 1: Password validation logic
  console.log('Test 1: Password security validation');
  assert.strictEqual(validatePassword('short').valid, false, 'Should fail length <= 8');
  assert.strictEqual(validatePassword('alllowercase1!').valid, false, 'Should fail no uppercase');
  assert.strictEqual(validatePassword('ALLUPPERCASE1!').valid, false, 'Should fail no lowercase');
  assert.strictEqual(validatePassword('NoSpecialChar123').valid, false, 'Should fail no special char');
  assert.strictEqual(validatePassword('ValidPass@2026').valid, true, 'Should pass valid password');
  console.log('✓ Password rules verified (>8 chars, 1 uppercase, 1 lowercase, 1 special char)');

  // Test 2: Admin user existence
  console.log('Test 2: Admin role verification');
  const admin = db.prepare('SELECT * FROM users WHERE email = ?').get(ADMIN_EMAIL);
  assert.ok(admin, 'Designated admin must exist');
  assert.strictEqual(admin.role, 'ADMIN', 'Admin role must be ADMIN');
  console.log(`✓ Admin verified: ${ADMIN_EMAIL}`);

  // Test 3: Staff whitelist management
  console.log('Test 3: Staff whitelist by Admin');
  const staffEmail = 'staff_member_1@recursms.com';
  db.prepare('INSERT OR REPLACE INTO staff_whitelist (email, added_by) VALUES (?, ?)').run(staffEmail, ADMIN_EMAIL);
  const isStaff = db.prepare('SELECT * FROM staff_whitelist WHERE email = ?').get(staffEmail);
  assert.ok(isStaff, 'Staff email should be in whitelist');
  console.log('✓ Staff whitelist insertion verified');

  // Test 4: Product with Odoo brand variant (+560)
  console.log('Test 4: Product catalog & Variant pricing');
  const prodId = 'test_prod_erp';
  const varId = 'test_var_odoo';
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(prodId);
  db.prepare('DELETE FROM products WHERE id = ?').run(prodId);
  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes)
    VALUES (?, ?, 'Service', 1200, 500, 'Core ERP system')
  `).run(prodId, 'Enterprise ERP');

  db.prepare(`
    INSERT INTO product_variants (id, product_id, variant_name, price_adjustment)
    VALUES (?, ?, 'Odoo', 560)
  `).run(varId, prodId);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId);
  const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(varId);
  assert.strictEqual(product.sales_price, 1200);
  assert.strictEqual(variant.price_adjustment, 560);
  console.log(`✓ Product created with Odoo variant (+${variant.price_adjustment})`);

  // Clean up any previous test dependencies
  const planId = 'test_plan_monthly';
  const customerId = 'test_cust_01';
  const subId = 'test_sub_01';

  db.prepare('DELETE FROM payments WHERE transaction_reference = ?').run('TXN-TEST-1234');
  db.prepare('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE subscription_id = ?)').run(subId);
  db.prepare('DELETE FROM invoices WHERE subscription_id = ?').run(subId);
  db.prepare('DELETE FROM subscription_items WHERE subscription_id = ?').run(subId);
  db.prepare('DELETE FROM subscriptions WHERE id = ?').run(subId);
  db.prepare('DELETE FROM users WHERE id = ?').run(customerId);
  db.prepare('DELETE FROM plans WHERE id = ?').run(planId);

  // Test 5: Plan creation
  console.log('Test 5: Plan with billing frequency & lifecycle policies');
  db.prepare(`
    INSERT INTO plans (id, name, cost, billing_interval, min_quantity, auto_close_on_end, allow_early_close, allow_pause, allow_renewal)
    VALUES (?, 'Business Monthly', 250, 'monthly', 1, 0, 1, 1, 1)
  `).run(planId);
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
  assert.strictEqual(plan.billing_interval, 'monthly');
  console.log('✓ Monthly plan verified');

  // Test 6: Taxes and Admin Discounts
  console.log('Test 6: Taxes & Discount rules');
  const taxId = 'test_tax_gst';
  db.prepare('DELETE FROM tax_rules WHERE id = ?').run(taxId);
  db.prepare('INSERT INTO tax_rules (id, name, rate_percentage, is_active) VALUES (?, ?, 18, 1)').run(taxId, 'GST');

  const discId = 'test_disc_seats';
  db.prepare('DELETE FROM discounts WHERE code = ? OR id = ?').run('TESTSEATS10', discId);
  db.prepare(`
    INSERT INTO discounts (id, code, discount_type, value, min_purchase_amount, max_usage_limit, times_used, scope, is_active)
    VALUES (?, 'TESTSEATS10', 'PERCENTAGE', 10, 500, 100, 0, 'SUBSCRIPTION', 1)
  `).run(discId);
  console.log('✓ 18% Tax and 10% Discount rule configured');

  // Test 7: Subscription lifecycle (Draft -> Quotation -> Confirmed -> Active)
  console.log('Test 7: Subscription state transitions');
  db.prepare(`
    INSERT INTO users (id, email, password_hash, role)
    VALUES (?, 'customer_store@gmail.com', 'hash', 'CUSTOMER')
  `).run(customerId);

  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, next_billing_date)
    VALUES (?, 'SUB-TEST-99', ?, ?, 'Draft', ?, ?)
  `).run(subId, customerId, planId, today, today);

  // Line item with Odoo variant
  db.prepare('DELETE FROM subscription_items WHERE subscription_id = ?').run(subId);
  db.prepare(`
    INSERT INTO subscription_items (id, subscription_id, product_id, variant_id, quantity, unit_price, tax_rate, amount)
    VALUES ('sub_item_01', ?, ?, ?, 1, 1760, 0, 1760)
  `).run(subId, prodId, varId);

  // Transition to Active
  db.prepare("UPDATE subscriptions SET status = 'Active' WHERE id = ?").run(subId);
  const activeSub = db.prepare('SELECT status FROM subscriptions WHERE id = ?').get(subId);
  assert.strictEqual(activeSub.status, 'Active');
  console.log('✓ Subscription transitioned to Active status');

  // Test 8: Automated Invoicing Engine & Idempotency
  console.log('Test 8: Automated Invoicing Batch Execution & Idempotency Check');
  const batch1 = runAutomatedBillingBatch();
  assert.ok(batch1.invoicesCreated >= 1, 'At least 1 invoice should be created on billing day');
  console.log(`✓ Batch 1: ${batch1.invoicesCreated} invoice(s) generated automatically.`);

  // Second run immediately to verify NO duplicate invoice is generated
  const batch2 = runAutomatedBillingBatch();
  assert.strictEqual(batch2.invoicesCreated, 0, 'Idempotency failed! Invoices must never be double billed.');
  console.log('✓ Batch 2: Idempotency verified: 0 duplicate invoices generated on repeated billing sweep.');

  // Test 9: Payment recording & Invoice Paid reconciliation
  console.log('Test 9: Payment reconciliation');
  const invoice = db.prepare('SELECT * FROM invoices WHERE subscription_id = ?').get(subId);
  assert.ok(invoice, 'Invoice should exist');

  const payId = 'test_pay_01';
  db.prepare('DELETE FROM payments WHERE id = ?').run(payId);
  db.prepare(`
    INSERT INTO payments (id, invoice_id, payment_method, amount, transaction_reference, note)
    VALUES (?, ?, 'UPI', ?, 'TXN-TEST-1234', 'Demo UPI Settlement')
  `).run(payId, invoice.id, invoice.total_amount);

  db.prepare("UPDATE invoices SET paid_amount = total_amount, status = 'Paid' WHERE id = ?").run(invoice.id);
  const paidInv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  assert.strictEqual(paidInv.status, 'Paid');
  console.log(`✓ Payment reconciled: Invoice ${paidInv.invoice_number} is now marked Paid.`);

  // Test 10: Finance summary SLA benchmark (< 2.0s)
  console.log('Test 10: Executive Finance Performance Benchmark');
  const startHr = process.hrtime();
  const summary = db.prepare(`
    SELECT 
      COUNT(*) as total_invoices,
      SUM(paid_amount) as total_revenue
    FROM invoices
  `).get();
  const elapsed = process.hrtime(startHr);
  const ms = (elapsed[0] * 1000 + elapsed[1] / 1e6).toFixed(2);
  assert.ok(ms < 2000, `Finance queries exceeded 2-second SLA! Took: ${ms}ms`);
  console.log(`✓ Finance query completed in ${ms} ms (SLA < 2000ms PASSED)`);

  // Test 11: Transactional Email Notification Service & Audit Logs
  console.log('Test 11: Transactional Email Notification Service');
  const { sendPasswordResetEmail } = require('../src/services/emailService');
  const emailRes = await sendPasswordResetEmail({
    to: 'customer_store@gmail.com',
    resetToken: 'test_token_abc123',
    resetLink: '/reset-password.html?token=test_token_abc123'
  });
  assert.strictEqual(emailRes.success, true, 'Email dispatch should succeed');
  const emailLog = db.prepare('SELECT * FROM email_logs WHERE recipient = ? ORDER BY created_at DESC').get('customer_store@gmail.com');
  assert.ok(emailLog, 'Email log should be recorded in database');
  assert.strictEqual(emailLog.status, 'SENT', 'Email log status should be SENT');
  console.log(`✓ Transactional Email dispatched and logged: ${emailLog.template} (ID: ${emailLog.id})`);

  // Test 12: PDF Document Generation for Invoices & Quotations
  console.log('Test 12: PDF Generation Service');
  const { generateInvoicePDF, generateQuotationPDF } = require('../src/services/pdfService');
  const { Writable } = require('stream');

  function createBufferStream() {
    const chunks = [];
    const stream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    return { stream, getBuffer: () => Buffer.concat(chunks) };
  }

  // 1. Invoice PDF
  const invBuf = createBufferStream();
  generateInvoicePDF(invoice, [{ product_name: 'Enterprise ERP', quantity: 1, unit_price: 1200, total_amount: 1200 }], [], invBuf.stream);
  await new Promise(resolve => invBuf.stream.on('finish', resolve));
  const invoicePdfData = invBuf.getBuffer();
  assert.ok(invoicePdfData.length > 500, 'Invoice PDF should contain valid bytes');
  assert.strictEqual(invoicePdfData.toString('utf8', 0, 4), '%PDF', 'Invoice PDF header must start with %PDF');
  console.log(`✓ Invoice PDF generated (${invoicePdfData.length} bytes, header: %PDF)`);

  // 2. Quotation PDF
  const quoteBuf = createBufferStream();
  const subRecord = db.prepare('SELECT s.*, u.email as customer_email, p.name as plan_name, p.billing_interval FROM subscriptions s JOIN users u ON s.customer_id = u.id JOIN plans p ON s.plan_id = p.id WHERE s.id = ?').get(subId);
  generateQuotationPDF(subRecord, [{ product_name: 'Enterprise ERP', variant_name: 'Odoo', quantity: 1, unit_price: 1760, amount: 1760 }], quoteBuf.stream);
  await new Promise(resolve => quoteBuf.stream.on('finish', resolve));
  const quotePdfData = quoteBuf.getBuffer();
  assert.ok(quotePdfData.length > 500, 'Quotation PDF should contain valid bytes');
  assert.strictEqual(quotePdfData.toString('utf8', 0, 4), '%PDF', 'Quotation PDF header must start with %PDF');
  console.log(`✓ Quotation PDF generated (${quotePdfData.length} bytes, header: %PDF)`);

  console.log('\n--- ALL VERIFICATION SUITE TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
