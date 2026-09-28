# SAPA Clinic Management System

Production-style clinic platform for patient registration, appointments, queue, nursing, consultations, psychology, pharmacy, billing, receipts, expenses, reporting, and audit.

This is not an Excel workbook. Records are relational, permissions are enforced on the server, and financial and stock changes are transactional.

## Stack

- Next.js App Router
- PostgreSQL via Drizzle ORM
- Cookie sessions signed with `SESSION_SECRET` (falls back to `DATABASE_URL` only for local development)
- Passwords hashed with scrypt

## Environment

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
SESSION_SECRET=replace-with-a-long-random-string
# Set only when the site is served over HTTPS
COOKIE_SECURE=false
```

Never put secrets in client code. The only browser-visible configuration is non-secret clinic branding returned by the API.

## First run

The application creates its tables and demonstration records on first sign-in if they are not already present. You can also push the Drizzle schema:

```bash
npx drizzle-kit push
```

## Demonstration access

Demonstration accounts and patients are labeled. They are not real clinic records. An administrator can archive demonstration clinical and financial data from Settings by typing `CLEAR DEMO`.

| Role | Username | Password |
| --- | --- | --- |
| Administrator | admin | SapaAdmin#2026 |
| Reception | reception | Reception#2026 |
| Nurse | nurse.amina | Nurse#2026 |
| Doctor | dr.okello | Doctor#2026 |
| Psychologist | psych.nakato | Psych#2026 |
| Pharmacist | pharmacy | Pharmacy#2026 |
| Accountant | accounts | Accounts#2026 |
| Manager | manager | Manager#2026 |
| IT | it.admin | ItAdmin#2026 |

## Authorization

Hiding a menu is not security. Every API route checks a permission such as `billing.edit` or `psychology.view`. Inactive users cannot sign in. Password changes and role changes increment the session version.

## Financial and stock integrity

- Invoice total = consultation + medicine + laboratory + other − discount
- Balance = total − sum of completed payments
- A payment, invoice update, and receipt are written in one database transaction
- Reversals keep the original payment and mark the receipt voided
- Stock quantity changes only through a stock transaction
- Dispensing uses first-expiry-first-out and refuses expired batches

## Backups

Infrastructure backups are outside this application. Settings documents that boundary. Reports can export operational CSV for authorized users.

## Clinical safety

The system calculates, reminds, and organizes. It does not diagnose or choose treatment.


## Deployment note
For Vercel/Neon deployment, set `DATABASE_URL`, `SESSION_SECRET`, and `COOKIE_SECURE=true` as environment variables. The application initializes its schema and seed data through the server bootstrap on first API request.
