# SAPA Clinic administrator guide

## Add a user

1. Sign in as an administrator.
2. Open Users & Staff.
3. Enter name, username, temporary password, role, department, and specialty.
4. Ask the user to change the password from Profile after signing in.
5. Deactivate a user instead of deleting them. Inactive users cannot sign in.

## Permissions

Open a role and tick the permissions that role needs. Saving permissions signs those users out so the new access applies immediately. The administrator role must keep user and settings management.

Psychology, clinical notes, and documents are not visible to every role. Accountants see finance, not psychology. Nurses see triage and limited clinical history, not billing totals unless granted.

Emergency view override, if granted, lasts 15 minutes, requires a reason, and is written to the audit log.

## Doctors

Doctor records are user accounts with the Doctor role. Inactive doctors cannot be booked unless Settings explicitly allows it.

## Medicines

1. Add the medicine and reorder level.
2. Receive a batch with expiry, cost, and selling price.
3. Dispense from a prescription. The earliest valid expiry is used first.
4. Adjustments, damage, expiry write-off, returns, and transfers require a reason and appear in stock history.

## Settings

Clinic name, contacts, currency, timezone, consultation fee, expiry warning days, payment methods, statuses, services, and expense categories are configurable without a code change. Upload a PNG or JPG logo for the login screen, receipts, and patient card.

## Reports

Run a report, then export CSV or print. Export is refused when the user lacks `reports.export`, and clinical or financial reports also require their own permission.

## Import

Settings includes a CSV preview. Invalid rows show the row number, field, problem, and a suggested correction. Valid rows can be committed without discarding the error report.

## Audit

Audit logs record sign-in, clinical writes, billing, stock, user changes, and sensitive record views. There is no edit or delete control for ordinary administrators.

## Backups

Database backup and restore are operated by the hosting environment, not by a button in this application. Agree a backup frequency with the host. Use the report export only as an operational extract, not as the sole backup.

## Password reset

There is no email gateway. An administrator sets a new temporary password from Users & Staff. That action ends the user's existing sessions.
