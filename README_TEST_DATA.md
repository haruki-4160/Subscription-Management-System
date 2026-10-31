# SMS Portal / RECUR — Enterprise Test Dataset Guide

This dataset covers all entities, lifecycles, and edge cases specified for the **RECUR / Subscription Management System (SMS Portal)**, including recurring lifecycle FSM states, exact decimal accounting, multi-channel payment reconciliation, and the **Revenue Intelligence Centre** risk heuristics.

---

## 📂 Included Test Data Deliverables

| File | Format | Purpose |
| :--- | :--- | :--- |
| [`seed_data.sql`](seed_data.sql) | SQL Script | DDL schema + DML seed data compatible with PostgreSQL & SQLite. |
| [`test_data.json`](test_data.json) | JSON Dataset | Clean structured JSON for API mocks, Postman, or frontend testing. |
| [`seed_db.py`](seed_db.py) | Python Seeder | Standalone dynamic seeder producing an SQLite database with relative dates. |
| [`sms_portal.db`](sms_portal.db) | SQLite DB | Ready-to-query SQLite database generated with all tables and rows populated. |
| [`csv/`](csv/) | CSV Directory | Tabular CSV exports (`users.csv`, `subscriptions.csv`, `invoices.csv`, `payments.csv`, `revenue_alerts.csv`). |

---

## 👥 Seeded User Accounts & Roles

All accounts share default development passwords for rapid testing:

| Role | Email | Password | Display Name / Organization | Access & Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Admin** | `admin@recur.io` | `AdminPass123!` | Sarah Connor (Admin) | Full governance, revenue intelligence, tax/discount management, audit logs. |
| **Staff** | `staff@recur.io` | `StaffPass123!` | Michael Scott (Staff) | Sales quotes, subscriptions, manual invoice triggers, payment recording. |
| **Customer** | `billing@acmecorp.com` | `CustomerPass123!` | Alex Vance (Acme Corp) | Self-service portal, view active subscription, invoices, payment history. |
| **Customer** | `finance@globex.com` | `CustomerPass123!` | Bob Vance (Globex Industries) | Customer with missed renewal test scenario. |
| **Customer** | `accounts@soylent.io` | `CustomerPass123!` | Carol Danvers (Soylent Tech) | Customer with grace period, overdue invoice, and expiring discount. |
| **Customer** | `ops@hooli.xyz` | `CustomerPass123!` | Gavin Belson (Hooli Corp) | Customer with paused subscription. |
| **Customer** | `finance@starkindustries.com` | `CustomerPass123!` | Pepper Potts (Stark Industries) | Enterprise multi-tier customer with partially paid invoice. |
| **Customer** | `billing@wayneenterprises.com` | `CustomerPass123!` | Lucius Fox (Wayne Enterprises) | Canceled subscription with audited churn reason. |

---

## 🧪 Comprehensive Test Scenarios Covered

### 1. Healthy Active Subscription (`SUB-2026-0001` — Acme Corp)
- **Status:** `ACTIVE`
- **Cadence:** Monthly Cloud Platform ($199/mo) + Early Bird 20% discount.
- **Invoices:** `INV-2026-0001` (Paid $191.04 via Stripe Card) and `INV-2026-0004` (Posted, due in 5 days).
- **Use Case:** Verify standard recurring billing and happy-path card settlement.

### 2. Missed Renewal Risk Alert (`SUB-2026-0002` — Globex Industries)
- **Status:** `ACTIVE`
- **Cadence:** Annual Cloud Platform ($1,990/yr).
- **Condition:** `next_billing_date` reached 3 days ago without recurring invoice generated.
- **Trigger:** Surfaces in **Revenue Intelligence Centre** as `MISSED_RENEWAL` (High Severity, $1,990 at risk).

### 3. Grace Period & Overdue Dunning (`SUB-2026-0003` — Soylent Tech)
- **Status:** `IN_GRACE_PERIOD`
- **Condition:** Invoice `INV-2026-0002` ($355.98) is 25 days overdue. Payment attempt `PAY-2026-0003` was declined for insufficient funds.
- **Expiring Promo:** Coupon `EXPIRINGPROMO` (15% off) expires in 7 days.
- **Trigger:** Double risk alert: `OVERDUE_INVOICE` (Critical Severity) + `EXPIRING_DISCOUNT` (Medium Severity).

### 4. Paused Subscription (`SUB-2026-0004` — Hooli Corp)
- **Status:** `PAUSED`
- **Condition:** Paused on client request during cloud migration. Next billing date pushed out without terminating contract.
- **Use Case:** Test the `resume()` FSM lifecycle transition and period recalculation.

### 5. Partial Payment Reconciliation (`INV-2026-0003` — Stark Industries)
- **Status:** `PARTIALLY_PAID`
- **Total Amount:** $5,468.40 (Annual Enterprise Tier).
- **Paid Amount:** $3,000.00 allocated from wire transfer `PAY-2026-0002`.
- **Balance Due:** $2,468.40 remaining.
- **Use Case:** Verify partial allocation math, status checks, and outstanding ledger balance.

### 6. Audited Cancellation (`SUB-2026-0006` — Wayne Enterprises)
- **Status:** `CANCELED`
- **Condition:** Clean termination with `cancellation_reason` and immutable timestamp in `subscription_history`.

---

## 🚀 How to Execute & Seed

### Option A: Direct SQLite Inspection
Run the Python seeder anytime to refresh dates relative to today:
```powershell
python seed_db.py
```
You can query the generated `sms_portal.db` directly using any SQLite viewer or CLI:
```powershell
sqlite3 sms_portal.db "SELECT subscription_number, customer_id, status FROM subscriptions;"
```

### Option B: PostgreSQL Seed
Pipe `seed_data.sql` into your Postgres instance:
```bash
psql -U postgres -d sms_portal -f seed_data.sql
```

### Option C: Frontend / API Mocking
Use `test_data.json` directly within Next.js API routes or Mock Service Worker (MSW).
