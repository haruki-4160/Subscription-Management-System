const PDFDocument = require('pdfkit');

/**
 * Formats a number as a currency string ($XX.XX)
 */
function formatCurrency(amount) {
  return '$' + Number(amount || 0).toFixed(2);
}

/**
 * Generates an executive, print-ready PDF for an Invoice
 * @param {Object} invoice - The invoice database record
 * @param {Array} items - The invoice line items
 * @param {Array} payments - Recorded payments for this invoice
 * @param {WritableStream} outputStream - Response or writable stream
 */
function generateInvoicePDF(invoice, items = [], payments = [], outputStream) {
  const doc = new PDFDocument({ margin: 45, size: 'A4' });
  doc.pipe(outputStream);

  const primaryColor = '#0f172a';
  const accentColor = '#0284c7';
  const mutedColor = '#64748b';
  const borderColor = '#e2e8f0';

  // 1. Header & Brand
  doc.fontSize(22).font('Helvetica-Bold').fillColor(accentColor).text('⚡ RECUR SMS', 45, 45);
  doc.fontSize(9).font('Helvetica').fillColor(mutedColor).text('Subscription Management & Recurring Billing Platform', 45, 72);
  doc.fontSize(8).fillColor(mutedColor).text('Brightloop Software Inc. • 100 Innovation Way, Suite 400 • billing@recursms.com', 45, 84);

  // Status Badge
  const today = new Date().toISOString().split('T')[0];
  const isPaid = invoice.status === 'Paid';
  const isOverdue = !isPaid && invoice.due_date && invoice.due_date < today;

  let badgeText = invoice.status.toUpperCase();
  let badgeColor = '#64748b';
  if (isPaid) {
    badgeText = 'PAID';
    badgeColor = '#10b981';
  } else if (isOverdue) {
    badgeText = 'OVERDUE';
    badgeColor = '#ef4444';
  } else if (invoice.status === 'Confirmed') {
    badgeText = 'UNPAID';
    badgeColor = '#0284c7';
  }

  // Draw Status Pill (Top Right)
  const badgeWidth = 90;
  const badgeHeight = 22;
  const badgeX = 550 - badgeWidth;
  doc.roundedRect(badgeX, 48, badgeWidth, badgeHeight, 4).fill(badgeColor);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff').text(badgeText, badgeX, 54, {
    width: badgeWidth,
    align: 'center'
  });

  // Top Divider
  doc.moveTo(45, 105).lineTo(550, 105).strokeColor(borderColor).stroke();

  // 2. Invoice Meta & Customer Details
  let curY = 120;
  
  // Left: Billed To
  doc.fontSize(8).font('Helvetica-Bold').fillColor(mutedColor).text('BILLED TO', 45, curY);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(primaryColor).text(invoice.customer_email || 'Valued Customer', 45, curY + 14);
  doc.fontSize(9).font('Helvetica').fillColor(mutedColor).text(`Customer ID: ${invoice.customer_id}`, 45, curY + 28);
  if (invoice.subscription_number) {
    doc.text(`Subscription: ${invoice.subscription_number}`, 45, curY + 40);
  }
  if (invoice.billing_cycle_start && invoice.billing_cycle_end) {
    doc.text(`Billing Window: ${invoice.billing_cycle_start} to ${invoice.billing_cycle_end}`, 45, curY + 52);
  }

  // Right: Invoice Meta
  const rightColX = 350;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(mutedColor).text('INVOICE DETAILS', rightColX, curY);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(accentColor).text(`Invoice #: ${invoice.invoice_number}`, rightColX, curY + 14);
  doc.fontSize(9).font('Helvetica').fillColor(primaryColor).text(`Issue Date: ${invoice.issue_date}`, rightColX, curY + 28);
  doc.text(`Payment Due: ${invoice.due_date}`, rightColX, curY + 40);
  doc.text(`Terms: Net 7 / Immediate`, rightColX, curY + 52);

  // 3. Line Items Table Header
  curY = 195;
  doc.rect(45, curY, 505, 22).fill('#1e293b');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
  doc.text('DESCRIPTION', 55, curY + 7);
  doc.text('QTY', 310, curY + 7, { width: 40, align: 'center' });
  doc.text('UNIT PRICE', 355, curY + 7, { width: 65, align: 'right' });
  doc.text('TAX / DISC', 425, curY + 7, { width: 55, align: 'right' });
  doc.text('TOTAL', 485, curY + 7, { width: 60, align: 'right' });

  curY += 22;

  // Render Line Items
  const tableRows = items.length > 0 ? items : [
    {
      product_name: 'Subscription Service Plan',
      quantity: 1,
      unit_price: invoice.subtotal || invoice.total_amount,
      tax_amount: invoice.tax_total,
      discount_amount: invoice.discount_total,
      total_amount: invoice.total_amount
    }
  ];

  tableRows.forEach((item, idx) => {
    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    doc.rect(45, curY, 505, 20).fill(rowBg);

    doc.fontSize(8).font('Helvetica').fillColor(primaryColor);
    doc.text(item.product_name, 55, curY + 6, { width: 250, ellipsis: true });
    doc.text(String(item.quantity || 1), 310, curY + 6, { width: 40, align: 'center' });
    doc.text(formatCurrency(item.unit_price), 355, curY + 6, { width: 65, align: 'right' });
    
    const taxDiscText = item.discount_amount > 0 ? `-${formatCurrency(item.discount_amount)}` : (item.tax_amount > 0 ? `+${formatCurrency(item.tax_amount)}` : '$0.00');
    doc.text(taxDiscText, 425, curY + 6, { width: 55, align: 'right' });
    doc.font('Helvetica-Bold').text(formatCurrency(item.total_amount), 485, curY + 6, { width: 60, align: 'right' });

    doc.moveTo(45, curY + 20).lineTo(550, curY + 20).strokeColor(borderColor).stroke();
    curY += 20;
  });

  // 4. Financial Summary Card
  curY += 15;
  const summaryBoxWidth = 220;
  const summaryBoxX = 550 - summaryBoxWidth;

  doc.rect(summaryBoxX, curY, summaryBoxWidth, 90).fill('#f8fafc');
  doc.rect(summaryBoxX, curY, summaryBoxWidth, 90).strokeColor(borderColor).stroke();

  doc.fontSize(8).font('Helvetica').fillColor(mutedColor);
  doc.text('Subtotal:', summaryBoxX + 12, curY + 10);
  doc.font('Helvetica').fillColor(primaryColor).text(formatCurrency(invoice.subtotal), summaryBoxX + 12, curY + 10, { width: 196, align: 'right' });

  if (invoice.discount_total > 0) {
    doc.font('Helvetica').fillColor('#10b981').text('Discount Applied:', summaryBoxX + 12, curY + 24);
    doc.text(`-${formatCurrency(invoice.discount_total)}`, summaryBoxX + 12, curY + 24, { width: 196, align: 'right' });
  }

  if (invoice.tax_total > 0) {
    doc.font('Helvetica').fillColor(mutedColor).text('Tax (Itemized):', summaryBoxX + 12, curY + 38);
    doc.fillColor(primaryColor).text(`+${formatCurrency(invoice.tax_total)}`, summaryBoxX + 12, curY + 38, { width: 196, align: 'right' });
  }

  // Total Due Line
  doc.moveTo(summaryBoxX + 10, curY + 54).lineTo(summaryBoxX + 210, curY + 54).strokeColor(borderColor).stroke();
  doc.fontSize(10).font('Helvetica-Bold').fillColor(primaryColor).text('Total Amount:', summaryBoxX + 12, curY + 60);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(accentColor).text(formatCurrency(invoice.total_amount), summaryBoxX + 12, curY + 60, { width: 196, align: 'right' });

  const balanceDue = Math.max(0, invoice.total_amount - (invoice.paid_amount || 0));
  doc.fontSize(8).font('Helvetica-Bold').fillColor(balanceDue > 0 ? '#ef4444' : '#10b981');
  doc.text(balanceDue > 0 ? `Balance Due: ${formatCurrency(balanceDue)}` : 'Balance Due: $0.00 (PAID IN FULL)', summaryBoxX + 12, curY + 76, { width: 196, align: 'right' });

  // 5. Payment Ledger Section (if payments exist)
  if (payments && payments.length > 0) {
    curY += 105;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor).text('PAYMENT RECONCILIATION LEDGER', 45, curY);
    curY += 14;

    payments.forEach(p => {
      doc.rect(45, curY, 505, 18).fill('#f1f5f9');
      doc.fontSize(8).font('Helvetica').fillColor(primaryColor);
      doc.text(`Date: ${new Date(p.payment_date || Date.now()).toLocaleDateString()}`, 55, curY + 5);
      doc.text(`Method: ${p.payment_method}`, 175, curY + 5);
      doc.text(`Ref: ${p.transaction_reference || 'N/A'}`, 280, curY + 5);
      doc.font('Helvetica-Bold').fillColor('#10b981').text(`Paid: ${formatCurrency(p.amount)}`, 440, curY + 5, { width: 100, align: 'right' });
      curY += 20;
    });
  }

  // 6. Footer & Payment Instructions
  const footerY = 740;
  doc.moveTo(45, footerY).lineTo(550, footerY).strokeColor(borderColor).stroke();
  doc.fontSize(8).font('Helvetica-Bold').fillColor(primaryColor).text('Payment Instructions & Electronic Transfer Details', 45, footerY + 10);
  doc.fontSize(7.5).font('Helvetica').fillColor(mutedColor).text(
    'Please reference the Invoice Number in all wire or ACH remittances. Bank: Silicon Valley Commercial Bank | Routing: 121000358 | Account: 9876543210.\nThank you for choosing Brightloop RECUR SMS. Questions? Email billing@recursms.com or call support.',
    45, footerY + 22, { width: 505, lineGap: 2 }
  );

  doc.end();
}

/**
 * Generates an executive, print-ready PDF for a Sales Quotation / Contract
 * @param {Object} subscription - Subscription in Draft/Quotation status
 * @param {Array} items - Line items for this quotation
 * @param {WritableStream} outputStream - Response stream
 */
function generateQuotationPDF(subscription, items = [], outputStream) {
  const doc = new PDFDocument({ margin: 45, size: 'A4' });
  doc.pipe(outputStream);

  const primaryColor = '#0f172a';
  const accentColor = '#2563eb';
  const mutedColor = '#64748b';
  const borderColor = '#e2e8f0';

  // Header
  doc.fontSize(22).font('Helvetica-Bold').fillColor(accentColor).text('⚡ RECUR SMS', 45, 45);
  doc.fontSize(9).font('Helvetica').fillColor(mutedColor).text('Enterprise Sales Quotation & Subscription Agreement', 45, 72);

  // Status Badge
  const badgeWidth = 100;
  const badgeHeight = 22;
  const badgeX = 550 - badgeWidth;
  doc.roundedRect(badgeX, 48, badgeWidth, badgeHeight, 4).fill('#3b82f6');
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff').text('QUOTATION', badgeX, 54, {
    width: badgeWidth,
    align: 'center'
  });

  doc.moveTo(45, 105).lineTo(550, 105).strokeColor(borderColor).stroke();

  // Quote Metadata
  let curY = 120;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(mutedColor).text('PREPARED FOR', 45, curY);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(primaryColor).text(subscription.customer_email || 'Prospective Enterprise Client', 45, curY + 14);
  doc.fontSize(9).font('Helvetica').fillColor(mutedColor).text(`Quote Number: ${subscription.subscription_number}`, 45, curY + 28);
  doc.text(`Governing Plan: ${subscription.plan_name || 'Standard Plan'} (${(subscription.billing_interval || 'monthly').toUpperCase()})`, 45, curY + 40);

  const rightColX = 350;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(mutedColor).text('PROPOSAL VALIDITY', rightColX, curY);
  doc.fontSize(9).font('Helvetica').fillColor(primaryColor).text(`Start Date: ${subscription.start_date || 'Upon Acceptance'}`, rightColX, curY + 14);
  doc.text(`Expiry / Validity: ${subscription.expiry_date || 'Valid for 15 Days'}`, rightColX, curY + 28);
  doc.text(`Payment Terms: ${subscription.payment_terms || 'Net 15'}`, rightColX, curY + 40);

  // Line Items
  curY = 185;
  doc.rect(45, curY, 505, 22).fill('#1e293b');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
  doc.text('ITEM & SPECIFICATIONS', 55, curY + 7);
  doc.text('QTY', 320, curY + 7, { width: 40, align: 'center' });
  doc.text('UNIT PRICE', 365, curY + 7, { width: 75, align: 'right' });
  doc.text('ESTIMATED RECURRING', 445, curY + 7, { width: 100, align: 'right' });

  curY += 22;
  let quoteSubtotal = 0;

  items.forEach((item, idx) => {
    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    doc.rect(45, curY, 505, 20).fill(rowBg);

    const desc = item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name;
    const itemTotal = Number(item.amount || (item.quantity * item.unit_price) || 0);
    quoteSubtotal += itemTotal;

    doc.fontSize(8).font('Helvetica').fillColor(primaryColor);
    doc.text(desc, 55, curY + 6, { width: 260, ellipsis: true });
    doc.text(String(item.quantity || 1), 320, curY + 6, { width: 40, align: 'center' });
    doc.text(formatCurrency(item.unit_price), 365, curY + 6, { width: 75, align: 'right' });
    doc.font('Helvetica-Bold').text(formatCurrency(itemTotal), 445, curY + 6, { width: 100, align: 'right' });

    doc.moveTo(45, curY + 20).lineTo(550, curY + 20).strokeColor(borderColor).stroke();
    curY += 20;
  });

  // Summary
  curY += 15;
  const summaryBoxWidth = 240;
  const summaryBoxX = 550 - summaryBoxWidth;
  doc.rect(summaryBoxX, curY, summaryBoxWidth, 50).fill('#f8fafc');
  doc.rect(summaryBoxX, curY, summaryBoxWidth, 50).strokeColor(borderColor).stroke();

  doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor).text('Estimated Total / Cadence:', summaryBoxX + 12, curY + 18);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(accentColor).text(formatCurrency(quoteSubtotal), summaryBoxX + 12, curY + 18, { width: 216, align: 'right' });

  // Signature / Acceptance block
  const signY = 620;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor).text('ACCEPTANCE & AUTHORIZED SIGNATURE', 45, signY);
  doc.fontSize(8).font('Helvetica').fillColor(mutedColor).text(
    'By signing below, customer agrees to the services, pricing, and terms outlined in this quotation.',
    45, signY + 14
  );

  // Sign lines
  doc.moveTo(45, signY + 70).lineTo(250, signY + 70).strokeColor(borderColor).stroke();
  doc.fontSize(8).font('Helvetica').fillColor(mutedColor).text('Customer Authorized Signature & Date', 45, signY + 75);

  doc.moveTo(345, signY + 70).lineTo(550, signY + 70).strokeColor(borderColor).stroke();
  doc.text('Brightloop Software Representative & Date', 345, signY + 75);

  doc.end();
}

module.exports = {
  generateInvoicePDF,
  generateQuotationPDF
};
