const nodemailer = require('nodemailer');
const crypto = require('crypto');
const db = require('../db');

let cachedTransporter = null;

async function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  // 1. Production / Custom SMTP configuration
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    return cachedTransporter;
  }

  // 2. Automated Ethereal test account (for development/evaluation)
  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log(`[EmailService] Initialized Ethereal test account: ${testAccount.user}`);
    return cachedTransporter;
  } catch (err) {
    // 3. Resilient Offline fallback (if no internet connection)
    console.warn('[EmailService] Network unavailable for test account, using simulated log transporter.');
    cachedTransporter = {
      sendMail: async (options) => ({
        messageId: 'sim_' + crypto.randomUUID(),
        simulated: true,
        options
      })
    };
    return cachedTransporter;
  }
}

/**
 * Dispatches an email and records it in SQLite email_logs
 */
async function dispatchEmail({ to, subject, html, text, templateName, metadata = {} }) {
  const emailId = 'eml_' + crypto.randomUUID();
  const fromAddress = process.env.FROM_EMAIL || '"RECUR Billing Engine" <billing@recursms.com>';

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: text || subject,
      html
    });

    let previewUrl = null;
    if (typeof nodemailer.getTestMessageUrl === 'function') {
      previewUrl = nodemailer.getTestMessageUrl(info) || null;
    }

    // Save to database log
    db.prepare(`
      INSERT INTO email_logs (id, recipient, subject, template, status, preview_url, details)
      VALUES (?, ?, ?, ?, 'SENT', ?, ?)
    `).run(
      emailId,
      to,
      subject,
      templateName,
      previewUrl,
      JSON.stringify({ ...metadata, messageId: info.messageId })
    );

    console.log(`[EmailService] Sent '${templateName}' to <${to}> | ID: ${info.messageId}${previewUrl ? ` | Preview: ${previewUrl}` : ''}`);

    return {
      success: true,
      emailId,
      messageId: info.messageId,
      previewUrl
    };
  } catch (error) {
    console.error(`[EmailService] Failed sending '${templateName}' to <${to}>:`, error.message);

    db.prepare(`
      INSERT INTO email_logs (id, recipient, subject, template, status, preview_url, details)
      VALUES (?, ?, ?, ?, 'FAILED', NULL, ?)
    `).run(
      emailId,
      to,
      subject,
      templateName,
      JSON.stringify({ error: error.message, ...metadata })
    );

    return {
      success: false,
      emailId,
      error: error.message
    };
  }
}

// ================= Email Templates =================

/**
 * 1. Password Reset Email
 */
async function sendPasswordResetEmail({ to, resetToken, resetLink }) {
  const subject = '🔐 Password Reset Request — RECUR SMS';
  const fullResetLink = resetLink.startsWith('http')
    ? resetLink
    : `http://localhost:${process.env.PORT || 3000}${resetLink}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
        .container { max-width: 560px; margin: 0 auto; background: #131b2e; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .logo { font-size: 20px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; margin-bottom: 24px; }
        h1 { font-size: 22px; color: #ffffff; margin-bottom: 12px; }
        p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 20px; }
        .button { display: inline-block; background: #2563eb; color: #ffffff !important; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px; text-decoration: none; margin: 16px 0; }
        .code-box { background: #0f172a; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; margin: 16px 0; }
        .footer { font-size: 12px; color: #64748b; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">⚡ RECUR SMS</div>
        <h1>Password Reset Request</h1>
        <p>Hello,</p>
        <p>We received a request to reset your password for your RECUR SMS account. Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.</p>
        <div style="text-align: center;">
          <a href="${fullResetLink}" class="button" target="_blank">Reset Password</a>
        </div>
        <p>Or paste this link into your browser:</p>
        <div class="code-box">${fullResetLink}</div>
        <p>If you did not request this, please disregard this email. Your password will remain unchanged.</p>
        <div class="footer">
          RECUR — Enterprise Subscription & Recurring Billing Platform
        </div>
      </div>
    </body>
    </html>
  `;

  return dispatchEmail({
    to,
    subject,
    html,
    text: `Password reset link: ${fullResetLink} (Expires in 1 hour)`,
    templateName: 'PASSWORD_RESET',
    metadata: { resetToken }
  });
}

/**
 * 2. New Invoice Issued Email
 */
async function sendInvoiceIssuedEmail({ to, invoice, items = [], customerName }) {
  const subject = `📄 New Invoice Issued: ${invoice.invoice_number} — RECUR SMS`;
  const portalUrl = `http://localhost:${process.env.PORT || 3000}`;

  const rows = items.map(item => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #1e293b; color: #f1f5f9;">${item.product_name}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #1e293b; text-align: center; color: #94a3b8;">${item.quantity}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #1e293b; text-align: right; color: #f1f5f9;">$${Number(item.total_amount).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
        .container { max-width: 600px; margin: 0 auto; background: #131b2e; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; }
        .logo { font-size: 20px; font-weight: 800; color: #38bdf8; margin-bottom: 20px; }
        .badge { display: inline-block; background: #0369a1; color: #e0f2fe; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
        h1 { font-size: 22px; color: #ffffff; margin-top: 12px; margin-bottom: 8px; }
        p { font-size: 14px; line-height: 1.6; color: #94a3b8; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
        th { text-align: left; padding: 10px 12px; background: #0f172a; color: #94a3b8; font-size: 12px; text-transform: uppercase; }
        .total-box { background: #0f172a; padding: 16px; border-radius: 8px; margin-top: 16px; text-align: right; }
        .button { display: inline-block; background: #0284c7; color: #ffffff !important; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 20px; }
        .footer { font-size: 12px; color: #64748b; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">⚡ RECUR SMS</div>
        <span class="badge">BILLING CYCLE NOTICE</span>
        <h1>Invoice ${invoice.invoice_number}</h1>
        <p>Dear ${customerName || 'Customer'},</p>
        <p>Your subscription billing run has completed, and a new invoice has been issued. Payment is due by <strong>${invoice.due_date}</strong>.</p>
        
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="3" style="padding: 10px 12px;">Subscription Plan Services</td></tr>`}
          </tbody>
        </table>

        <div class="total-box">
          <div style="font-size: 13px; color: #94a3b8;">Subtotal: $${Number(invoice.subtotal || invoice.total_amount).toFixed(2)}</div>
          ${invoice.discount_total ? `<div style="font-size: 13px; color: #10b981;">Discount: -$${Number(invoice.discount_total).toFixed(2)}</div>` : ''}
          ${invoice.tax_total ? `<div style="font-size: 13px; color: #94a3b8;">Taxes: +$${Number(invoice.tax_total).toFixed(2)}</div>` : ''}
          <div style="font-size: 20px; font-weight: 700; color: #38bdf8; margin-top: 8px;">Total Due: $${Number(invoice.total_amount).toFixed(2)}</div>
        </div>

        <div style="text-align: center;">
          <a href="${portalUrl}" class="button" target="_blank">Pay Invoice in Portal</a>
        </div>

        <div class="footer">
          RECUR SMS Automated Billing Engine &bull; Questions? Contact support@recursms.com
        </div>
      </div>
    </body>
    </html>
  `;

  return dispatchEmail({
    to,
    subject,
    html,
    text: `Invoice ${invoice.invoice_number} for $${Number(invoice.total_amount).toFixed(2)} is due by ${invoice.due_date}.`,
    templateName: 'INVOICE_ISSUED',
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, amount: invoice.total_amount }
  });
}

/**
 * 3. Payment Receipt Email
 */
async function sendPaymentReceiptEmail({ to, payment, invoice }) {
  const subject = `✅ Payment Receipt: ${invoice.invoice_number} — RECUR SMS`;
  const portalUrl = `http://localhost:${process.env.PORT || 3000}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
        .container { max-width: 560px; margin: 0 auto; background: #131b2e; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; }
        .logo { font-size: 20px; font-weight: 800; color: #10b981; margin-bottom: 20px; }
        h1 { font-size: 22px; color: #ffffff; margin-bottom: 8px; }
        p { font-size: 14px; line-height: 1.6; color: #94a3b8; }
        .receipt-card { background: #0f172a; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .receipt-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
        .label { color: #64748b; }
        .val { color: #f1f5f9; font-weight: 500; }
        .paid-badge { display: inline-block; background: #064e3b; color: #34d399; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; margin-bottom: 12px; }
        .footer { font-size: 12px; color: #64748b; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">⚡ RECUR SMS</div>
        <span class="paid-badge">PAYMENT CONFIRMED</span>
        <h1>Payment Successful!</h1>
        <p>Thank you. Your payment for Invoice <strong>${invoice.invoice_number}</strong> has been successfully reconciled.</p>

        <div class="receipt-card">
          <div style="font-size: 13px; color: #64748b; margin-bottom: 4px;">AMOUNT PAID</div>
          <div style="font-size: 28px; font-weight: 800; color: #34d399; margin-bottom: 16px;">$${Number(payment.amount).toFixed(2)}</div>
          
          <div style="border-top: 1px solid #1e293b; padding-top: 12px;">
            <p style="margin: 4px 0; font-size: 13px;"><strong style="color: #64748b;">Method:</strong> ${payment.payment_method || payment.method}</p>
            <p style="margin: 4px 0; font-size: 13px;"><strong style="color: #64748b;">Reference:</strong> <span style="font-family: monospace; color: #38bdf8;">${payment.transaction_reference || payment.reference || 'N/A'}</span></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong style="color: #64748b;">Invoice Status:</strong> <span style="color: #34d399; font-weight: bold;">PAID</span></p>
          </div>
        </div>

        <p>You can review your full payment history and active subscriptions anytime in your <a href="${portalUrl}" style="color: #38bdf8; text-decoration: none;">Customer Portal</a>.</p>

        <div class="footer">
          RECUR SMS &bull; Automated Revenue Intelligence & Payment Processing
        </div>
      </div>
    </body>
    </html>
  `;

  return dispatchEmail({
    to,
    subject,
    html,
    text: `Payment of $${Number(payment.amount).toFixed(2)} received for Invoice ${invoice.invoice_number}. Reference: ${payment.transaction_reference || payment.reference}`,
    templateName: 'PAYMENT_RECEIPT',
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, amount: payment.amount }
  });
}

/**
 * 4. Overdue / Dunning Notice Email
 */
async function sendDunningNoticeEmail({ to, invoice, daysOverdue = 1 }) {
  const subject = `⚠️ URGENT: Invoice ${invoice.invoice_number} is Overdue — RECUR SMS`;
  const portalUrl = `http://localhost:${process.env.PORT || 3000}`;
  const balanceDue = Number(invoice.total_amount - (invoice.paid_amount || 0)).toFixed(2);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
        .container { max-width: 560px; margin: 0 auto; background: #131b2e; border: 1px solid #7f1d1d; border-radius: 12px; padding: 32px; }
        .logo { font-size: 20px; font-weight: 800; color: #ef4444; margin-bottom: 20px; }
        .badge { display: inline-block; background: #991b1b; color: #fee2e2; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; }
        h1 { font-size: 22px; color: #ffffff; margin-top: 12px; margin-bottom: 8px; }
        p { font-size: 14px; line-height: 1.6; color: #94a3b8; }
        .alert-box { background: #450a0a; border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin: 20px 0; color: #fecaca; }
        .button { display: inline-block; background: #dc2626; color: #ffffff !important; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px; }
        .footer { font-size: 12px; color: #64748b; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">⚡ RECUR SMS</div>
        <span class="badge">OVERDUE REMINDER</span>
        <h1>Immediate Attention Required</h1>
        <p>Hello,</p>
        <p>Our records indicate that payment for Invoice <strong>${invoice.invoice_number}</strong> was due on <strong>${invoice.due_date}</strong> and is currently overdue by <strong>${daysOverdue} day(s)</strong>.</p>
        
        <div class="alert-box">
          <div style="font-weight: bold; font-size: 16px; margin-bottom: 4px;">Outstanding Balance: $${balanceDue}</div>
          <div style="font-size: 13px;">Please settle this balance immediately to avoid temporary interruption to your active subscriptions.</div>
        </div>

        <div style="text-align: center;">
          <a href="${portalUrl}" class="button" target="_blank">Settle Invoice Now</a>
        </div>

        <div class="footer">
          If you have already sent payment via wire or check, please allow 24-48 hours for bank reconciliation.
        </div>
      </div>
    </body>
    </html>
  `;

  return dispatchEmail({
    to,
    subject,
    html,
    text: `Invoice ${invoice.invoice_number} is overdue by ${daysOverdue} day(s). Outstanding balance: $${balanceDue}. Please visit ${portalUrl} to settle.`,
    templateName: 'DUNNING_NOTICE',
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, balanceDue, daysOverdue }
  });
}

module.exports = {
  getTransporter,
  dispatchEmail,
  sendPasswordResetEmail,
  sendInvoiceIssuedEmail,
  sendPaymentReceiptEmail,
  sendDunningNoticeEmail
};
