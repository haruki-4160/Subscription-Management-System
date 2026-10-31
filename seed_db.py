#!/usr/bin/env python3
"""
seed_db.py - Standalone dynamic database seeder for SMS Portal / RECUR.
Generates an SQLite database (sms_portal.db) with calculated dates relative to
the current execution date, providing fresh test data for all lifecycle scenarios.
"""

import os
import sys
import sqlite3
from datetime import date, datetime, timedelta

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sms_portal.db")

def init_db(conn):
    cursor = conn.cursor()
    
    # 1. USERS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        company_name TEXT,
        role TEXT NOT NULL DEFAULT 'customer',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 2. PRODUCTS & VARIANTS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        attributes TEXT DEFAULT '{}',
        price_delta REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1
    );
    """)

    # 3. PLANS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        billing_interval TEXT NOT NULL,
        interval_count INTEGER NOT NULL DEFAULT 1,
        base_price REAL NOT NULL,
        setup_fee REAL NOT NULL DEFAULT 0.0,
        trial_days INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
    );
    """)

    # 4. TAXES & DISCOUNTS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tax_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        rate_pct REAL NOT NULL,
        country TEXT NOT NULL,
        state TEXT,
        is_inclusive INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS discounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        discount_type TEXT NOT NULL,
        value REAL NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        max_uses INTEGER,
        current_uses INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
    );
    """)

    # 5. QUOTATIONS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quotation_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        lines_data TEXT NOT NULL,
        default_terms TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES users(id),
        created_by_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'DRAFT',
        subtotal REAL NOT NULL DEFAULT 0.0,
        discount_amount REAL NOT NULL DEFAULT 0.0,
        tax_amount REAL NOT NULL DEFAULT 0.0,
        total_amount REAL NOT NULL DEFAULT 0.0,
        valid_until TEXT NOT NULL,
        terms TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quotation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id),
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        variant_id INTEGER REFERENCES product_variants(id),
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL,
        discount_pct REAL NOT NULL DEFAULT 0.0,
        line_total REAL NOT NULL
    );
    """)

    # 6. SUBSCRIPTIONS & HISTORY
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES users(id),
        quotation_id INTEGER REFERENCES quotations(id),
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        variant_id INTEGER REFERENCES product_variants(id),
        status TEXT NOT NULL DEFAULT 'DRAFT',
        current_period_start TEXT NOT NULL,
        current_period_end TEXT NOT NULL,
        next_billing_date TEXT NOT NULL,
        trial_end_date TEXT,
        pause_start_date TEXT,
        grace_period_end_date TEXT,
        discount_id INTEGER REFERENCES discounts(id),
        discount_expiry_date TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 1,
        cancellation_reason TEXT,
        canceled_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS subscription_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        triggered_by_id INTEGER REFERENCES users(id),
        reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 7. INVOICES & ITEMS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE NOT NULL,
        subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
        customer_id INTEGER NOT NULL REFERENCES users(id),
        billing_period_start TEXT NOT NULL,
        billing_period_end TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'POSTED',
        subtotal REAL NOT NULL,
        discount_amount REAL NOT NULL DEFAULT 0.0,
        tax_amount REAL NOT NULL DEFAULT 0.0,
        total_amount REAL NOT NULL,
        paid_amount REAL NOT NULL DEFAULT 0.0,
        balance_due REAL NOT NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        plan_id INTEGER REFERENCES plans(id),
        variant_id INTEGER REFERENCES product_variants(id),
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL,
        discount_amount REAL NOT NULL DEFAULT 0.0,
        tax_rate_id INTEGER REFERENCES tax_rates(id),
        tax_amount REAL NOT NULL DEFAULT 0.0,
        proration_ratio REAL NOT NULL DEFAULT 1.0,
        line_total REAL NOT NULL
    );
    """)

    # 8. PAYMENTS & ALLOCATIONS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        transaction_reference TEXT,
        status TEXT NOT NULL DEFAULT 'SUCCESS',
        payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
        recorded_by_id INTEGER NOT NULL REFERENCES users(id),
        notes TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payment_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id),
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        allocated_amount REAL NOT NULL,
        allocated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 9. BILLING EVENTS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS billing_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        actor_id INTEGER REFERENCES users(id),
        payload TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 10. REVENUE ALERTS
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS revenue_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        revenue_at_risk REAL NOT NULL DEFAULT 0.0,
        is_resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT,
        resolved_by_id INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.commit()

def seed_data(conn):
    cursor = conn.cursor()
    today = date.today()

    print(f"[*] Seeding data relative to baseline date: {today}...")

    # Users
    users = [
        (1, 'admin@recur.io', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Sarah Connor (Admin)', 'RECUR Global', 'admin', 1),
        (2, 'staff@recur.io', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Michael Scott (Staff)', 'RECUR Global', 'staff', 1),
        (3, 'billing@acmecorp.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Alex Vance', 'Acme Corp', 'customer', 1),
        (4, 'finance@globex.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Bob Vance', 'Globex Industries', 'customer', 1),
        (5, 'accounts@soylent.io', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Carol Danvers', 'Soylent Tech', 'customer', 1),
        (6, 'ops@hooli.xyz', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Gavin Belson', 'Hooli Corp', 'customer', 1),
        (7, 'finance@starkindustries.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Pepper Potts', 'Stark Industries', 'customer', 1),
        (8, 'billing@wayneenterprises.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Lucius Fox', 'Wayne Enterprises', 'customer', 1)
    ]
    cursor.executemany("INSERT OR REPLACE INTO users (id, email, hashed_password, full_name, company_name, role, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", users)

    # Products & Variants
    products = [
        (1, 'PROD_CLOUD_PLATFORM', 'Enterprise Cloud Platform', 'High availability Kubernetes compute clusters', 1),
        (2, 'PROD_API_GATEWAY', 'API Acceleration Gateway', 'Globally distributed edge gateway', 1),
        (3, 'PROD_SECURITY_SUITE', 'Zero-Trust Security & Compliance', 'Continuous automated compliance scanner', 1),
        (4, 'PROD_DEDICATED_SUPPORT', '24/7 Dedicated Support SLA', 'Guaranteed 15-minute response SLA', 1)
    ]
    cursor.executemany("INSERT OR REPLACE INTO products (id, code, name, description, is_active) VALUES (?, ?, ?, ?, ?)", products)

    variants = [
        (1, 1, 'VAR_POD_STARTER', 'Starter Pod (4 vCPU / 16GB RAM)', '{"vcpu": 4, "ram_gb": 16}', 0.0, 1),
        (2, 1, 'VAR_POD_SCALE', 'Scale Pod (16 vCPU / 64GB RAM)', '{"vcpu": 16, "ram_gb": 64}', 150.0, 1),
        (3, 1, 'VAR_POD_HYPER', 'Hyper Pod (64 vCPU / 256GB RAM)', '{"vcpu": 64, "ram_gb": 256}', 600.0, 1),
        (4, 2, 'VAR_API_STANDARD', 'Standard Throughput (25k req/min)', '{"rpm": 25000}', 0.0, 1),
        (5, 2, 'VAR_API_HIGH', 'High Throughput (100k req/min)', '{"rpm": 100000}', 200.0, 1),
        (6, 3, 'VAR_SEC_SOC2', 'SOC2 Type II Monitor', '{"compliance": "SOC2"}', 100.0, 1)
    ]
    cursor.executemany("INSERT OR REPLACE INTO product_variants (id, product_id, sku, name, attributes, price_delta, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", variants)

    # Plans
    plans = [
        (1, 1, 'PLAN_CLOUD_MONTHLY', 'Cloud Platform Monthly', 'monthly', 1, 199.0, 50.0, 14, 1),
        (2, 1, 'PLAN_CLOUD_ANNUAL', 'Cloud Platform Annual', 'annual', 1, 1990.0, 0.0, 30, 1),
        (3, 2, 'PLAN_API_MONTHLY', 'API Gateway Pro Monthly', 'monthly', 1, 149.0, 0.0, 0, 1),
        (4, 3, 'PLAN_SEC_ANNUAL', 'Zero-Trust Security Annual', 'annual', 1, 1200.0, 100.0, 14, 1),
        (5, 1, 'PLAN_SANDBOX_WEEKLY', 'Developer Sandbox Pilot', 'weekly', 1, 49.0, 0.0, 7, 1)
    ]
    cursor.executemany("INSERT OR REPLACE INTO plans (id, product_id, code, name, billing_interval, interval_count, base_price, setup_fee, trial_days, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", plans)

    # Taxes & Discounts
    taxes = [
        (1, 'VAT_UK_20', 'United Kingdom Standard VAT (20%)', 20.0, 'United Kingdom', None, 0, 1),
        (2, 'US_CA_85', 'California State Tax (8.5%)', 8.5, 'United States', 'California', 0, 1),
        (3, 'TAX_EXEMPT', 'Tax Exempt / B2B', 0.0, 'Global', None, 0, 1)
    ]
    cursor.executemany("INSERT OR REPLACE INTO tax_rates (id, code, name, rate_pct, country, state, is_inclusive, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", taxes)

    discounts = [
        (1, 'EARLYBIRD20', 'Early Bird 20% Discount', 'percentage', 20.0, str(today - timedelta(days=90)), str(today + timedelta(days=275)), 100, 24, 1),
        (2, 'EXPIRINGPROMO', 'Q4 Retention Incentive (15%)', 'percentage', 15.0, str(today - timedelta(days=23)), str(today + timedelta(days=7)), 50, 48, 1),
        (3, 'STARTUP50', '$50 Onboarding Credit', 'fixed_amount', 50.0, str(today - timedelta(days=60)), str(today + timedelta(days=300)), 500, 89, 1)
    ]
    cursor.executemany("INSERT OR REPLACE INTO discounts (id, code, name, discount_type, value, start_date, end_date, max_uses, current_uses, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", discounts)

    # Quotations
    quotes = [
        (1, 'QT-2026-0001', 3, 2, 'CONVERTED', 348.0, 34.8, 62.64, 375.84, str(today + timedelta(days=30)), 'Converted into SUB-2026-0001'),
        (2, 'QT-2026-0002', 7, 2, 'ACCEPTED', 5600.0, 560.0, 428.4, 5468.4, str(today + timedelta(days=15)), 'Enterprise SLA pack approved'),
        (3, 'QT-2026-0003', 8, 2, 'SENT', 1490.0, 149.0, 113.99, 1454.99, str(today + timedelta(days=10)), 'Pending security sign-off')
    ]
    cursor.executemany("INSERT OR REPLACE INTO quotations (id, quote_number, customer_id, created_by_id, status, subtotal, discount_amount, tax_amount, total_amount, valid_until, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", quotes)

    # Subscriptions
    # 1. Healthy active
    sub1_start = today - timedelta(days=10)
    sub1_end = today + timedelta(days=20)
    # 2. Missed renewal (next_billing_date 3 days ago)
    sub2_start = today - timedelta(days=368)
    sub2_end = today - timedelta(days=3)
    # 3. Grace period overdue
    sub3_start = today - timedelta(days=40)
    sub3_end = today - timedelta(days=10)
    sub3_grace = today + timedelta(days=5)
    # 4. Paused
    sub4_start = today - timedelta(days=60)
    sub4_end = today - timedelta(days=30)
    sub4_next = today + timedelta(days=15)
    # 5. High-value Enterprise
    sub5_start = today - timedelta(days=30)
    sub5_end = today + timedelta(days=335)

    subscriptions = [
        (1, 'SUB-2026-0001', 3, 1, 1, 1, 'ACTIVE', str(sub1_start), str(sub1_end), str(sub1_end), None, None, None, 1, str(today + timedelta(days=60)), 1, None, None),
        (2, 'SUB-2026-0002', 4, None, 2, 2, 'ACTIVE', str(sub2_start), str(sub2_end), str(sub2_end), None, None, None, None, None, 1, None, None),
        (3, 'SUB-2026-0003', 5, None, 1, 2, 'IN_GRACE_PERIOD', str(sub3_start), str(sub3_end), str(sub3_end), None, None, str(sub3_grace), 2, str(today + timedelta(days=7)), 1, None, None),
        (4, 'SUB-2026-0004', 6, None, 3, 4, 'PAUSED', str(sub4_start), str(sub4_end), str(sub4_next), None, str(today - timedelta(days=15)), None, None, None, 1, None, None),
        (5, 'SUB-2026-0005', 7, 2, 2, 3, 'ACTIVE', str(sub5_start), str(sub5_end), str(sub5_end), None, None, None, 1, str(today + timedelta(days=180)), 1, None, None),
        (6, 'SUB-2026-0006', 8, None, 1, 1, 'CANCELED', str(today - timedelta(days=120)), str(today - timedelta(days=90)), str(today - timedelta(days=90)), None, None, None, None, None, 0, 'Internal cloud migration', str(today - timedelta(days=90)))
    ]
    cursor.executemany("INSERT OR REPLACE INTO subscriptions (id, subscription_number, customer_id, quotation_id, plan_id, variant_id, status, current_period_start, current_period_end, next_billing_date, trial_end_date, pause_start_date, grace_period_end_date, discount_id, discount_expiry_date, auto_renew, cancellation_reason, canceled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", subscriptions)

    # Invoices
    invoices = [
        (1, 'INV-2026-0001', 1, 3, str(today - timedelta(days=40)), str(today - timedelta(days=10)), str(today - timedelta(days=25)), 'PAID', 199.0, 39.8, 31.84, 191.04, 191.04, 0.0, 'sub_1_cycle_prior'),
        (2, 'INV-2026-0002', 3, 5, str(sub3_start), str(sub3_end), str(today - timedelta(days=25)), 'OVERDUE', 349.0, 52.35, 59.33, 355.98, 0.0, 355.98, 'sub_3_cycle_overdue'),
        (3, 'INV-2026-0003', 5, 7, str(sub5_start), str(sub5_end), str(today - timedelta(days=15)), 'PARTIALLY_PAID', 5600.0, 560.0, 428.4, 5468.4, 3000.0, 2468.4, 'sub_5_annual_cycle'),
        (4, 'INV-2026-0004', 1, 3, str(sub1_start), str(sub1_end), str(today + timedelta(days=15)), 'POSTED', 199.0, 39.8, 31.84, 191.04, 0.0, 191.04, 'sub_1_cycle_current')
    ]
    cursor.executemany("INSERT OR REPLACE INTO invoices (id, invoice_number, subscription_id, customer_id, billing_period_start, billing_period_end, due_date, status, subtotal, discount_amount, tax_amount, total_amount, paid_amount, balance_due, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", invoices)

    # Payments & Allocations
    payments = [
        (1, 'PAY-2026-0001', 3, 191.04, 'credit_card', 'ch_stripe_seed_acme_001', 'SUCCESS', str(today - timedelta(days=24)), 1, 'Automated Stripe card settlement'),
        (2, 'PAY-2026-0002', 7, 3000.0, 'bank_transfer', 'wire_jpmorgan_stark_8841', 'SUCCESS', str(today - timedelta(days=10)), 2, 'Wire transfer partial milestone 1'),
        (3, 'PAY-2026-0003', 5, 355.98, 'credit_card', 'ch_stripe_declined_soylent_99', 'FAILED', str(today - timedelta(days=25)), 1, 'Card charge declined (Insufficient Funds)')
    ]
    cursor.executemany("INSERT OR REPLACE INTO payments (id, payment_number, customer_id, amount, payment_method, transaction_reference, status, payment_date, recorded_by_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", payments)

    allocations = [
        (1, 1, 1, 191.04),
        (2, 2, 3, 3000.0)
    ]
    cursor.executemany("INSERT OR REPLACE INTO payment_allocations (id, payment_id, invoice_id, allocated_amount) VALUES (?, ?, ?, ?)", allocations)

    # Revenue Alerts (Revenue Intelligence Centre)
    alerts = [
        (1, 'MISSED_RENEWAL', 'HIGH', 'Missed Renewal Run for Globex Industries', f'Subscription SUB-2026-0002 reached next_billing_date ({sub2_end}) without recurring invoice generated.', 'subscription', 2, 1990.0, 0),
        (2, 'OVERDUE_INVOICE', 'CRITICAL', 'Grace Period Expiration Imminent: Soylent Tech', f'Invoice INV-2026-0002 ($355.98) is 25 days overdue. Grace cutoff date is {sub3_grace}. Service suspension pending.', 'invoice', 2, 355.98, 0),
        (3, 'EXPIRING_DISCOUNT', 'MEDIUM', 'Promotional Discount Expiry in 7 Days: Soylent Tech', f'Coupon EXPIRINGPROMO (15% off) linked to SUB-2026-0003 expires on {today + timedelta(days=7)}. Account manager outreach recommended.', 'subscription', 3, 52.35, 0),
        (4, 'FAILED_BILLING', 'HIGH', 'Payment Gateway Rejection: Soylent Tech', 'Payment PAY-2026-0003 failed with card issuer rejection code Insufficient Funds.', 'payment', 3, 355.98, 0)
    ]
    cursor.executemany("INSERT OR REPLACE INTO revenue_alerts (id, alert_type, severity, title, message, entity_type, entity_id, revenue_at_risk, is_resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", alerts)

    conn.commit()
    print("[+] Test database generated successfully!")
    print(f"[+] Output SQLite database: {DB_FILE}")

def main():
    conn = sqlite3.connect(DB_FILE)
    init_db(conn)
    seed_data(conn)
    conn.close()

if __name__ == "__main__":
    main()
