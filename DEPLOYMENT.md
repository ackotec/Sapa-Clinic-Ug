# SAPA Clinic Management System — Deployment

## Architecture
- Next.js application on Vercel
- PostgreSQL on Neon
- Keep this project separate from BondRich ATS and BondRich HRMS.

## Vercel environment variables
Add these variables to the Vercel project:

- `DATABASE_URL` = Neon PostgreSQL connection string
- `SESSION_SECRET` = a long random secret used to sign sessions
- `COOKIE_SECURE` = `true`

Use the same variables for Production and Preview. Development is optional.

## Database initialization
The application calls `ensureSeeded()` before API requests. That routine creates the database schema and seeds the initial configuration/demo records when the database is empty.

For manual schema operations from a development shell, use:

```bash
npm run db:push
```

Do not paste production credentials into source files.

## Initial demonstration login
The source includes labeled demonstration accounts. Change the administrator password immediately after deployment before entering any real clinic data.

## Production data
The demonstration records are explicitly marked as demo data. Do not treat them as real patient records. Confirm backups, access controls, privacy obligations, and operational procedures before using the application with real clinical information.
