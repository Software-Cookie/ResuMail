# ResuMail

Upload your resume, get a polished introduction written from it (rule-based, **no AI**), and email it, with your resume attached, to every recruiter on your list. Each person gets their own personal email, sent from your own Gmail.

## Plans

| Plan | Price | Emails | Min. gap | Templates | Manual entry |
|---|---|---|---|---|---|
| Free | ₹0 | 10 / month | 30 s | Recommended + your own | – |
| Trial | ₹29 once | 100 pack | 10 s | All | ✓ |
| Standard (recommended) | ₹99 once | 1,000 pack | 5 s | All | ✓ |
| Premium | ₹299 lifetime | Unlimited | 2 s | All | ✓ |

Quotas, gaps and templates are enforced on the server. Packs never expire. Coupons (any % off, stored only as hashes) are created in the admin panel.

## Features

- **Resume analysis (offline, no AI):** detects your name, contacts, skills (240+ keywords), experience, education and certifications, then scores you against 29 role profiles and writes your intro.
- **Accounts:** email + password (scrypt), 30-day sessions, 15-minute cooling period after 5 failed sign-ins, password reset by email code.
- **Payments:** UPI to your personal UPI ID (no fees, verified in `/admin.html`), or optional Razorpay for automatic activation.
- **Recipient lists:** Excel (.xlsx/.xls), CSV, TXT, or paste. Duplicates and invalid emails are removed.
- **Safe sending:** one email per recipient, plan-based gaps, auto-retry, pause/resume/stop, CSV report.
- **Security:** parameterised SQL everywhere, CSRF and SSRF protection, strict Content-Security-Policy, rate limits with automatic 15-minute IP blocks after 5 unusual requests.

## Run locally

Requires Node.js 20 or newer. No database setup needed: without `DATABASE_URL` the app uses an embedded Postgres in `.data/`.

```bash
npm install
npm start          # http://localhost:3000
npm test           # 15 API tests (auth, quotas, races, coupons, payments, security)
npm run loadtest   # 300 concurrent visitors against http://localhost:3000
```

Copy `.env.example` to `.env` to try payments and the admin panel locally.

## Deploy

Vercel + Neon Postgres (both free tiers). Set `DATABASE_URL`, `ADMIN_EMAILS`, `ADMIN_KEY`, `UPI_ID`, `UPI_NAME` and optionally `SMTP_USER`/`SMTP_PASS`, `SUPPORT_EMAIL`, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`. The build step (`node scripts/build.js`) writes the SEO tags, sitemap and cache-busted assets to `dist/`.

## Project layout

```
api/index.js         The only Vercel function; every /api/* route is rewritten to it
lib/router.js        Route table + abuse guard + error handling
lib/auth.js          Sign up / in / out, sessions, password change & reset
lib/sending.js       Verify sender, send email, atomic quota + gap enforcement
lib/billing.js       Coupons, UPI orders, Razorpay
lib/admin.js         Owner tools (approve payments, coupons, users)
lib/guard.js         Rate limits, strikes, IP blocks, DB-backed cooldowns
lib/db.js            Neon (production) / PGlite (local) + self-migrating schema
lib/plans.js         Plan catalogue and limits
lib/mail.js          SMTP providers, SSRF guard, pooled transports
public/              Static site (index, admin, legal pages, app.js, account.js)
scripts/             build, migrate, loadtest
test/                node:test suite
```
