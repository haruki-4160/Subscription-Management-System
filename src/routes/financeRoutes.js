const express = require('express');
const db = require('../db');
const { authMiddleware, requireStaffOrAdmin } = require('../auth');

const router = express.Router();
router.use(authMiddleware, requireStaffOrAdmin);

router.get('/summary', (req, res) => {
  const startBenchmark = process.hrtime();
  const today = new Date().toISOString().split('T')[0];

  // 1. Active Subscriptions Count & Status Distribution
  const activeSubs = db.prepare(`
    SELECT COUNT(*) as count FROM subscriptions WHERE status = 'Active'
  `).get().count;

  const subDistribution = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM subscriptions 
    GROUP BY status
  `).all();

  // 2. Revenue & Receivables Aggregates (Indexed)
  const revenueAgg = db.prepare(`
    SELECT 
      COALESCE(SUM(paid_amount), 0) as total_revenue_collected,
      COALESCE(SUM(CASE WHEN status != 'Paid' AND status != 'Cancelled' THEN (total_amount - paid_amount) ELSE 0 END), 0) as total_receivables_owed,
      COALESCE(SUM(CASE WHEN due_date < ? AND status != 'Paid' AND status != 'Cancelled' THEN 1 ELSE 0 END), 0) as overdue_invoices_count,
      COALESCE(SUM(CASE WHEN due_date < ? AND status != 'Paid' AND status != 'Cancelled' THEN (total_amount - paid_amount) ELSE 0 END), 0) as overdue_amount
    FROM invoices
  `).get(today, today);

  // 3. Monthly Billed vs Collected Trend
  const monthlyTrend = db.prepare(`
    SELECT 
      strftime('%Y-%m', issue_date) as month,
      COALESCE(SUM(total_amount), 0) as billed,
      COALESCE(SUM(paid_amount), 0) as collected
    FROM invoices
    GROUP BY month
    ORDER BY month ASC
    LIMIT 6
  `).all();

  // 4. Overdue Invoices List (Fast indexed scan)
  const overdueInvoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.due_date, (i.total_amount - i.paid_amount) as amount_due,
           u.email as customer_email, s.subscription_number
    FROM invoices i
    JOIN users u ON i.customer_id = u.id
    LEFT JOIN subscriptions s ON i.subscription_id = s.id
    WHERE i.due_date < ? AND i.status != 'Paid' AND i.status != 'Cancelled'
    ORDER BY i.due_date ASC
    LIMIT 100
  `).all(today);

  // 5. Recent Payment Transactions
  const recentPayments = db.prepare(`
    SELECT p.*, i.invoice_number, u.email as customer_email
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    JOIN users u ON i.customer_id = u.id
    ORDER BY p.payment_date DESC
    LIMIT 20
  `).all();

  const diff = process.hrtime(startBenchmark);
  const queryTimeMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);

  res.json({
    metrics: {
      active_subscriptions: activeSubs,
      total_revenue_collected: revenueAgg.total_revenue_collected,
      total_receivables_owed: revenueAgg.total_receivables_owed,
      overdue_invoices_count: revenueAgg.overdue_invoices_count,
      overdue_amount: revenueAgg.overdue_amount
    },
    charts: {
      subscription_distribution: subDistribution,
      revenue_split: {
        collected: revenueAgg.total_revenue_collected,
        pending: Math.max(0, revenueAgg.total_receivables_owed - revenueAgg.overdue_amount),
        overdue: revenueAgg.overdue_amount
      },
      monthly_trend: monthlyTrend
    },
    overdue_invoices: overdueInvoices,
    recent_payments: recentPayments,
    performance: {
      execution_time_ms: Number(queryTimeMs),
      sla_status: queryTimeMs < 2000 ? 'PASSED (< 2.0s SLA)' : 'SLOW'
    }
  });
});

module.exports = router;
