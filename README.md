# RECUR — Subscription Management System (SMS Portal)

A comprehensive recurring billing, subscription lifecycle management, and revenue intelligence platform built with Node.js, Express, SQLite, and vanilla modern frontend.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
npm install
```

### Database Setup & Seeding
```bash
npm run seed
```

### Running the Application
```bash
npm start
```
The server will start on port `3000` (or `PORT` specified in environment variables). Access the portal at `http://localhost:3000`.

### Running Tests
```bash
npm test
```

---

## 👥 Default Accounts

| Role | Email | Password |
| :--- | :--- | :--- |
| **Admin** | `ashishsunil4160@gmail.com` | `Admin@12345` |
| **Staff** | `staff.sarah@recursms.com` | `Staff@12345` |
| **Customer** | `corner.grocery@store.com` | `Customer@12345` |
| **Customer** | `acme.enterprises@global.com` | `Customer@12345` |

For additional mock data, see [`README_TEST_DATA.md`](README_TEST_DATA.md).

---

## 📦 Features
- **Subscription Lifecycle FSM:** Draft, Active, Paused, Canceled, Expired states with grace periods and dunning cycles.
- **Product & Variant Pricing:** Flexible billing cadences, custom variant pricing adjustments.
- **Invoice & Payment Processing:** Automated invoice generation, partial payments, Stripe/wire reconciliation.
- **Revenue Intelligence Centre:** Automated risk heuristics for missed renewals, high churn probabilities, and overdue dunning.
- **Role-Based Access Control:** Dedicated portals and API authorization for Admin, Staff, and Customer users.
