const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Initialize DB and ensure tables exist
require('./db');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const staffRoutes = require('./routes/staffRoutes');
const customerRoutes = require('./routes/customerRoutes');
const financeRoutes = require('./routes/financeRoutes');
const { runAutomatedBillingBatch } = require('./billingEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/finance', financeRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'HEALTHY', timestamp: new Date().toISOString() });
});

// Catch-all route to serve SPA index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Periodic background billing trigger (runs every hour in background)
setInterval(() => {
  try {
    const res = runAutomatedBillingBatch();
    if (res.invoicesCreated > 0) {
      console.log(`[AutoBillingWorker] Batch ${res.batchId} executed: ${res.invoicesCreated} invoices created.`);
    }
  } catch (err) {
    console.error('[AutoBillingWorker] Scheduled run failed:', err);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  RECUR SMS - Subscription Management System is Live!  `);
  console.log(`  Port: http://localhost:${PORT}                      `);
  console.log(`  Admin User: ashishsunil4160@gmail.com               `);
  console.log(`=======================================================`);
});

module.exports = app;
