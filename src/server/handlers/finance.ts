import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  expenses,
  invoiceItems,
  invoices,
  medicines,
  patients,
  payments,
  receipts,
  users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/types";
import {
  ApiError,
  audit,
  can,
  getSetting,
  invoiceTotals,
  json,
  nextNumber,
  opt,
  pageParams,
  parseCsv,
  readJson,
  requireDate,
  requirePerm,
  requireText,
  revise,
  str,
  toCsv,
  todayISO,
  wholeAmount,
} from "../core";
import { assertLabel, findPatient, readCount, readRows } from "../shared";

function feesFrom(body: Record<string, unknown>) {
  const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : null;
  if (items && items.length) {
    const totals = { consultationFee: 0, medicineCost: 0, laboratoryCharges: 0, otherCharges: 0 };
    const normalized = items.map((item) => {
      const quantity = wholeAmount(item.quantity ?? 1, "Quantity", false);
      const unitPrice = wholeAmount(item.unitPrice ?? 0, "Unit price");
      const amount = quantity * unitPrice;
      const category = str(item.category, 40) || "Other";
      if (category === "Consultation") totals.consultationFee += amount;
      else if (category === "Medicine") totals.medicineCost += amount;
      else if (category === "Laboratory") totals.laboratoryCharges += amount;
      else totals.otherCharges += amount;
      return { description: requireText(item.description, "Item description", 180), category, quantity, unitPrice, amount };
    });
    return { ...totals, items: normalized };
  }
  return {
    consultationFee: wholeAmount(body.consultationFee ?? 0, "Consultation fee"),
    medicineCost: wholeAmount(body.medicineCost ?? 0, "Medicine cost"),
    laboratoryCharges: wholeAmount(body.laboratoryCharges ?? 0, "Laboratory charges"),
    otherCharges: wholeAmount(body.otherCharges ?? 0, "Other charges"),
    items: null as null | { description: string; category: string; quantity: number; unitPrice: number; amount: number }[],
  };
}

export async function invoiceList(req: Request, user: SessionUser) {
  await requirePerm(user, "billing.view");
  const url = new URL(req.url);
  const { page, pageSize, offset } = pageParams(url);
  const q = str(url.searchParams.get("q"), 80);
  const status = str(url.searchParams.get("status"), 40);
  const where = and(
    status ? eq(invoices.status, status) : undefined,
    q ? or(ilike(invoices.invoiceNumber, `%${q}%`), ilike(invoices.snapshotPatientName, `%${q}%`), ilike(invoices.snapshotPatientNumber, `%${q}%`)) : undefined,
  );
  const rows = await db.select().from(invoices).where(where).orderBy(desc(invoices.invoiceDate), desc(invoices.id)).limit(pageSize).offset(offset);
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(invoices).where(where);
  return json({ items: rows, total: Number(total[0]?.count ?? 0), page, pageSize });
}

export async function invoiceCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "billing.create");
  const body = await readJson(req);
  if (body.confirmIdentity !== true) throw new ApiError(400, "Confirm the patient identity before creating an invoice.");
  const patient = await findPatient(String(body.patientId || ""));
  if (!patient) throw new ApiError(400, "Select a patient.");
  const fees = feesFrom(body);
  const discount = wholeAmount(body.discount ?? 0, "Discount");
  const totals = invoiceTotals({ ...fees, discount });
  const today = todayISO(await getSetting("timezone", "Africa/Kampala"));
  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(invoices).values({
      invoiceNumber: await nextNumber(tx, "invoice", "INV"),
      patientId: patient.id,
      doctorId: body.doctorId ? Number(body.doctorId) : null,
      invoiceDate: body.invoiceDate ? requireDate(body.invoiceDate, "Invoice date") : today,
      consultationFee: fees.consultationFee,
      medicineCost: fees.medicineCost,
      laboratoryCharges: fees.laboratoryCharges,
      otherCharges: fees.otherCharges,
      discount,
      totalAmount: totals.totalAmount,
      amountPaid: 0,
      balance: totals.balance,
      status: totals.status,
      notes: opt(body.notes, 500),
      snapshotPatientName: patient.fullName,
      snapshotPatientNumber: patient.patientNumber,
      createdBy: user.id,
    }).returning();
    const lines = fees.items ?? [
      fees.consultationFee ? { description: "Consultation", category: "Consultation", quantity: 1, unitPrice: fees.consultationFee, amount: fees.consultationFee } : null,
      fees.medicineCost ? { description: "Medicines", category: "Medicine", quantity: 1, unitPrice: fees.medicineCost, amount: fees.medicineCost } : null,
      fees.laboratoryCharges ? { description: "Laboratory", category: "Laboratory", quantity: 1, unitPrice: fees.laboratoryCharges, amount: fees.laboratoryCharges } : null,
      fees.otherCharges ? { description: "Other charges", category: "Other", quantity: 1, unitPrice: fees.otherCharges, amount: fees.otherCharges } : null,
    ].filter(Boolean) as { description: string; category: string; quantity: number; unitPrice: number; amount: number }[];
    for (const line of lines) await tx.insert(invoiceItems).values({ invoiceId: rows[0].id, ...line });
    await audit(tx, req, user, { action: "invoice_created", module: "billing", recordId: rows[0].id, description: `Created ${rows[0].invoiceNumber} for ${patient.patientNumber}`, newValue: { total: totals.totalAmount } });
    return rows[0];
  });
  return json({ invoice: created, message: "Invoice created successfully." });
}

export async function invoiceUpdate(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "billing.edit");
  const body = await readJson(req);
  const existing = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Invoice not found.");
  if (existing[0].status === "Voided") throw new ApiError(400, "Voided invoices cannot be edited.");
  if (existing[0].amountPaid > 0) throw new ApiError(400, "Invoices with payments cannot be edited. Reverse the payment first.");
  if (Number(body.version) !== existing[0].version) throw new ApiError(409, "This invoice was changed by someone else. Reload and try again.");
  const fees = feesFrom(body);
  const discount = wholeAmount(body.discount ?? existing[0].discount, "Discount");
  const totals = invoiceTotals({ ...fees, discount, amountPaid: 0 });
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(invoices).set({
      consultationFee: fees.consultationFee,
      medicineCost: fees.medicineCost,
      laboratoryCharges: fees.laboratoryCharges,
      otherCharges: fees.otherCharges,
      discount,
      totalAmount: totals.totalAmount,
      balance: totals.balance,
      status: totals.status,
      notes: body.notes !== undefined ? opt(body.notes, 500) : existing[0].notes,
      doctorId: body.doctorId ? Number(body.doctorId) : existing[0].doctorId,
      updatedAt: new Date(),
      version: existing[0].version + 1,
    }).where(and(eq(invoices.id, id), eq(invoices.version, existing[0].version))).returning();
    if (!rows.length) throw new ApiError(409, "This invoice was changed by someone else. Reload and try again.");
    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    const lines = fees.items ?? [
      fees.consultationFee ? { description: "Consultation", category: "Consultation", quantity: 1, unitPrice: fees.consultationFee, amount: fees.consultationFee } : null,
      fees.medicineCost ? { description: "Medicines", category: "Medicine", quantity: 1, unitPrice: fees.medicineCost, amount: fees.medicineCost } : null,
      fees.laboratoryCharges ? { description: "Laboratory", category: "Laboratory", quantity: 1, unitPrice: fees.laboratoryCharges, amount: fees.laboratoryCharges } : null,
      fees.otherCharges ? { description: "Other charges", category: "Other", quantity: 1, unitPrice: fees.otherCharges, amount: fees.otherCharges } : null,
    ].filter((line): line is { description: string; category: string; quantity: number; unitPrice: number; amount: number } => Boolean(line));
    for (const line of lines) await tx.insert(invoiceItems).values({ invoiceId: id, ...line });
    await revise(tx, "billing", id, user.id, { total: existing[0].totalAmount, discount: existing[0].discount }, { total: totals.totalAmount, discount });
    await audit(tx, req, user, { action: "invoice_updated", module: "billing", recordId: id, description: `Updated ${existing[0].invoiceNumber}`, previousValue: { total: existing[0].totalAmount }, newValue: { total: totals.totalAmount } });
    return rows[0];
  });
  return json({ invoice: updated, message: "Invoice updated successfully." });
}

export async function invoiceVoid(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "billing.void");
  const body = await readJson(req);
  const reason = requireText(body.reason, "Reason", 300);
  const existing = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Invoice not found.");
  const paid = await db.select().from(payments).where(and(eq(payments.invoiceId, id), eq(payments.status, "Completed"))).limit(1);
  if (paid.length) throw new ApiError(400, "Reverse completed payments before voiding this invoice.");
  await db.update(invoices).set({ status: "Voided", voidReason: reason, balance: 0, updatedAt: new Date(), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, id));
  await audit(db, req, user, { action: "invoice_voided", module: "billing", recordId: id, description: `Voided ${existing[0].invoiceNumber}: ${reason}` });
  return json({ ok: true, message: "Invoice voided. The original record was kept." });
}

async function paidTotal(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], invoiceId: number) {
  const rows = await tx.select({ total: sql<number>`coalesce(sum(${payments.amount}),0)::int` }).from(payments).where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, "Completed")));
  return Number(rows[0]?.total ?? 0);
}

export async function paymentCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "payments.create");
  const body = await readJson(req);
  const invoiceId = Number(body.invoiceId);
  const amount = wholeAmount(body.amount, "Amount", false);
  const method = requireText(body.method, "Payment method", 40);
  await assertLabel("payment_method", method, "Payment method");
  const allowNegative = (await getSetting("allow_negative_balance", "false")) === "true";
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${invoiceId} for update`);
    const invoice = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice[0]) throw new ApiError(404, "Invoice not found.");
    if (invoice[0].status === "Voided") throw new ApiError(400, "Cannot pay a voided invoice.");
    if (!allowNegative && amount > invoice[0].balance) throw new ApiError(400, "Payment cannot be greater than the balance.");
    if (allowNegative && amount > invoice[0].balance) {
      // Configured clinics may record an overpayment; the surplus remains a negative balance.
    }
    const payment = await tx.insert(payments).values({
      paymentNumber: await nextNumber(tx, "payment", "PAY"),
      invoiceId,
      patientId: invoice[0].patientId,
      amount,
      method,
      status: "Completed",
      receivedBy: user.id,
      notes: opt(body.notes, 300),
    }).returning();
    const amountPaid = await paidTotal(tx, invoiceId);
    const balance = invoice[0].totalAmount - amountPaid;
    if (balance < 0 && !allowNegative) throw new ApiError(400, "Payment cannot be greater than the balance.");
    const totals = balance < 0
      ? { totalAmount: invoice[0].totalAmount, amountPaid, balance, status: "Paid" }
      : invoiceTotals({ ...invoice[0], amountPaid });
    await tx.update(invoices).set({
      amountPaid: totals.amountPaid,
      balance: totals.balance,
      status: totals.status,
      updatedAt: new Date(),
      version: sql`${invoices.version} + 1`,
    }).where(eq(invoices.id, invoiceId));
    const receipt = await tx.insert(receipts).values({
      receiptNumber: await nextNumber(tx, "receipt", "RCT"),
      paymentId: payment[0].id,
      invoiceId,
      patientId: invoice[0].patientId,
      amount,
      method,
      receivedBy: user.id,
      receivedByName: user.name,
      notes: opt(body.notes, 300),
      snapshotPatientName: invoice[0].snapshotPatientName,
      snapshotPatientNumber: invoice[0].snapshotPatientNumber,
      snapshotInvoiceNumber: invoice[0].invoiceNumber,
      balanceAfter: totals.balance,
    }).returning();
    await audit(tx, req, user, { action: "payment_created", module: "billing", recordId: payment[0].id, description: `Payment ${payment[0].paymentNumber} of ${amount} for ${invoice[0].invoiceNumber}` });
    await audit(tx, req, user, { action: "receipt_created", module: "receipts", recordId: receipt[0].id, description: `Receipt ${receipt[0].receiptNumber} issued` });
    return { payment: payment[0], receipt: receipt[0], invoice: { ...invoice[0], ...totals } };
  });
  return json({ ...result, message: "Payment recorded successfully. Receipt generated." });
}

export async function paymentReverse(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "payments.reverse");
  const body = await readJson(req);
  const reason = requireText(body.reason, "Reason", 300);
  const result = await db.transaction(async (tx) => {
    const payment = await tx.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!payment[0]) throw new ApiError(404, "Payment not found.");
    if (payment[0].status !== "Completed") throw new ApiError(400, "Only completed payments can be reversed.");
    await tx.execute(sql`select id from invoices where id = ${payment[0].invoiceId} for update`);
    await tx.update(payments).set({ status: "Reversed", reversalReason: reason, reversedAt: new Date() }).where(eq(payments.id, id));
    await tx.update(receipts).set({ status: "Voided", voidReason: reason }).where(eq(receipts.paymentId, id));
    const invoice = await tx.select().from(invoices).where(eq(invoices.id, payment[0].invoiceId)).limit(1);
    const amountPaid = await paidTotal(tx, payment[0].invoiceId);
    const totals = invoiceTotals({ ...invoice[0], amountPaid });
    await tx.update(invoices).set({ amountPaid: totals.amountPaid, balance: totals.balance, status: invoice[0].status === "Voided" ? "Voided" : totals.status, updatedAt: new Date() }).where(eq(invoices.id, payment[0].invoiceId));
    await revise(tx, "payments", id, user.id, { status: "Completed", amount: payment[0].amount }, { status: "Reversed", reason });
    await audit(tx, req, user, { action: "payment_reversed", module: "billing", recordId: id, description: `Reversed ${payment[0].paymentNumber}: ${reason}` });
    return totals;
  });
  return json({ ...result, message: "Payment reversed. The original receipt was retained and marked voided." });
}

export async function receiptList(req: Request, user: SessionUser) {
  await requirePerm(user, "receipts.view");
  const url = new URL(req.url);
  const { page, pageSize, offset } = pageParams(url);
  const q = str(url.searchParams.get("q"), 80);
  const where = q ? or(ilike(receipts.receiptNumber, `%${q}%`), ilike(receipts.snapshotPatientName, `%${q}%`), ilike(receipts.snapshotInvoiceNumber, `%${q}%`)) : undefined;
  const rows = await db.select().from(receipts).where(where).orderBy(desc(receipts.receiptDate)).limit(pageSize).offset(offset);
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(receipts).where(where);
  return json({ items: rows, total: Number(total[0]?.count ?? 0), page, pageSize });
}

export async function receiptGet(user: SessionUser, id: number) {
  await requirePerm(user, "receipts.view");
  const rows = await db.select().from(receipts).where(eq(receipts.id, id)).limit(1);
  if (!rows[0]) throw new ApiError(404, "Receipt not found.");
  const invoice = await db.select().from(invoices).where(eq(invoices.id, rows[0].invoiceId)).limit(1);
  const clinic = {
    name: await getSetting("clinic_name", "SAPA Clinic"),
    address: await getSetting("clinic_address", ""),
    phone: await getSetting("clinic_phone", ""),
    email: await getSetting("clinic_email", ""),
    currency: await getSetting("currency", "UGX"),
    footer: await getSetting("receipt_footer", ""),
  };
  return json({ receipt: rows[0], invoice: invoice[0] ?? null, clinic });
}

export async function expenseList(req: Request, user: SessionUser) {
  await requirePerm(user, "expenses.view");
  const url = new URL(req.url);
  const { page, pageSize, offset } = pageParams(url);
  const q = str(url.searchParams.get("q"), 80);
  const category = str(url.searchParams.get("category"), 60);
  const where = and(category ? eq(expenses.category, category) : undefined, q ? or(ilike(expenses.description, `%${q}%`), ilike(expenses.expenseNumber, `%${q}%`), ilike(expenses.payee, `%${q}%`)) : undefined);
  const rows = await db.select().from(expenses).where(where).orderBy(desc(expenses.expenseDate)).limit(pageSize).offset(offset);
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(expenses).where(where);
  const today = todayISO(await getSetting("timezone", "Africa/Kampala"));
  const sums = await db.execute(sql`
    select
      coalesce(sum(case when expense_date = ${today}::date and status = 'Recorded' then amount else 0 end),0)::int as today,
      coalesce(sum(case when expense_date >= ${today}::date - 6 and status = 'Recorded' then amount else 0 end),0)::int as week,
      coalesce(sum(case when date_trunc('month', expense_date) = date_trunc('month', ${today}::date) and status = 'Recorded' then amount else 0 end),0)::int as month,
      coalesce(sum(case when date_trunc('year', expense_date) = date_trunc('year', ${today}::date) and status = 'Recorded' then amount else 0 end),0)::int as year
    from expenses
  `);
  const byCategory = await db.execute(sql`select category, coalesce(sum(amount),0)::int as amount from expenses where status = 'Recorded' group by category order by amount desc`);
  const byMethod = await db.execute(sql`select coalesce(payment_method, 'Unspecified') as method, coalesce(sum(amount),0)::int as amount from expenses where status = 'Recorded' group by payment_method`);
  return json({ items: rows, total: Number(total[0]?.count ?? 0), page, pageSize, summary: readRows(sums)[0], byCategory: readRows(byCategory), byMethod: readRows(byMethod) });
}

export async function expenseCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "expenses.create");
  const body = await readJson(req);
  const category = requireText(body.category, "Category", 80);
  await assertLabel("expense_category", category, "Category");
  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(expenses).values({
      expenseNumber: await nextNumber(tx, "expense", "EXP"),
      expenseDate: requireDate(body.expenseDate, "Date"),
      category,
      description: requireText(body.description, "Description", 240),
      amount: wholeAmount(body.amount, "Amount", false),
      paymentMethod: opt(body.paymentMethod, 40),
      payee: opt(body.payee, 160),
      reference: opt(body.reference, 80),
      enteredBy: user.id,
      notes: opt(body.notes, 500),
      status: "Recorded",
    }).returning();
    await audit(tx, req, user, { action: "expense_created", module: "expenses", recordId: rows[0].id, description: `Recorded ${rows[0].expenseNumber}` });
    return rows[0];
  });
  return json({ expense: created, message: "Expense recorded successfully." });
}

export async function expenseVoid(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "expenses.void");
  const reason = requireText((await readJson(req)).reason, "Reason", 300);
  const existing = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Expense not found.");
  await db.update(expenses).set({ status: "Voided", voidReason: reason }).where(eq(expenses.id, id));
  await audit(db, req, user, { action: "expense_voided", module: "expenses", recordId: id, description: `Voided ${existing[0].expenseNumber}: ${reason}` });
  return json({ ok: true, message: "Expense voided. It remains in the audit trail." });
}

export async function financeSummary(req: Request, user: SessionUser) {
  await requirePerm(user, "reports.financial");
  const url = new URL(req.url);
  const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  const doctorId = Number(url.searchParams.get("doctorId") || 0);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = endDate.toISOString().slice(0, 10);
  const where = and(gte(invoices.invoiceDate, start), lte(invoices.invoiceDate, end), doctorId ? eq(invoices.doctorId, doctorId) : undefined, sql`${invoices.status} <> 'Voided'`);
  const rows = await db.select().from(invoices).where(where);
  let consultation = 0;
  let medicine = 0;
  let laboratory = 0;
  let other = 0;
  let discount = 0;
  let outstanding = 0;
  let paid = 0;
  let partial = 0;
  let unpaid = 0;
  for (const row of rows) {
    const gross = row.consultationFee + row.medicineCost + row.laboratoryCharges + row.otherCharges;
    const factor = gross === 0 ? 0 : (gross - row.discount) / gross;
    consultation += Math.round(row.consultationFee * factor);
    medicine += Math.round(row.medicineCost * factor);
    laboratory += Math.round(row.laboratoryCharges * factor);
    other += Math.round(row.otherCharges * factor);
    discount += row.discount;
    outstanding += row.balance;
    if (row.status === "Paid") paid += 1;
    else if (row.status === "Partially Paid") partial += 1;
    else if (row.status === "Unpaid") unpaid += 1;
  }
  const billed = consultation + medicine + laboratory + other;
  const expenseRows = await db.select().from(expenses).where(and(gte(expenses.expenseDate, start), lte(expenses.expenseDate, end), eq(expenses.status, "Recorded")));
  const expenseTotal = expenseRows.reduce((sum, row) => sum + row.amount, 0);
  const cash = await db.execute(sql`
    select coalesce(sum(amount),0)::int as total from payments
    where status = 'Completed' and (created_at at time zone 'Africa/Kampala')::date between ${start}::date and ${end}::date
  `);
  const collected = Number(readRows<{ total: number }>(cash)[0]?.total ?? 0);
  return json({
    month, year, start, end,
    consultation, medicine, laboratory, other, discount,
    totalRevenue: billed,
    cashCollected: collected,
    expenses: expenseTotal,
    netBilled: billed - expenseTotal,
    netCash: collected - expenseTotal,
    outstanding,
    paid, partial, unpaid,
    invoiceCount: rows.length,
    note: "Billed revenue is calculated from non-void invoices in the selected month, with discount allocated across charge categories. Cash collected is the sum of completed payments. Outstanding receivables are remaining invoice balances.",
  });
}

export async function dashboard(user: SessionUser) {
  await requirePerm(user, "dashboard.view");
  const financial = can(user, "dashboard.financial");
  const today = todayISO(await getSetting("timezone", "Africa/Kampala"));
  const monthStart = `${today.slice(0, 8)}01`;
  const totalPatients = readCount(await db.execute(sql`select count(*)::int as count from patients where status <> 'Archived'`));
  const newPatients = readCount(await db.execute(sql`select count(*)::int as count from patients where registration_date >= ${monthStart}::date and status <> 'Archived'`));
  const appointmentsToday = readCount(await db.execute(sql`select count(*)::int as count from appointments where appointment_date = ${today}::date`));
  const pendingAppointments = readCount(await db.execute(sql`select count(*)::int as count from appointments where appointment_date = ${today}::date and status in ('Scheduled', 'Confirmed')`));
  const completedVisits = readCount(await db.execute(sql`select count(*)::int as count from appointments where appointment_date = ${today}::date and status = 'Completed'`));
  const visitsThisMonth = readCount(await db.execute(sql`select count(*)::int as count from doctor_encounters where (recorded_at at time zone 'Africa/Kampala')::date >= ${monthStart}::date`));
  const warning = Number(await getSetting("expiry_warning_days", "30")) || 30;
  const stock = await db.execute(sql`
    select
      count(*) filter (where available = 0)::int as out_of_stock,
      count(*) filter (where available > 0 and available <= reorder_level)::int as low_stock
    from (
      select m.id, m.reorder_level,
        coalesce(sum(case when b.expiry_date >= ${today}::date then b.quantity_remaining else 0 end),0)::int as available
      from medicines m left join medicine_batches b on b.medicine_id = m.id
      where m.status = 'Active' group by m.id
    ) s
  `);
  const stockRow = readRows<{ out_of_stock: number; low_stock: number }>(stock)[0] || { out_of_stock: 0, low_stock: 0 };
  const expiring = readCount(await db.execute(sql`select count(distinct medicine_id)::int as count from medicine_batches where quantity_remaining > 0 and expiry_date >= ${today}::date and expiry_date <= ${today}::date + ${warning}::int`));
  const expired = readCount(await db.execute(sql`select count(distinct medicine_id)::int as count from medicine_batches where quantity_remaining > 0 and expiry_date < ${today}::date`));
  let unpaidInvoices = 0;
  let outstanding = 0;
  let revenueMonth = 0;
  let expensesMonth = 0;
  if (financial) {
    const fin = readRows<{ count: number; balance: number }>(await db.execute(sql`select count(*)::int as count, coalesce(sum(balance),0)::int as balance from invoices where status in ('Unpaid','Partially Paid')`))[0];
    unpaidInvoices = Number(fin?.count ?? 0);
    outstanding = Number(fin?.balance ?? 0);
    revenueMonth = Number(readRows<{ total: number }>(await db.execute(sql`select coalesce(sum(amount),0)::int as total from payments where status = 'Completed' and (created_at at time zone 'Africa/Kampala')::date >= ${monthStart}::date`))[0]?.total ?? 0);
    expensesMonth = Number(readRows<{ total: number }>(await db.execute(sql`select coalesce(sum(amount),0)::int as total from expenses where status = 'Recorded' and expense_date >= ${monthStart}::date`))[0]?.total ?? 0);
  }
  const revenueDaily = financial ? readRows(await db.execute(sql`
    select to_char(d::date, 'DD Mon') as label, coalesce(sum(p.amount),0)::int as value
    from generate_series(${today}::date - 13, ${today}::date, interval '1 day') d
    left join payments p on (p.created_at at time zone 'Africa/Kampala')::date = d::date and p.status = 'Completed'
    group by d order by d
  `)) : [];
  const revenueMonthly = financial ? readRows(await db.execute(sql`
    select to_char(d, 'Mon YY') as label, coalesce(sum(p.amount),0)::int as value
    from generate_series(date_trunc('month', ${today}::date) - interval '5 months', date_trunc('month', ${today}::date), interval '1 month') d
    left join payments p on date_trunc('month', (p.created_at at time zone 'Africa/Kampala')) = d and p.status = 'Completed'
    group by d order by d
  `)) : [];
  const appointmentsByStatus = readRows(await db.execute(sql`select status as label, count(*)::int as value from appointments where appointment_date >= ${monthStart}::date group by status order by value desc`));
  const appointmentsByDoctor = readRows(await db.execute(sql`
    select u.name as label, count(*)::int as value
    from appointments a join users u on u.id = a.doctor_id
    where a.appointment_date >= ${monthStart}::date
    group by u.name order by value desc limit 8
  `));
  const registrations = readRows(await db.execute(sql`
    select to_char(d, 'Mon') as label, count(p.id)::int as value
    from generate_series(date_trunc('month', ${today}::date) - interval '5 months', date_trunc('month', ${today}::date), interval '1 month') d
    left join patients p on date_trunc('month', p.registration_date) = d
    group by d order by d
  `));
  const demographics = readRows(await db.execute(sql`select coalesce(gender, 'Unspecified') as label, count(*)::int as value from patients where status <> 'Archived' group by gender order by value desc`));
  const financialTrend = financial ? readRows(await db.execute(sql`
    select to_char(d, 'Mon') as label,
      coalesce((select sum(amount) from payments p where p.status = 'Completed' and date_trunc('month', (p.created_at at time zone 'Africa/Kampala')) = d),0)::int as income,
      coalesce((select sum(amount) from expenses e where e.status = 'Recorded' and date_trunc('month', e.expense_date) = d),0)::int as expenses
    from generate_series(date_trunc('month', ${today}::date) - interval '5 months', date_trunc('month', ${today}::date), interval '1 month') d
    order by d
  `)) : [];
  const doctorActivity = can(user, "clinical.view") ? readRows(await db.execute(sql`
    select u.name as label, count(e.id)::int as value
    from users u left join doctor_encounters e on e.doctor_id = u.id and (e.recorded_at at time zone 'Africa/Kampala')::date >= ${monthStart}::date
    join roles r on r.id = u.role_id and r.code = 'doctor'
    group by u.name order by value desc
  `)) : [];
  const todayAppointments = await db.select({
    id: appointments.id,
    time: appointments.appointmentTime,
    status: appointments.status,
    reason: appointments.reason,
    patient: patients.fullName,
    number: patients.patientNumber,
    doctor: users.name,
  }).from(appointments).innerJoin(patients, eq(appointments.patientId, patients.id)).innerJoin(users, eq(appointments.doctorId, users.id)).where(eq(appointments.appointmentDate, today)).orderBy(appointments.appointmentTime).limit(8);
  const demo = readCount(await db.execute(sql`select count(*)::int as count from patients where is_demo = true and status <> 'Archived'`));
  return json({
    financial,
    demo: demo > 0,
    kpis: {
      totalPatients, newPatients, appointmentsToday, pendingAppointments, completedVisits, visitsThisMonth,
      unpaidInvoices, outstanding, revenueMonth, expensesMonth, net: revenueMonth - expensesMonth,
      lowStock: Number(stockRow.low_stock || 0), outOfStock: Number(stockRow.out_of_stock || 0), expiring, expired,
    },
    charts: { revenueDaily, revenueMonthly, appointmentsByStatus, appointmentsByDoctor, registrations, demographics, financialTrend, doctorActivity },
    todayAppointments,
  });
}

export async function report(req: Request, user: SessionUser, type: string) {
  const url = new URL(req.url);
  const from = str(url.searchParams.get("from"), 10);
  const to = str(url.searchParams.get("to"), 10);
  const exportCsv = url.searchParams.get("export") === "1";
  if (exportCsv) await requirePerm(user, "reports.export");
  let records: Record<string, unknown>[] = [];
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
  if (type === "patients") {
    await requirePerm(user, "reports.view");
    records = readRows(await db.execute(sql`select patient_number, full_name, gender, registration_date, status, case_type from patients where (${fromDate}::date is null or registration_date >= ${fromDate}::date) and (${toDate}::date is null or registration_date <= ${toDate}::date) order by registration_date desc limit 2000`));
  } else if (type === "appointments") {
    await requirePerm(user, "reports.view");
    records = readRows(await db.execute(sql`
      select a.appointment_number, p.patient_number, p.full_name, u.name as doctor, a.appointment_date, a.appointment_time, a.status
      from appointments a join patients p on p.id = a.patient_id join users u on u.id = a.doctor_id
      where (${fromDate}::date is null or a.appointment_date >= ${fromDate}::date) and (${toDate}::date is null or a.appointment_date <= ${toDate}::date)
      order by a.appointment_date desc limit 2000
    `));
  } else if (type === "clinical") {
    await requirePerm(user, "reports.clinical");
    records = readRows(await db.execute(sql`
      select e.encounter_number, p.patient_number, u.name as doctor, e.recorded_at, e.status
      from doctor_encounters e join patients p on p.id = e.patient_id left join users u on u.id = e.doctor_id
      order by e.recorded_at desc limit 2000
    `));
  } else if (type === "pharmacy") {
    await requirePerm(user, "inventory.view");
    records = readRows(await db.execute(sql`
      select m.medicine_code, m.name, m.category, m.reorder_level,
        coalesce(sum(b.quantity_remaining),0)::int as quantity
      from medicines m left join medicine_batches b on b.medicine_id = m.id
      group by m.id order by m.name
    `));
  } else if (type === "financial") {
    await requirePerm(user, "reports.financial");
    records = readRows(await db.execute(sql`
      select invoice_number, snapshot_patient_number as patient_number, snapshot_patient_name as patient_name, invoice_date, total_amount, amount_paid, balance, status
      from invoices
      where (${fromDate}::date is null or invoice_date >= ${fromDate}::date) and (${toDate}::date is null or invoice_date <= ${toDate}::date)
      order by invoice_date desc limit 2000
    `));
  } else throw new ApiError(404, "Report not found.");
  await audit(db, req, user, { action: exportCsv ? "report_exported" : "report_viewed", module: "reports", description: `${type} report` });
  if (exportCsv) {
    return new Response(toCsv(records), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=sapa-${type}-report.csv` } });
  }
  return json({ items: records });
}

export async function importPreview(req: Request, user: SessionUser) {
  await requirePerm(user, "import.manage");
  const body = await readJson(req);
  const type = requireText(body.type, "Import type", 40);
  const parsed = parseCsv(str(body.csv, 500_000));
  const rows = parsed.map((row) => ({ row: Number(row.__row), data: row, errors: validateImport(type, row) }));
  return json({ rows, valid: rows.filter((row) => !row.errors.length).length, invalid: rows.filter((row) => row.errors.length).length });
}

function validateImport(type: string, row: Record<string, string>) {
  const errors: { field: string; problem: string; suggestion: string }[] = [];
  const need = (field: string, label: string) => {
    if (!row[field]) errors.push({ field, problem: `${label} is missing.`, suggestion: `Add ${label} and import again.` });
  };
  if (type === "patients") need("full_name", "Full name");
  else if (type === "medicines") {
    need("name", "Name");
    if (row.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.expiry_date)) errors.push({ field: "expiry_date", problem: "Expiry date is not YYYY-MM-DD.", suggestion: "Use 2026-12-31." });
  } else if (type === "expenses") {
    need("description", "Description");
    need("amount", "Amount");
    need("date", "Date");
    if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push({ field: "date", problem: "Date is not YYYY-MM-DD.", suggestion: "Use 2026-09-01." });
    if (row.amount && !/^\d+$/.test(row.amount)) errors.push({ field: "amount", problem: "Amount must be a whole number.", suggestion: "Remove commas and decimals." });
  } else if (type === "doctors") {
    need("name", "Name");
    need("username", "Username");
  } else errors.push({ field: "type", problem: "Unsupported import type.", suggestion: "Use patients, medicines, expenses, or doctors." });
  return errors;
}

export async function importCommit(req: Request, user: SessionUser) {
  await requirePerm(user, "import.manage");
  const body = await readJson(req);
  const type = requireText(body.type, "Import type", 40);
  const parsed = parseCsv(str(body.csv, 500_000));
  let imported = 0;
  const failed: { row: number; errors: { field: string; problem: string; suggestion: string }[] }[] = [];
  for (const row of parsed) {
    const errors = validateImport(type, row);
    if (errors.length) {
      failed.push({ row: Number(row.__row), errors });
      continue;
    }
    try {
      if (type === "patients") {
        const phone = (row.phone || "").replace(/\D/g, "");
        await db.insert(patients).values({
          patientNumber: await nextNumber(db, "patient", "PAT"),
          registrationDate: row.registration_date || todayISO(await getSetting("timezone", "Africa/Kampala")),
          fullName: row.full_name,
          dateOfBirth: row.date_of_birth || null,
          gender: row.gender || null,
          phone: row.phone || null,
          phoneDigits: phone || null,
          address: row.address || null,
          caseType: row.case_type || null,
          nokName: row.nok_name || null,
          nokRelationship: row.nok_relationship || null,
          nokPhone: row.nok_phone || null,
          status: "Active",
          createdBy: user.id,
          services: [],
        });
      } else if (type === "medicines") {
        const medicine = await db.insert(medicines).values({
          medicineCode: await nextNumber(db, "medicine", "MED"),
          name: row.name,
          category: row.category || null,
          reorderLevel: Number(row.reorder_level || 0),
          unitPrice: Number(row.unit_price || 0),
          supplierName: row.supplier || null,
          status: "Active",
        }).returning();
        if (row.batch_number && row.expiry_date && Number(row.quantity || 0) > 0) {
          const { medicineBatches, inventoryTransactions } = await import("@/db/schema");
          const batch = await db.insert(medicineBatches).values({
            medicineId: medicine[0].id,
            batchNumber: row.batch_number,
            expiryDate: row.expiry_date,
            quantityReceived: Number(row.quantity),
            quantityRemaining: Number(row.quantity),
            unitCost: Number(row.unit_cost || 0),
            sellingPrice: Number(row.unit_price || 0),
            supplierName: row.supplier || null,
          }).returning();
          await db.insert(inventoryTransactions).values({ medicineId: medicine[0].id, batchId: batch[0].id, type: "Received", quantity: Number(row.quantity), performedBy: user.id, notes: "Imported stock" });
        }
      } else if (type === "expenses") {
        await db.insert(expenses).values({
          expenseNumber: await nextNumber(db, "expense", "EXP"),
          expenseDate: row.date,
          category: row.category || "Other",
          description: row.description,
          amount: Number(row.amount),
          paymentMethod: row.payment_method || null,
          payee: row.payee || null,
          reference: row.reference || null,
          enteredBy: user.id,
          status: "Recorded",
        });
      } else if (type === "doctors") {
        const { roles } = await import("@/db/schema");
        const role = await db.select().from(roles).where(eq(roles.code, "doctor")).limit(1);
        const { hashPassword } = await import("../core");
        await db.insert(users).values({
          staffCode: await nextNumber(db, "staff", "DOC"),
          name: row.name,
          username: row.username.toLowerCase(),
          email: row.email || null,
          phone: row.phone || null,
          specialty: row.specialty || null,
          passwordHash: await hashPassword(row.password || "ChangeMe#2026"),
          roleId: role[0].id,
          department: "Consultation",
          status: "active",
        });
      }
      imported += 1;
    } catch {
      failed.push({ row: Number(row.__row), errors: [{ field: "row", problem: "This row could not be saved. It may duplicate an existing record.", suggestion: "Check the identifier and try this row again." }] });
    }
  }
  await audit(db, req, user, { action: "import_committed", module: "import", description: `Imported ${imported} ${type} rows; ${failed.length} failed` });
  return json({ imported, failed, message: `Imported ${imported} valid row${imported === 1 ? "" : "s"}. ${failed.length} row${failed.length === 1 ? "" : "s"} need correction.` });
}

export async function clearDemo(req: Request, user: SessionUser) {
  await requirePerm(user, "settings.manage");
  const body = await readJson(req);
  if (str(body.confirm, 20) !== "CLEAR DEMO") throw new ApiError(400, "Type CLEAR DEMO to confirm.");
  await db.transaction(async (tx) => {
    await tx.execute(sql`update patients set status = 'Archived', archived_at = now() where is_demo = true and status <> 'Archived'`);
    await tx.execute(sql`update invoices set status = 'Voided', void_reason = 'Demonstration data cleared', balance = 0 where is_demo = true and status <> 'Voided'`);
    await tx.execute(sql`update expenses set status = 'Voided', void_reason = 'Demonstration data cleared' where is_demo = true and status <> 'Voided'`);
    await tx.execute(sql`update medicines set status = 'Inactive' where is_demo = true`);
    await audit(tx, req, user, { action: "demo_cleared", module: "settings", description: "Demonstration clinical and financial records archived or voided" });
  });
  return json({ ok: true, message: "Demonstration records were archived or voided. Real records were not changed." });
}
