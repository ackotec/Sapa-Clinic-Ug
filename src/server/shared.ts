import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  patients,
  referenceItems,
  roles,
  users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/types";
import { ageFromDob, ApiError, can, getSetting, maskPhone, todayISO } from "./core";

export async function activeLabels(listKey: string) {
  const rows = await db
    .select()
    .from(referenceItems)
    .where(and(eq(referenceItems.listKey, listKey), eq(referenceItems.active, true)))
    .orderBy(referenceItems.sortOrder, referenceItems.label);
  return rows;
}

export async function assertLabel(listKey: string, value: string, label: string) {
  const rows = await activeLabels(listKey);
  if (rows.length && !rows.some((row) => row.label === value)) {
    throw new ApiError(400, `${label} is not one of the configured values. Update it in Settings if this should be allowed.`);
  }
  return value;
}

export async function findPatient(idOrNumber: string) {
  if (/^\d+$/.test(idOrNumber)) {
    const byId = await db.select().from(patients).where(eq(patients.id, Number(idOrNumber))).limit(1);
    if (byId[0]) return byId[0];
  }
  const byNumber = await db.select().from(patients).where(eq(patients.patientNumber, idOrNumber.toUpperCase())).limit(1);
  return byNumber[0] ?? null;
}

export function presentPatient(row: typeof patients.$inferSelect, user: SessionUser) {
  const contact = can(user, "patients.view_contact");
  const sensitive = can(user, "patients.view_sensitive");
  return {
    id: row.id,
    patientNumber: row.patientNumber,
    registrationDate: row.registrationDate,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth,
    age: ageFromDob(row.dateOfBirth),
    gender: row.gender,
    phone: contact ? row.phone : maskPhone(row.phone),
    otherPhone: contact ? row.otherPhone : maskPhone(row.otherPhone),
    address: contact ? row.address : row.address ? "Restricted" : null,
    emergencyContact: contact ? row.emergencyContact : row.emergencyContact ? "Restricted" : null,
    nokName: row.nokName,
    nokRelationship: row.nokRelationship,
    nokPhone: contact ? row.nokPhone : maskPhone(row.nokPhone),
    nokOtherPhone: contact ? row.nokOtherPhone : maskPhone(row.nokOtherPhone),
    caseType: row.caseType,
    services: row.services ?? [],
    bloodGroup: sensitive ? row.bloodGroup : row.bloodGroup ? "Restricted" : null,
    allergies: sensitive ? row.allergies : row.allergies ? "Restricted" : null,
    medicalHistory: sensitive ? row.medicalHistory : row.medicalHistory ? "Restricted" : null,
    status: row.status,
    nextAppointment: row.nextAppointment,
    notes: row.notes,
    isDemo: row.isDemo,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function clinicianOptions() {
  return db
    .select({
      id: users.id,
      name: users.name,
      staffCode: users.staffCode,
      specialty: users.specialty,
      department: users.department,
      status: users.status,
      role: roles.code,
      phone: users.phone,
      email: users.email,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id));
}

export async function notify(input: {
  userId?: number | null;
  roleCode?: string | null;
  title: string;
  body: string;
  type: string;
  link?: string | null;
  dedupeKey?: string | null;
}) {
  await db.insert(notifications).values({
    userId: input.userId ?? null,
    roleCode: input.roleCode ?? null,
    title: input.title,
    body: input.body,
    type: input.type,
    link: input.link ?? null,
    dedupeKey: input.dedupeKey ?? null,
  }).onConflictDoNothing();
}

export async function syncAlerts(user: SessionUser) {
  const timezone = await getSetting("timezone", "Africa/Kampala");
  const today = todayISO(timezone);
  const warning = Number(await getSetting("expiry_warning_days", "30")) || 30;
  if (can(user, "appointments.view")) {
    const count = await db.execute(sql`select count(*)::int as count from appointments where appointment_date = ${today} and status in ('Scheduled', 'Confirmed')`);
    const n = Number(readCount(count));
    if (n > 0) {
      await notify({
        userId: user.id,
        title: "Appointments today",
        body: `${n} appointment${n === 1 ? "" : "s"} still scheduled or confirmed today.`,
        type: "appointment",
        link: "/appointments",
        dedupeKey: `appt-${today}-${user.id}`,
      });
    }
  }
  if (can(user, "inventory.view")) {
    const low = await db.execute(sql`
      select m.id, m.name, coalesce(sum(case when b.expiry_date >= ${today}::date then b.quantity_remaining else 0 end), 0)::int as available, m.reorder_level
      from medicines m
      left join medicine_batches b on b.medicine_id = m.id
      where m.status = 'Active'
      group by m.id
      having coalesce(sum(case when b.expiry_date >= ${today}::date then b.quantity_remaining else 0 end), 0) <= m.reorder_level
    `);
    for (const row of readRows<{ id: number; name: string; available: number }>(low)) {
      const kind = Number(row.available) === 0 ? "out of stock" : "low stock";
      await notify({
        roleCode: user.role,
        title: Number(row.available) === 0 ? "Medicine out of stock" : "Medicine low stock",
        body: `${row.name} is ${kind}.`,
        type: "stock",
        link: "/inventory",
        dedupeKey: `stock-${row.id}-${kind}-${user.role}-${today}`,
      });
    }
    const expiring = await db.execute(sql`
      select b.id, m.name, b.batch_number, b.expiry_date
      from medicine_batches b
      join medicines m on m.id = b.medicine_id
      where b.quantity_remaining > 0
        and b.expiry_date < (${today}::date + ${warning}::int)
        and m.status = 'Active'
    `);
    for (const row of readRows<{ id: number; name: string; batch_number: string; expiry_date: string }>(expiring)) {
      const expired = String(row.expiry_date) < today;
      await notify({
        roleCode: user.role,
        title: expired ? "Medicine expired" : "Medicine expiring soon",
        body: `${row.name} batch ${row.batch_number} ${expired ? "expired" : "expires"} on ${row.expiry_date}.`,
        type: "stock",
        link: "/inventory",
        dedupeKey: `exp-${row.id}-${user.role}`,
      });
    }
  }
  if (can(user, "billing.view")) {
    const unpaid = await db.execute(sql`select count(*)::int as count, coalesce(sum(balance),0)::int as balance from invoices where status in ('Unpaid', 'Partially Paid')`);
    const row = readRows<{ count: number; balance: number }>(unpaid)[0];
    if (row && Number(row.count) > 0) {
      await notify({
        userId: user.id,
        title: "Unpaid invoices",
        body: `${row.count} invoice${Number(row.count) === 1 ? "" : "s"} have an outstanding balance.`,
        type: "invoice",
        link: "/billing",
        dedupeKey: `unpaid-${today}-${user.id}-${row.count}`,
      });
    }
  }
  if (can(user, "clinical.view") || can(user, "psychology.view") || can(user, "appointments.view")) {
    const due = await db.execute(sql`
      select f.id, p.patient_number, p.full_name, f.due_date, f.reason
      from follow_ups f
      join patients p on p.id = f.patient_id
      where f.status = 'Open' and f.due_date <= ${today}
      limit 20
    `);
    for (const row of readRows<{ id: number; patient_number: string; full_name: string; due_date: string; reason: string | null }>(due)) {
      await notify({
        userId: user.id,
        title: "Follow-up due",
        body: `${row.patient_number} — ${row.full_name} follow-up ${row.reason ? `(${row.reason}) ` : ""}was due ${row.due_date}.`,
        type: "followup",
        link: "/patients",
        dedupeKey: `follow-${row.id}-${user.id}`,
      });
    }
  }
}

export function readRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export function readCount(result: unknown) {
  const row = readRows<{ count: number }>(result)[0];
  return Number(row?.count ?? 0);
}
