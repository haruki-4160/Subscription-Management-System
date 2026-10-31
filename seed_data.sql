-- ====================================================================
-- RECUR / SMS Portal (Subscription Management System)
-- Enterprise Test Dataset & Seed Script
-- Compatible with PostgreSQL & SQLite
-- ====================================================================

-- 1. USERS & ROLES
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'customer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. PRODUCTS & VARIANTS
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_variants (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id),
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    attributes JSONB DEFAULT '{}',
    price_delta NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 3. PLANS
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    billing_interval VARCHAR(50) NOT NULL,
    interval_count INT NOT NULL DEFAULT 1,
    base_price NUMERIC(12, 4) NOT NULL CHECK (base_price >= 0),
    setup_fee NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    trial_days INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. TAXES & DISCOUNTS
CREATE TABLE IF NOT EXISTS tax_rates (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    rate_pct NUMERIC(5, 2) NOT NULL CHECK (rate_pct >= 0),
    country VARCHAR(100) NOT NULL,
    state VARCHAR(100),
    is_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS discounts (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    discount_type VARCHAR(50) NOT NULL,
    value NUMERIC(12, 4) NOT NULL CHECK (value > 0),
    start_date DATE NOT NULL,
    end_date DATE,
    max_uses INT,
    current_uses INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 5. QUOTATIONS & TEMPLATES
CREATE TABLE IF NOT EXISTS quotation_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    lines_data JSONB NOT NULL,
    default_terms TEXT
);

CREATE TABLE IF NOT EXISTS quotations (
    id SERIAL PRIMARY KEY,
    quote_number VARCHAR(100) UNIQUE NOT NULL,
    customer_id INT NOT NULL REFERENCES users(id),
    created_by_id INT NOT NULL REFERENCES users(id),
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    subtotal NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    discount_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    tax_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    total_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    valid_until DATE NOT NULL,
    terms TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotation_items (
    id SERIAL PRIMARY KEY,
    quotation_id INT NOT NULL REFERENCES quotations(id),
    plan_id INT NOT NULL REFERENCES plans(id),
    variant_id INT REFERENCES product_variants(id),
    description VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(12, 4) NOT NULL,
    discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12, 4) NOT NULL
);

-- 6. SUBSCRIPTIONS & HISTORY
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    subscription_number VARCHAR(100) UNIQUE NOT NULL,
    customer_id INT NOT NULL REFERENCES users(id),
    quotation_id INT REFERENCES quotations(id),
    plan_id INT NOT NULL REFERENCES plans(id),
    variant_id INT REFERENCES product_variants(id),
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    current_period_start DATE NOT NULL,
    current_period_end DATE NOT NULL,
    next_billing_date DATE NOT NULL,
    trial_end_date DATE,
    pause_start_date DATE,
    grace_period_end_date DATE,
    discount_id INT REFERENCES discounts(id),
    discount_expiry_date DATE,
    auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
    cancellation_reason TEXT,
    canceled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_history (
    id SERIAL PRIMARY KEY,
    subscription_id INT NOT NULL REFERENCES subscriptions(id),
    from_status VARCHAR(50) NOT NULL,
    to_status VARCHAR(50) NOT NULL,
    triggered_by_id INT REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. INVOICES & INVOICE ITEMS
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    subscription_id INT NOT NULL REFERENCES subscriptions(id),
    customer_id INT NOT NULL REFERENCES users(id),
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'POSTED',
    subtotal NUMERIC(12, 4) NOT NULL,
    discount_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    tax_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    total_amount NUMERIC(12, 4) NOT NULL,
    paid_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    balance_due NUMERIC(12, 4) NOT NULL,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id INT NOT NULL REFERENCES invoices(id),
    plan_id INT REFERENCES plans(id),
    variant_id INT REFERENCES product_variants(id),
    description VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 4) NOT NULL,
    discount_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    tax_rate_id INT REFERENCES tax_rates(id),
    tax_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    proration_ratio NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
    line_total NUMERIC(12, 4) NOT NULL
);

-- 8. PAYMENTS & ALLOCATIONS
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    payment_number VARCHAR(100) UNIQUE NOT NULL,
    customer_id INT NOT NULL REFERENCES users(id),
    amount NUMERIC(12, 4) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL,
    transaction_reference VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    recorded_by_id INT NOT NULL REFERENCES users(id),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id SERIAL PRIMARY KEY,
    payment_id INT NOT NULL REFERENCES payments(id),
    invoice_id INT NOT NULL REFERENCES invoices(id),
    allocated_amount NUMERIC(12, 4) NOT NULL CHECK (allocated_amount > 0),
    allocated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. BILLING EVENTS (AUDIT TRAIL)
CREATE TABLE IF NOT EXISTS billing_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT NOT NULL,
    actor_id INT REFERENCES users(id),
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. REVENUE ALERTS (INTELLIGENCE CENTRE)
CREATE TABLE IF NOT EXISTS revenue_alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT NOT NULL,
    revenue_at_risk NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by_id INT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- SEED DATA INGESTION
-- ====================================================================

-- 1. USERS
INSERT INTO users (id, email, hashed_password, full_name, company_name, role, is_active) VALUES
(1, 'admin@recur.io', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Sarah Connor (Admin)', 'RECUR Global', 'admin', TRUE),
(2, 'staff@recur.io', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Michael Scott (Staff)', 'RECUR Global', 'staff', TRUE),
(3, 'billing@acmecorp.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Alex Vance', 'Acme Corp', 'customer', TRUE),
(4, 'finance@globex.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Bob Vance', 'Globex Industries', 'customer', TRUE),
(5, 'accounts@soylent.io', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Carol Danvers', 'Soylent Tech', 'customer', TRUE),
(6, 'ops@hooli.xyz', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Gavin Belson', 'Hooli Corp', 'customer', TRUE),
(7, 'finance@starkindustries.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Pepper Potts', 'Stark Industries', 'customer', TRUE),
(8, 'billing@wayneenterprises.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Lucius Fox', 'Wayne Enterprises', 'customer', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2. PRODUCTS
INSERT INTO products (id, code, name, description, is_active) VALUES
(1, 'PROD_CLOUD_PLATFORM', 'Enterprise Cloud Platform', 'High availability Kubernetes compute clusters with dedicated resource pinning.', TRUE),
(2, 'PROD_API_GATEWAY', 'API Acceleration Gateway', 'Globally distributed edge gateway with intelligent caching and TLS termination.', TRUE),
(3, 'PROD_SECURITY_SUITE', 'Zero-Trust Security & Compliance', 'Continuous automated compliance scanner, real-time threat detection, and audit vaults.', TRUE),
(4, 'PROD_DEDICATED_SUPPORT', '24/7 Mission Critical Support SLA', 'Guaranteed 15-minute response SLA with dedicated Solutions Architect.', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2.1 VARIANTS
INSERT INTO product_variants (id, product_id, sku, name, attributes, price_delta, is_active) VALUES
(1, 1, 'VAR_POD_STARTER', 'Starter Pod (4 vCPU / 16GB RAM)', '{"vcpu": 4, "ram_gb": 16}', 0.0000, TRUE),
(2, 1, 'VAR_POD_SCALE', 'Scale Pod (16 vCPU / 64GB RAM)', '{"vcpu": 16, "ram_gb": 64}', 150.0000, TRUE),
(3, 1, 'VAR_POD_HYPER', 'Hyper Pod (64 vCPU / 256GB RAM)', '{"vcpu": 64, "ram_gb": 256}', 600.0000, TRUE),
(4, 2, 'VAR_API_STANDARD', 'Standard Throughput (25k req/min)', '{"rpm": 25000}', 0.0000, TRUE),
(5, 2, 'VAR_API_HIGH', 'High Throughput (100k req/min)', '{"rpm": 100000}', 200.0000, TRUE),
(6, 3, 'VAR_SEC_SOC2', 'SOC2 Type II Continuous Monitor', '{"compliance": "SOC2_TYPE_2"}', 100.0000, TRUE),
(7, 3, 'VAR_SEC_HIPAA', 'HIPAA & GDPR Enterprise Guard', '{"compliance": ["HIPAA", "GDPR"]}', 250.0000, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 3. PLANS
INSERT INTO plans (id, product_id, code, name, billing_interval, interval_count, base_price, setup_fee, trial_days, is_active) VALUES
(1, 1, 'PLAN_CLOUD_MONTHLY', 'Cloud Platform Monthly', 'monthly', 1, 199.0000, 50.0000, 14, TRUE),
(2, 1, 'PLAN_CLOUD_ANNUAL', 'Cloud Platform Annual (Save 20%)', 'annual', 1, 1990.0000, 0.0000, 30, TRUE),
(3, 2, 'PLAN_API_MONTHLY', 'API Gateway Pro Monthly', 'monthly', 1, 149.0000, 0.0000, 0, TRUE),
(4, 3, 'PLAN_SEC_ANNUAL', 'Zero-Trust Security Annual', 'annual', 1, 1200.0000, 100.0000, 14, TRUE),
(5, 1, 'PLAN_SANDBOX_WEEKLY', 'Developer Sandbox Pilot', 'weekly', 1, 49.0000, 0.0000, 7, TRUE),
(6, 4, 'PLAN_SUPPORT_MONTHLY', 'Dedicated Concierge Support', 'monthly', 1, 500.0000, 0.0000, 0, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 4. TAX RATES
INSERT INTO tax_rates (id, code, name, rate_pct, country, state, is_inclusive, is_active) VALUES
(1, 'VAT_UK_20', 'United Kingdom Standard VAT (20%)', 20.00, 'United Kingdom', NULL, FALSE, TRUE),
(2, 'US_CA_85', 'California State Tax (8.5%)', 8.50, 'United States', 'California', FALSE, TRUE),
(3, 'US_NY_88', 'New York Sales Tax (8.875%)', 8.88, 'United States', 'New York', FALSE, TRUE),
(4, 'GST_IN_18', 'India Integrated GST (18%)', 18.00, 'India', NULL, FALSE, TRUE),
(5, 'TAX_EXEMPT', 'Tax Exempt / Cross-Border B2B', 0.00, 'Global', NULL, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 4.1 DISCOUNTS
INSERT INTO discounts (id, code, name, discount_type, value, start_date, end_date, max_uses, current_uses, is_active) VALUES
(1, 'EARLYBIRD20', 'Early Bird 20% Discount', 'percentage', 20.0000, '2026-01-01', '2026-12-31', 100, 24, TRUE),
(2, 'EXPIRINGPROMO', 'Q4 Retention Incentive (15%)', 'percentage', 15.0000, '2026-10-01', '2026-11-07', 50, 48, TRUE),
(3, 'STARTUP50', '$50 Onboarding Credit', 'fixed_amount', 50.0000, '2026-01-01', '2026-12-31', 500, 89, TRUE),
(4, 'ENTERPRISE30', 'Strategic Partner 30% Off', 'percentage', 30.0000, '2026-01-01', '2027-01-01', 10, 3, TRUE),
(5, 'EXPIRED_CODE', '2025 Winter Flash Sale', 'percentage', 25.0000, '2025-11-01', '2025-12-31', 20, 20, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 5. QUOTATION TEMPLATES
INSERT INTO quotation_templates (id, name, description, lines_data, default_terms) VALUES
(1, 'Startup Cloud Growth Pack', 'Starter Pod compute + Standard API Gateway with 10% promo discount.', '[{"plan_id": 1, "variant_id": 1, "quantity": 1, "discount_pct": 10.00}, {"plan_id": 3, "variant_id": 4, "quantity": 1, "discount_pct": 10.00}]', 'Payment due on receipt. Auto-renews monthly.'),
(2, 'Enterprise Compliance Bundle', 'Scale Pod compute + High API Gateway + SOC2 Compliance + 24/7 Concierge Support.', '[{"plan_id": 2, "variant_id": 2, "quantity": 2, "discount_pct": 15.00}, {"plan_id": 3, "variant_id": 5, "quantity": 1, "discount_pct": 15.00}, {"plan_id": 4, "variant_id": 6, "quantity": 1, "discount_pct": 10.00}, {"plan_id": 6, "variant_id": null, "quantity": 1, "discount_pct": 0.00}]', 'Net 30 terms. Billed annually with 30-day money-back guarantee.')
ON CONFLICT (id) DO NOTHING;

-- 5.1 QUOTATIONS
INSERT INTO quotations (id, quote_number, customer_id, created_by_id, status, subtotal, discount_amount, tax_amount, total_amount, valid_until, terms, created_at) VALUES
(1, 'QT-2026-0001', 3, 2, 'CONVERTED', 348.0000, 34.8000, 62.6400, 375.8400, '2026-02-15', 'Net 15 terms. Successfully converted to SUB-2026-0001.', '2026-01-10 10:00:00+00'),
(2, 'QT-2026-0002', 7, 2, 'ACCEPTED', 5600.0000, 560.0000, 428.4000, 5468.4000, '2026-11-15', 'Strategic Enterprise SLA. Approved by client CFO.', '2026-10-20 14:30:00+00'),
(3, 'QT-2026-0003', 8, 2, 'SENT', 1490.0000, 149.0000, 113.9900, 1454.9900, '2026-11-10', 'Trial quote awaiting security review.', '2026-10-25 09:15:00+00'),
(4, 'QT-2026-0004', 6, 2, 'DRAFT', 890.0000, 0.0000, 75.6500, 965.6500, '2026-11-30', 'Draft proposal for compute expansion.', '2026-10-28 16:45:00+00'),
(5, 'QT-2026-0005', 4, 2, 'EXPIRED', 650.0000, 65.0000, 49.7300, 634.7300, '2026-09-01', 'Client requested deferred evaluation.', '2026-08-01 11:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO quotation_items (id, quotation_id, plan_id, variant_id, description, quantity, unit_price, discount_pct, line_total) VALUES
(1, 1, 1, 1, 'Cloud Platform Monthly - Starter Pod', 1, 199.0000, 10.00, 179.1000),
(2, 1, 3, 4, 'API Gateway Pro Monthly', 1, 149.0000, 10.00, 134.1000),
(3, 2, 2, 2, 'Cloud Platform Annual - Scale Pod Bundle', 2, 2300.0000, 10.00, 4140.0000),
(4, 2, 4, 6, 'Zero-Trust Security Annual Pack', 1, 1000.0000, 10.00, 900.0000)
ON CONFLICT (id) DO NOTHING;

-- 6. SUBSCRIPTIONS (Covering ALL Lifecycle States & Intelligence Heuristics)
-- State 1: ACTIVE (Healthy, auto-renew, Acme Corp)
-- State 2: ACTIVE (MISSED RENEWAL scenario! next_billing_date is 3 days past, Globex)
-- State 3: IN_GRACE_PERIOD (Critical Grace Breach! Overdue invoice 25 days past, Expiring promo coupon, Soylent)
-- State 4: PAUSED (Customer requested hold during migration, Hooli)
-- State 5: ACTIVE (High-value Enterprise multi-seat contract, Stark Industries)
-- State 6: CANCELED (Churned customer, cancellation reason logged, Wayne Enterprises)
INSERT INTO subscriptions (id, subscription_number, customer_id, quotation_id, plan_id, variant_id, status, current_period_start, current_period_end, next_billing_date, trial_end_date, pause_start_date, grace_period_end_date, discount_id, discount_expiry_date, auto_renew, cancellation_reason, canceled_at, created_at) VALUES
(1, 'SUB-2026-0001', 3, 1, 1, 1, 'ACTIVE', '2026-10-21', '2026-11-20', '2026-11-20', NULL, NULL, NULL, 1, '2026-12-31', TRUE, NULL, NULL, '2026-01-15 10:00:00+00'),
(2, 'SUB-2026-0002', 4, NULL, 2, 2, 'ACTIVE', '2025-10-28', '2026-10-28', '2026-10-28', NULL, NULL, NULL, NULL, NULL, TRUE, NULL, NULL, '2025-10-28 09:30:00+00'),
(3, 'SUB-2026-0003', 5, NULL, 1, 2, 'IN_GRACE_PERIOD', '2026-09-21', '2026-10-21', '2026-10-21', NULL, NULL, '2026-11-05', 2, '2026-11-07', TRUE, NULL, NULL, '2026-05-10 14:00:00+00'),
(4, 'SUB-2026-0004', 6, NULL, 3, 4, 'PAUSED', '2026-09-01', '2026-10-01', '2026-11-15', NULL, '2026-09-25', NULL, NULL, NULL, TRUE, NULL, NULL, '2026-04-12 11:20:00+00'),
(5, 'SUB-2026-0005', 7, 2, 2, 3, 'ACTIVE', '2026-10-01', '2027-10-01', '2027-10-01', NULL, NULL, NULL, 4, '2027-01-01', TRUE, NULL, NULL, '2026-10-01 08:00:00+00'),
(6, 'SUB-2026-0006', 8, NULL, 1, 1, 'CANCELED', '2026-07-01', '2026-08-01', '2026-08-01', '2026-07-15', NULL, NULL, NULL, NULL, FALSE, 'Migrated internal infrastructure to on-premise hardware cluster.', '2026-08-01 17:00:00+00', '2026-07-01 12:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 6.1 SUBSCRIPTION HISTORY (Audit Trail)
INSERT INTO subscription_history (id, subscription_id, from_status, to_status, triggered_by_id, reason, created_at) VALUES
(1, 1, 'DRAFT', 'ACTIVE', 1, 'Initial subscription converted and activated from approved quotation QT-2026-0001.', '2026-01-15 10:05:00+00'),
(2, 3, 'ACTIVE', 'IN_GRACE_PERIOD', NULL, 'Automated Dunning engine: invoice INV-2026-0002 overdue past 15-day tolerance threshold.', '2026-10-22 00:01:00+00'),
(3, 4, 'ACTIVE', 'PAUSED', 2, 'Customer ticket #4912: Paused billing during cloud infrastructure overhaul.', '2026-09-25 15:30:00+00'),
(4, 6, 'ACTIVE', 'CANCELED', 2, 'Client cancellation notice served and validated.', '2026-08-01 17:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 7. INVOICES (Deterministic Financials, All Statuses Represented)
-- INV-2026-0001: PAID (Acme Corp, full settlement)
-- INV-2026-0002: OVERDUE (Soylent Tech, $355.98 unpaid, triggers Grace Breach alert)
-- INV-2026-0003: PARTIALLY_PAID (Stark Industries, $5,468.40 total, $3,000 paid, $2,468.40 balance due)
-- INV-2026-0004: POSTED (Acme Corp, current period invoice due in 15 days)
-- INV-2026-0005: VOID (Billing correction credit re-issue)
INSERT INTO invoices (id, invoice_number, subscription_id, customer_id, billing_period_start, billing_period_end, due_date, status, subtotal, discount_amount, tax_amount, total_amount, paid_amount, balance_due, idempotency_key, created_at) VALUES
(1, 'INV-2026-0001', 1, 3, '2026-09-21', '2026-10-20', '2026-10-05', 'PAID', 199.0000, 39.8000, 31.8400, 191.0400, 191.0400, 0.0000, 'sub_1_2026-09-21_2026-10-20', '2026-09-21 00:00:01+00'),
(2, 'INV-2026-0002', 3, 5, '2026-09-21', '2026-10-21', '2026-10-06', 'OVERDUE', 349.0000, 52.3500, 59.3300, 355.9800, 0.0000, 355.9800, 'sub_3_2026-09-21_2026-10-21', '2026-09-21 00:00:01+00'),
(3, 'INV-2026-0003', 5, 7, '2026-10-01', '2027-10-01', '2026-10-15', 'PARTIALLY_PAID', 5600.0000, 560.0000, 428.4000, 5468.4000, 3000.0000, 2468.4000, 'sub_5_2026-10-01_2027-10-01', '2026-10-01 00:00:01+00'),
(4, 'INV-2026-0004', 1, 3, '2026-10-21', '2026-11-20', '2026-11-05', 'POSTED', 199.0000, 39.8000, 31.8400, 191.0400, 0.0000, 191.0400, 'sub_1_2026-10-21_2026-11-20', '2026-10-21 00:00:01+00'),
(5, 'INV-2026-0005', 1, 3, '2026-08-21', '2026-09-20', '2026-09-05', 'VOID', 199.0000, 0.0000, 39.8000, 238.8000, 0.0000, 238.8000, 'sub_1_2026-08-21_2026-09-20_void', '2026-08-21 00:00:01+00')
ON CONFLICT (id) DO NOTHING;

-- 7.1 INVOICE ITEMS
INSERT INTO invoice_items (id, invoice_id, plan_id, variant_id, description, quantity, unit_price, discount_amount, tax_rate_id, tax_amount, proration_ratio, line_total) VALUES
(1, 1, 1, 1, 'Cloud Platform Monthly - Starter Pod', 1, 199.0000, 39.8000, 1, 31.8400, 1.0000, 191.0400),
(2, 2, 1, 2, 'Cloud Platform Monthly - Scale Pod Upgrade', 1, 349.0000, 52.3500, 1, 59.3300, 1.0000, 355.9800),
(3, 3, 2, 3, 'Cloud Platform Annual - Hyper Pod Dedicated Infrastructure', 2, 2800.0000, 560.0000, 2, 428.4000, 1.0000, 5468.4000),
(4, 4, 1, 1, 'Cloud Platform Monthly - Starter Pod', 1, 199.0000, 39.8000, 1, 31.8400, 1.0000, 191.0400)
ON CONFLICT (id) DO NOTHING;

-- 8. PAYMENTS & ALLOCATIONS
INSERT INTO payments (id, payment_number, customer_id, amount, payment_method, transaction_reference, status, payment_date, recorded_by_id, notes) VALUES
(1, 'PAY-2026-0001', 3, 191.0400, 'credit_card', 'ch_stripe_seed_acme_001', 'SUCCESS', '2026-09-25 14:22:10+00', 1, 'Automated Stripe credit card charge.'),
(2, 'PAY-2026-0002', 7, 3000.0000, 'bank_transfer', 'wire_jpmorgan_stark_8841', 'SUCCESS', '2026-10-08 11:15:00+00', 2, 'First milestone wire transfer received. Remaining balance scheduled for Net 30.'),
(3, 'PAY-2026-0003', 5, 355.9800, 'credit_card', 'ch_stripe_declined_soylent_99', 'FAILED', '2026-10-06 09:00:00+00', 1, 'Card charge declined by issuer (Insufficient Funds / Do Not Honor).')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount, allocated_at) VALUES
(1, 1, 1, 191.0400, '2026-09-25 14:22:15+00'),
(2, 2, 3, 3000.0000, '2026-10-08 11:15:30+00')
ON CONFLICT (id) DO NOTHING;

-- 9. BILLING EVENTS (Immutable Audit Ledger)
INSERT INTO billing_events (id, event_type, entity_type, entity_id, actor_id, payload, created_at) VALUES
(1, 'QUOTATION_CONVERTED', 'quotation', 1, 2, '{"quote_number": "QT-2026-0001", "subscription_id": 1, "converted_amount": 375.84}', '2026-01-15 10:00:00+00'),
(2, 'SUBSCRIPTION_ACTIVATED', 'subscription', 1, 1, '{"subscription_number": "SUB-2026-0001", "plan": "PLAN_CLOUD_MONTHLY", "cadence": "monthly"}', '2026-01-15 10:05:00+00'),
(3, 'INVOICE_GENERATED', 'invoice', 1, NULL, '{"invoice_number": "INV-2026-0001", "total": 191.04, "idempotency_key": "sub_1_2026-09-21_2026-10-20"}', '2026-09-21 00:00:01+00'),
(4, 'PAYMENT_RECORDED', 'payment', 1, 1, '{"payment_number": "PAY-2026-0001", "amount": 191.04, "method": "credit_card", "invoice_id": 1}', '2026-09-25 14:22:10+00'),
(5, 'INVOICE_PAID', 'invoice', 1, 1, '{"invoice_number": "INV-2026-0001", "status": "PAID", "balance_due": 0.00}', '2026-09-25 14:22:15+00'),
(6, 'PAYMENT_FAILED', 'payment', 3, 1, '{"payment_number": "PAY-2026-0003", "amount": 355.98, "reason": "Insufficient Funds"}', '2026-10-06 09:00:00+00'),
(7, 'STATUS_CHANGED', 'subscription', 3, NULL, '{"subscription_number": "SUB-2026-0003", "from": "ACTIVE", "to": "IN_GRACE_PERIOD", "reason": "Dunning threshold breached"}', '2026-10-22 00:01:00+00'),
(8, 'STATUS_CHANGED', 'subscription', 4, 2, '{"subscription_number": "SUB-2026-0004", "from": "ACTIVE", "to": "PAUSED", "reason": "Customer ticket #4912"}', '2026-09-25 15:30:00+00')
ON CONFLICT (id) DO NOTHING;

-- 10. REVENUE ALERTS (Revenue Intelligence Centre Heuristics)
INSERT INTO revenue_alerts (id, alert_type, severity, title, message, entity_type, entity_id, revenue_at_risk, is_resolved, created_at) VALUES
(1, 'MISSED_RENEWAL', 'HIGH', 'Missed Renewal Run for Globex Industries', 'Subscription SUB-2026-0002 reached next_billing_date (2026-10-28) 3 days ago, but no recurring invoice was emitted by the automated engine.', 'subscription', 2, 1990.0000, FALSE, '2026-10-29 02:00:00+00'),
(2, 'OVERDUE_INVOICE', 'CRITICAL', 'Grace Period Expiration Imminent: Soylent Tech', 'Invoice INV-2026-0002 ($355.98) is 25 days overdue. Grace period expires in 5 days (2026-11-05). Outright service suspension pending.', 'invoice', 2, 355.9800, FALSE, '2026-10-22 00:05:00+00'),
(3, 'EXPIRING_DISCOUNT', 'MEDIUM', 'Promotional Discount Expiry in 7 Days: Soylent Tech', 'Promotional discount coupon EXPIRINGPROMO (15% off) linked to SUB-2026-0003 expires on 2026-11-07. Account manager outreach recommended to mitigate renewal price shock.', 'subscription', 3, 52.3500, FALSE, '2026-10-31 08:00:00+00'),
(4, 'FAILED_BILLING', 'HIGH', 'Payment Gateway Rejection: Soylent Tech', 'Card processing transaction ch_stripe_declined_soylent_99 failed due to Insufficient Funds on invoice INV-2026-0002.', 'payment', 3, 355.9800, FALSE, '2026-10-06 09:05:00+00')
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- End of Seed Script
-- ====================================================================
