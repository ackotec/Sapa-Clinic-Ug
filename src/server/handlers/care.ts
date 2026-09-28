import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  auditLogs,
  diagnoses,
  documents,
  doctorEncounters,
  followUps,
  invoices,
  nurseEncounters,
  patients,
  payments,
  prescriptions,
  prescriptionItems,
  psychologySessions,
  queueEntries,
  receipts,
  recordRevisions,
  users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/types";
import {
  ApiError,
  ageFromDob,
  audit,
  can,
  dateOrNull,
  getSetting,
  json,
  maskPhone,
  nextNumber,
  normalizePhone,
  opt,
  pageParams,
  readJson,
  requireDate,
  requirePerm,
  requireText,
  revise,
  str,
  timeOrThrow,
  toCsv,
  todayISO,
} from "../core";
import { assertLabel, findPatient, presentPatient, readRows } from "../shared";
import { qrFor } from "./platform";

function servicesOf(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => str(item, 60)).filter(Boolean).slice(0, 12);
}

async function duplicateCandidates(input: { fullName?: string; dateOfBirth?: string | null; phoneDigits?: string | null; otherPhoneDigits?: string | null; excludeId?: number }) {
  const checks = [];
  if (input.fullName && input.dateOfBirth) {
    checks.push(and(sql`lower(${patients.fullName}) = ${input.fullName.toLowerCase()}`, eq(patients.dateOfBirth, input.dateOfBirth)));
  }
  if (input.phoneDigits) {
    checks.push(eq(patients.phoneDigits, input.phoneDigits));
    checks.push(eq(patients.otherPhoneDigits, input.phoneDigits));
  }
  if (input.otherPhoneDigits) {
    checks.push(eq(patients.phoneDigits, input.otherPhoneDigits));
    checks.push(eq(patients.otherPhoneDigits, input.otherPhoneDigits));
  }
  if (!checks.length) return [];
  const rows = await db.select().from(patients).where(and(sql`${patients.status} <> 'Archived'`, or(...checks))).limit(8);
  return rows.filter((row) => row.id !== input.excludeId).map((row) => ({
    id: row.id,
    patientNumber: row.patientNumber,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth,
    phone: maskPhone(row.phone),
    gender: row.gender,
    status: row.status,
  }));
}

function patientInput(body: Record<string, unknown>, partial = false) {
  const phone = normalizePhone(body.phone);
  const other = normalizePhone(body.otherPhone);
  const nok = normalizePhone(body.nokPhone);
  const nokOther = normalizePhone(body.nokOtherPhone);
  if (phone.digits && phone.digits.length < 7) throw new ApiError(400, "Enter a valid phone number.");
  if (other.digits && other.digits.length < 7) throw new ApiError(400, "Enter a valid other phone number.");
  const dob = dateOrNull(body.dateOfBirth, "Date of birth");
  if (dob && dob > new Date().toISOString().slice(0, 10)) throw new ApiError(400, "Date of birth cannot be in the future.");
  return {
    fullName: partial && body.fullName == null ? undefined : requireText(body.fullName, "Full name"),
    registrationDate: body.registrationDate ? requireDate(body.registrationDate, "Registration date") : undefined,
    dateOfBirth: dob,
    gender: opt(body.gender, 40),
    phone: phone.display,
    phoneDigits: phone.digits,
    otherPhone: other.display,
    otherPhoneDigits: other.digits,
    address: opt(body.address, 300),
    emergencyContact: opt(body.emergencyContact, 160),
    nokName: opt(body.nokName, 160),
    nokRelationship: opt(body.nokRelationship, 80),
    nokPhone: nok.display,
    nokPhoneDigits: nok.digits,
    nokOtherPhone: nokOther.display,
    caseType: opt(body.caseType, 40),
    services: servicesOf(body.services),
    bloodGroup: opt(body.bloodGroup, 20),
    allergies: opt(body.allergies, 1000),
    medicalHistory: opt(body.medicalHistory, 4000),
    status: opt(body.status, 40) || "Active",
    nextAppointment: dateOrNull(body.nextAppointment, "Next appointment"),
    notes: opt(body.notes, 2000),
  };
}

export async function patientsCollection(req: Request, user: SessionUser) {
  await requirePerm(user, "patients.view");
  const url = new URL(req.url);
  if (url.searchParams.get("export") === "1") return exportPatients(url, user);
  const { page, pageSize, offset } = pageParams(url);
  const q = str(url.searchParams.get("q"), 80);
  const status = str(url.searchParams.get("status"), 40);
  const digits = q.replace(/\D/g, "");
  const filters = [
    status ? eq(patients.status, status) : sql`${patients.status} <> 'Archived'`,
    q ? or(
      ilike(patients.fullName, `%${q}%`),
      ilike(patients.patientNumber, `%${q}%`),
      ilike(patients.phone, `%${q}%`),
      ilike(patients.otherPhone, `%${q}%`),
      ilike(patients.nokName, `%${q}%`),
      ilike(patients.nokPhone, `%${q}%`),
      digits ? ilike(patients.phoneDigits, `%${digits}%`) : undefined,
      digits ? ilike(patients.otherPhoneDigits, `%${digits}%`) : undefined,
      sql`exists (select 1 from invoices i where i.patient_id = ${patients.id} and i.invoice_number ilike ${"%" + q + "%"})`,
      sql`exists (select 1 from appointments a where a.patient_id = ${patients.id} and a.appointment_number ilike ${"%" + q + "%"})`,
    ) : undefined,
  ];
  const where = and(...filters);
  const sort = url.searchParams.get("sort") || "registered";
  const order = sort === "name" ? asc(patients.fullName) : sort === "number" ? asc(patients.patientNumber) : sort === "status" ? asc(patients.status) : desc(patients.createdAt);
  const rows = await db.select().from(patients).where(where).orderBy(order).limit(pageSize).offset(offset);
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(patients).where(where);
  return json({ items: rows.map((row) => presentPatient(row, user)), total: Number(total[0]?.count ?? 0), page, pageSize });
}

async function exportPatients(url: URL, user: SessionUser) {
  await requirePerm(user, "patients.export");
  const q = str(url.searchParams.get("q"), 80);
  const rows = await db.select().from(patients).where(q ? ilike(patients.fullName, `%${q}%`) : sql`${patients.status} <> 'Archived'`).orderBy(patients.patientNumber).limit(5000);
  const csv = toCsv(rows.map((row) => {
    const view = presentPatient(row, user);
    return {
      patient_number: view.patientNumber,
      full_name: view.fullName,
      date_of_birth: view.dateOfBirth,
      age: view.age,
      gender: view.gender,
      phone: view.phone,
      status: view.status,
      case_type: view.caseType,
    };
  }));
  await audit(db, null, user, { action: "patients_exported", module: "patients", description: `Exported ${rows.length} patient rows` });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=sapa-patients.csv" } });
}

export async function patientsCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "patients.create");
  const body = await readJson(req);
  const input = patientInput(body);
  if (input.gender) await assertLabel("gender", input.gender, "Gender");
  if (input.caseType) await assertLabel("case_type", input.caseType, "Case type");
  if (input.status) await assertLabel("patient_status", input.status, "Status");
  const duplicates = await duplicateCandidates({ fullName: input.fullName, dateOfBirth: input.dateOfBirth, phoneDigits: input.phoneDigits, otherPhoneDigits: input.otherPhoneDigits });
  if (duplicates.length && body.confirmDuplicate !== true) {
    throw new ApiError(409, "Possible existing patient found.", undefined, { duplicates });
  }
  const created = await db.transaction(async (tx) => {
    const patientNumber = await nextNumber(tx, "patient", "PAT");
    const rows = await tx.insert(patients).values({
      ...input,
      fullName: input.fullName || "Unnamed",
      patientNumber,
      registrationDate: input.registrationDate || todayISO(await getSetting("timezone", "Africa/Kampala")),
      createdBy: user.id,
    }).returning();
    await audit(tx, req, user, { action: "patient_created", module: "patients", recordId: rows[0].id, description: `Registered ${patientNumber} ${rows[0].fullName}`, newValue: { patientNumber, fullName: rows[0].fullName } });
    return rows[0];
  });
  return json({ patient: presentPatient(created, user), message: "Patient registered successfully." });
}

export async function patientsCheck(req: Request, user: SessionUser) {
  await requirePerm(user, "patients.create");
  const body = await readJson(req);
  const phone = normalizePhone(body.phone);
  const other = normalizePhone(body.otherPhone);
  const duplicates = await duplicateCandidates({
    fullName: str(body.fullName, 160),
    dateOfBirth: dateOrNull(body.dateOfBirth, "Date of birth"),
    phoneDigits: phone.digits,
    otherPhoneDigits: other.digits,
    excludeId: body.excludeId ? Number(body.excludeId) : undefined,
  });
  return json({ duplicates });
}

export async function patientsGet(req: Request, user: SessionUser, idOrNumber: string) {
  await requirePerm(user, "patients.view");
  const patient = await findPatient(idOrNumber);
  if (!patient) throw new ApiError(404, "Patient not found.");
  const view = presentPatient(patient, user);
  const timeline: { at: string; label: string; detail: string; module: string }[] = [
    { at: String(patient.createdAt), label: "Registration", detail: patient.patientNumber, module: "patients" },
  ];
  const appts = can(user, "appointments.view") ? await db.select().from(appointments).where(eq(appointments.patientId, patient.id)).orderBy(desc(appointments.appointmentDate)) : [];
  const nurses = can(user, "nurse.view") ? await db.select().from(nurseEncounters).where(eq(nurseEncounters.patientId, patient.id)).orderBy(desc(nurseEncounters.recordedAt)) : [];
  const clinical = can(user, "clinical.view") || (can(user, "override.emergency") && await (await import("../core")).hasActiveOverride(user.id, "clinical"))
    ? await db.select().from(doctorEncounters).where(eq(doctorEncounters.patientId, patient.id)).orderBy(desc(doctorEncounters.recordedAt))
    : [];
  const psychologyAllowed = can(user, "psychology.view") || (can(user, "override.emergency") && await (await import("../core")).hasActiveOverride(user.id, "psychology"));
  const psychology = psychologyAllowed ? await db.select().from(psychologySessions).where(eq(psychologySessions.patientId, patient.id)).orderBy(desc(psychologySessions.sessionDate)) : [];
  if (psychologyAllowed) {
    await audit(db, req, user, { action: "sensitive_view", module: "psychology", recordId: patient.id, description: `Viewed psychology history for ${patient.patientNumber}` });
  }
  const rx = can(user, "prescriptions.view") ? await db.select().from(prescriptions).where(eq(prescriptions.patientId, patient.id)).orderBy(desc(prescriptions.prescribedAt)) : [];
  const rxItems = rx.length ? await db.select().from(prescriptionItems).where(or(...rx.map((item) => eq(prescriptionItems.prescriptionId, item.id)))) : [];
  const bills = can(user, "billing.view") ? await db.select().from(invoices).where(eq(invoices.patientId, patient.id)).orderBy(desc(invoices.invoiceDate)) : [];
  const pays = can(user, "billing.view") ? await db.select().from(payments).where(eq(payments.patientId, patient.id)).orderBy(desc(payments.createdAt)) : [];
  const rcts = can(user, "receipts.view") ? await db.select().from(receipts).where(eq(receipts.patientId, patient.id)).orderBy(desc(receipts.receiptDate)) : [];
  const docs = can(user, "documents.view") ? await db.select({
    id: documents.id, name: documents.name, type: documents.type, description: documents.description, fileName: documents.fileName, mimeType: documents.mimeType, size: documents.size, createdAt: documents.createdAt, status: documents.status,
  }).from(documents).where(and(eq(documents.patientId, patient.id), eq(documents.status, "Active"))).orderBy(desc(documents.createdAt)) : [];
  const follows = await db.select().from(followUps).where(eq(followUps.patientId, patient.id)).orderBy(desc(followUps.dueDate));
  const dx = can(user, "clinical.view") || can(user, "psychology.view") ? await db.select().from(diagnoses).where(eq(diagnoses.patientId, patient.id)).orderBy(desc(diagnoses.recordedAt)) : [];
  for (const row of appts) timeline.push({ at: `${row.appointmentDate}T${row.appointmentTime}:00`, label: "Appointment", detail: `${row.appointmentNumber} · ${row.status}`, module: "appointments" });
  for (const row of nurses) timeline.push({ at: row.recordedAt.toISOString(), label: "Nurse triage", detail: row.encounterNumber, module: "nurse" });
  for (const row of clinical) timeline.push({ at: row.recordedAt.toISOString(), label: "Doctor consultation", detail: row.encounterNumber, module: "doctors" });
  for (const row of psychology) timeline.push({ at: `${row.sessionDate}T09:00:00`, label: "Psychology session", detail: row.sessionNumber, module: "psychology" });
  for (const row of rx) timeline.push({ at: row.prescribedAt.toISOString(), label: "Prescription", detail: row.prescriptionNumber, module: "prescriptions" });
  for (const row of bills) timeline.push({ at: `${row.invoiceDate}T12:00:00`, label: "Invoice", detail: `${row.invoiceNumber} · ${row.status}`, module: "billing" });
  for (const row of rcts) timeline.push({ at: row.receiptDate.toISOString(), label: "Receipt", detail: row.receiptNumber, module: "receipts" });
  timeline.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const history = can(user, "audit.view") || can(user, "patients.edit")
    ? await db.select({ id: auditLogs.id, createdAt: auditLogs.createdAt, userName: auditLogs.userName, action: auditLogs.action, module: auditLogs.module, description: auditLogs.description }).from(auditLogs).where(or(eq(auditLogs.recordId, String(patient.id)), eq(auditLogs.recordId, patient.patientNumber))).orderBy(desc(auditLogs.createdAt)).limit(40)
    : [];
  const revisions = can(user, "patients.edit") ? await db.select().from(recordRevisions).where(and(eq(recordRevisions.module, "patients"), eq(recordRevisions.recordId, String(patient.id)))).orderBy(desc(recordRevisions.createdAt)).limit(20) : [];
  const doctors = await db.select({ id: users.id, name: users.name }).from(users);
  const doctorName = new Map(doctors.map((row) => [row.id, row.name]));
  return json({
    patient: view,
    timeline,
    appointments: appts.map((row) => ({ ...row, doctorName: doctorName.get(row.doctorId) || "" })),
    nurse: nurses.map((row) => ({ ...row, nurseName: row.nurseId ? doctorName.get(row.nurseId) || "" : "" })),
    clinical: clinical.map((row) => ({ ...row, doctorName: row.doctorId ? doctorName.get(row.doctorId) || "" : "" })),
    psychology: psychology.map((row) => ({ ...row, psychologistName: row.psychologistId ? doctorName.get(row.psychologistId) || "" : "" })),
    prescriptions: rx.map((row) => ({ ...row, items: rxItems.filter((item) => item.prescriptionId === row.id), clinicianName: row.clinicianId ? doctorName.get(row.clinicianId) || "" : "" })),
    invoices: bills,
    payments: pays,
    receipts: rcts.map(({ ...row }) => row),
    documents: docs,
    followUps: follows,
    diagnoses: dx,
    history,
    revisions: revisions.map((row) => ({ id: row.id, createdAt: row.createdAt, userId: row.userId })),
    age: ageFromDob(patient.dateOfBirth),
  });
}

export async function patientsQr(req: Request, user: SessionUser, idOrNumber: string) {
  await requirePerm(user, "patients.view");
  const patient = await findPatient(idOrNumber);
  if (!patient) throw new ApiError(404, "Patient not found.");
  await audit(db, req, user, { action: "patient_card_viewed", module: "patients", recordId: patient.id, description: `Opened patient card for ${patient.patientNumber}` });
  return qrFor(req, patient.patientNumber, patient.id);
}

export async function patientsUpdate(req: Request, user: SessionUser, idOrNumber: string) {
  await requirePerm(user, "patients.edit");
  const patient = await findPatient(idOrNumber);
  if (!patient) throw new ApiError(404, "Patient not found.");
  const body = await readJson(req);
  const version = Number(body.version);
  if (version !== patient.version) throw new ApiError(409, "This patient was updated by someone else. Reload and try again.");
  const input = patientInput({ ...patient, services: patient.services, ...body });
  if (input.gender) await assertLabel("gender", input.gender, "Gender");
  if (input.status) await assertLabel("patient_status", input.status, "Status");
  const duplicates = await duplicateCandidates({ fullName: input.fullName, dateOfBirth: input.dateOfBirth, phoneDigits: input.phoneDigits, otherPhoneDigits: input.otherPhoneDigits, excludeId: patient.id });
  if (duplicates.length && body.confirmDuplicate !== true) throw new ApiError(409, "Possible existing patient found.", undefined, { duplicates });
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(patients).set({ ...input, fullName: input.fullName || patient.fullName, updatedAt: new Date(), version: patient.version + 1 }).where(and(eq(patients.id, patient.id), eq(patients.version, version))).returning();
    if (!rows.length) throw new ApiError(409, "This patient was updated by someone else. Reload and try again.");
    await revise(tx, "patients", patient.id, user.id, { fullName: patient.fullName, phone: patient.phone, status: patient.status, address: patient.address }, { fullName: rows[0].fullName, phone: rows[0].phone, status: rows[0].status, address: rows[0].address });
    await audit(tx, req, user, { action: "patient_updated", module: "patients", recordId: patient.id, description: `Updated ${patient.patientNumber}`, previousValue: { fullName: patient.fullName, status: patient.status }, newValue: { fullName: rows[0].fullName, status: rows[0].status } });
    return rows[0];
  });
  return json({ patient: presentPatient(updated, user), message: "Patient updated successfully." });
}

export async function patientsArchive(req: Request, user: SessionUser, idOrNumber: string) {
  await requirePerm(user, "patients.archive");
  const patient = await findPatient(idOrNumber);
  if (!patient) throw new ApiError(404, "Patient not found.");
  const body = await readJson(req);
  const reason = requireText(body.reason, "Reason", 200);
  await db.update(patients).set({ status: "Archived", archivedAt: new Date(), updatedAt: new Date(), version: sql`${patients.version} + 1`, notes: `${patient.notes || ""}\nArchived: ${reason}`.trim() }).where(eq(patients.id, patient.id));
  await audit(db, req, user, { action: "patient_archived", module: "patients", recordId: patient.id, description: `Archived ${patient.patientNumber}: ${reason}` });
  return json({ ok: true, message: "Patient archived. Clinical and financial history was kept." });
}

async function refreshNext(patientId: number) {
  const today = todayISO(await getSetting("timezone", "Africa/Kampala"));
  const upcoming = await db.select().from(appointments).where(and(
    eq(appointments.patientId, patientId),
    sql`${appointments.appointmentDate} >= ${today}`,
    sql`${appointments.status} in ('Scheduled', 'Confirmed', 'Rescheduled')`,
  )).orderBy(asc(appointments.appointmentDate), asc(appointments.appointmentTime)).limit(1);
  await db.update(patients).set({ nextAppointment: upcoming[0]?.appointmentDate ?? null }).where(eq(patients.id, patientId));
}

export async function appointmentsCollection(req: Request, user: SessionUser) {
  await requirePerm(user, "appointments.view");
  const url = new URL(req.url);
  const from = str(url.searchParams.get("from"), 10);
  const to = str(url.searchParams.get("to"), 10);
  const date = str(url.searchParams.get("date"), 10);
  const doctorId = Number(url.searchParams.get("doctorId") || 0);
  const status = str(url.searchParams.get("status"), 40);
  const patientId = Number(url.searchParams.get("patientId") || 0);
  const q = str(url.searchParams.get("q"), 80);
  const where = and(
    from ? sql`${appointments.appointmentDate} >= ${from}` : undefined,
    to ? sql`${appointments.appointmentDate} <= ${to}` : undefined,
    date ? eq(appointments.appointmentDate, date) : undefined,
    doctorId ? eq(appointments.doctorId, doctorId) : undefined,
    status ? eq(appointments.status, status) : undefined,
    patientId ? eq(appointments.patientId, patientId) : undefined,
    q ? or(ilike(appointments.appointmentNumber, `%${q}%`), ilike(appointments.reason, `%${q}%`), sql`exists (select 1 from patients p where p.id = ${appointments.patientId} and (p.full_name ilike ${"%" + q + "%"} or p.patient_number ilike ${"%" + q + "%"}))`) : undefined,
  );
  const rows = await db.select({
    appointment: appointments,
    patientName: patients.fullName,
    patientNumber: patients.patientNumber,
    gender: patients.gender,
    dateOfBirth: patients.dateOfBirth,
    doctorName: users.name,
    specialty: users.specialty,
  }).from(appointments).innerJoin(patients, eq(appointments.patientId, patients.id)).innerJoin(users, eq(appointments.doctorId, users.id)).where(where).orderBy(asc(appointments.appointmentDate), asc(appointments.appointmentTime)).limit(500);
  return json({
    items: rows.map((row) => ({
      ...row.appointment,
      patientName: row.patientName,
      patientNumber: row.patientNumber,
      age: ageFromDob(row.dateOfBirth),
      gender: row.gender,
      doctorName: row.doctorName,
      specialty: row.specialty,
    })),
  });
}

export async function appointmentsCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "appointments.create");
  const body = await readJson(req);
  const patient = await findPatient(String(body.patientId || ""));
  if (!patient || patient.status === "Archived") throw new ApiError(400, "Select a valid patient.");
  const doctorId = Number(body.doctorId);
  const doctor = await db.select().from(users).where(eq(users.id, doctorId)).limit(1);
  if (!doctor[0]) throw new ApiError(400, "Select a valid doctor.");
  const allowInactive = (await getSetting("allow_inactive_doctors", "false")) === "true";
  if (doctor[0].status !== "active" && !allowInactive) throw new ApiError(400, "Inactive doctors cannot receive new appointments.");
  const appointmentDate = requireDate(body.appointmentDate, "Appointment date");
  const appointmentTime = timeOrThrow(body.appointmentTime);
  const status = str(body.status, 40) || "Scheduled";
  await assertLabel("appointment_status", status, "Status");
  await assertSlotFree(doctorId, appointmentDate, appointmentTime, patient.id);
  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(appointments).values({
      appointmentNumber: await nextNumber(tx, "appointment", "APT"),
      patientId: patient.id,
      doctorId,
      appointmentDate,
      appointmentTime,
      reason: opt(body.reason, 300),
      status,
      notes: opt(body.notes, 1000),
      createdBy: user.id,
    }).returning();
    await audit(tx, req, user, { action: "appointment_created", module: "appointments", recordId: rows[0].id, description: `Created ${rows[0].appointmentNumber} for ${patient.patientNumber}` });
    return rows[0];
  });
  await refreshNext(patient.id);
  return json({ appointment: created, message: "Appointment created successfully." });
}

async function assertSlotFree(doctorId: number, date: string, time: string, patientId: number, excludeId?: number) {
  const doctorClash = await db.select({ id: appointments.id }).from(appointments).where(and(
    eq(appointments.doctorId, doctorId),
    eq(appointments.appointmentDate, date),
    eq(appointments.appointmentTime, time),
    sql`${appointments.status} not in ('Cancelled', 'No Show', 'Rescheduled')`,
    excludeId ? sql`${appointments.id} <> ${excludeId}` : undefined,
  )).limit(1);
  if (doctorClash.length) throw new ApiError(409, "That doctor already has an appointment at this time.");
  const patientClash = await db.select({ id: appointments.id }).from(appointments).where(and(
    eq(appointments.patientId, patientId),
    eq(appointments.appointmentDate, date),
    eq(appointments.appointmentTime, time),
    sql`${appointments.status} not in ('Cancelled', 'No Show', 'Rescheduled')`,
    excludeId ? sql`${appointments.id} <> ${excludeId}` : undefined,
  )).limit(1);
  if (patientClash.length) throw new ApiError(409, "This patient already has an appointment at this time.");
}

export async function appointmentsUpdate(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "appointments.edit");
  const body = await readJson(req);
  const existing = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Appointment not found.");
  if (Number(body.version) !== existing[0].version) throw new ApiError(409, "This appointment was changed by someone else. Reload and try again.");
  const appointmentDate = body.appointmentDate ? requireDate(body.appointmentDate, "Appointment date") : existing[0].appointmentDate;
  const appointmentTime = body.appointmentTime ? timeOrThrow(body.appointmentTime) : existing[0].appointmentTime;
  const status = body.status ? str(body.status, 40) : existing[0].status;
  await assertLabel("appointment_status", status, "Status");
  if (["Cancelled", "No Show"].includes(status) && !str(body.cancelReason || body.reason, 200) && !existing[0].cancelReason) {
    throw new ApiError(400, "Enter a reason for this status change.");
  }
  const doctorId = body.doctorId ? Number(body.doctorId) : existing[0].doctorId;
  if (status !== "Cancelled" && status !== "No Show" && status !== "Rescheduled") {
    await assertSlotFree(doctorId, appointmentDate, appointmentTime, existing[0].patientId, id);
  }
  const updated = await db.update(appointments).set({
    doctorId,
    appointmentDate,
    appointmentTime,
    reason: body.reason !== undefined ? opt(body.reason, 300) : existing[0].reason,
    notes: body.notes !== undefined ? opt(body.notes, 1000) : existing[0].notes,
    status,
    cancelReason: body.cancelReason ? str(body.cancelReason, 300) : existing[0].cancelReason,
    updatedAt: new Date(),
    version: existing[0].version + 1,
  }).where(and(eq(appointments.id, id), eq(appointments.version, existing[0].version))).returning();
  if (!updated.length) throw new ApiError(409, "This appointment was changed by someone else. Reload and try again.");
  await audit(db, req, user, { action: "appointment_updated", module: "appointments", recordId: id, description: `Updated ${existing[0].appointmentNumber} to ${status}`, previousValue: { status: existing[0].status, appointmentDate: existing[0].appointmentDate, appointmentTime: existing[0].appointmentTime }, newValue: { status, appointmentDate, appointmentTime } });
  await refreshNext(existing[0].patientId);
  return json({ appointment: updated[0], message: "Appointment updated successfully." });
}

export async function queueCollection(req: Request, user: SessionUser) {
  await requirePerm(user, "queue.view");
  const url = new URL(req.url);
  const department = str(url.searchParams.get("department"), 60);
  const status = str(url.searchParams.get("status"), 40);
  const where = and(
    department ? eq(queueEntries.department, department) : undefined,
    status ? eq(queueEntries.status, status) : sql`${queueEntries.status} <> 'Completed'`,
  );
  const rows = await db.select({
    queue: queueEntries,
    patientName: patients.fullName,
    patientNumber: patients.patientNumber,
    gender: patients.gender,
    dateOfBirth: patients.dateOfBirth,
  }).from(queueEntries).innerJoin(patients, eq(queueEntries.patientId, patients.id)).where(where).orderBy(desc(queueEntries.arrivalTime)).limit(200);
  const rank = { Emergency: 0, Urgent: 1, Normal: 2 } as Record<string, number>;
  const items = rows.map((row) => ({
    ...row.queue,
    patientName: row.patientName,
    patientNumber: row.patientNumber,
    gender: row.gender,
    age: ageFromDob(row.dateOfBirth),
    waitingMinutes: Math.max(0, Math.floor((Date.now() - new Date(row.queue.arrivalTime).getTime()) / 60000)),
  })).sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || a.arrivalTime.getTime() - b.arrivalTime.getTime());
  return json({ items });
}

export async function queueCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "queue.manage");
  const body = await readJson(req);
  const patient = await findPatient(String(body.patientId || ""));
  if (!patient) throw new ApiError(400, "Select a valid patient.");
  const today = todayISO(await getSetting("timezone", "Africa/Kampala"));
  const count = await db.execute(sql`select count(*)::int as count from queue_entries where arrival_time::date = ${today}::date`);
  const n = Number(readRows<{ count: number }>(count)[0]?.count ?? 0) + 1;
  const created = await db.insert(queueEntries).values({
    queueNumber: `Q-${today.replace(/-/g, "")}-${String(n).padStart(3, "0")}`,
    patientId: patient.id,
    appointmentId: body.appointmentId ? Number(body.appointmentId) : null,
    service: opt(body.service, 80),
    department: str(body.department, 60) || "Reception",
    status: "Waiting",
    priority: str(body.priority, 20) || "Normal",
    notes: opt(body.notes, 300),
    createdBy: user.id,
  }).returning();
  await audit(db, req, user, { action: "queue_added", module: "queue", recordId: created[0].id, description: `Added ${patient.patientNumber} to the queue as ${created[0].queueNumber}` });
  return json({ entry: created[0], message: "Patient added to the queue." });
}

export async function queueStatus(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "queue.manage");
  const body = await readJson(req);
  const status = requireText(body.status, "Status", 40);
  await assertLabel("queue_status", status, "Queue status");
  const existing = await db.select().from(queueEntries).where(eq(queueEntries.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Queue entry not found.");
  const updated = await db.update(queueEntries).set({
    status,
    department: body.department ? str(body.department, 60) : existing[0].department,
    priority: body.priority ? str(body.priority, 20) : existing[0].priority,
    calledAt: status === "Called" ? new Date() : existing[0].calledAt,
    completedAt: status === "Completed" ? new Date() : existing[0].completedAt,
    updatedAt: new Date(),
  }).where(eq(queueEntries.id, id)).returning();
  await audit(db, req, user, { action: "queue_updated", module: "queue", recordId: id, description: `Queue ${existing[0].queueNumber} moved to ${status}`, previousValue: { status: existing[0].status }, newValue: { status } });
  return json({ entry: updated[0], message: status === "Called" ? "Patient called." : "Queue updated successfully." });
}

export async function documentsCollection(req: Request, user: SessionUser) {
  await requirePerm(user, "documents.view");
  const patientId = Number(new URL(req.url).searchParams.get("patientId") || 0);
  const where = and(eq(documents.status, "Active"), patientId ? eq(documents.patientId, patientId) : undefined);
  const rows = await db.select({
    id: documents.id,
    patientId: documents.patientId,
    name: documents.name,
    type: documents.type,
    description: documents.description,
    fileName: documents.fileName,
    mimeType: documents.mimeType,
    size: documents.size,
    createdAt: documents.createdAt,
    uploadedBy: documents.uploadedBy,
    patientNumber: patients.patientNumber,
    fullName: patients.fullName,
  }).from(documents).innerJoin(patients, eq(documents.patientId, patients.id)).where(where).orderBy(desc(documents.createdAt)).limit(100);
  return json({ items: rows });
}

export async function documentsCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "documents.upload");
  const body = await readJson(req);
  const patient = await findPatient(String(body.patientId || ""));
  if (!patient) throw new ApiError(400, "Select a patient.");
  const name = requireText(body.name, "Document name", 160);
  const fileName = requireText(body.fileName, "File name", 180);
  const mimeType = requireText(body.mimeType, "File type", 80);
  const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"];
  if (!allowed.includes(mimeType)) throw new ApiError(400, "Upload a PDF, image, or text file.");
  const data = str(body.dataBase64, 3_000_000);
  if (!data) throw new ApiError(400, "The file was empty.");
  const size = Math.floor((data.length * 3) / 4);
  if (size > 2_000_000) throw new ApiError(400, "Files must be 2MB or smaller.");
  const created = await db.insert(documents).values({
    patientId: patient.id,
    name,
    type: str(body.type, 60) || "Other",
    description: opt(body.description, 400),
    fileName,
    mimeType,
    size,
    fileData: data,
    uploadedBy: user.id,
  }).returning({ id: documents.id });
  await audit(db, req, user, { action: "document_uploaded", module: "documents", recordId: created[0].id, description: `Uploaded ${name} for ${patient.patientNumber}` });
  return json({ id: created[0].id, message: "Document uploaded successfully." });
}

export async function documentsFile(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "documents.view");
  const rows = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.status, "Active"))).limit(1);
  if (!rows[0]) throw new ApiError(404, "Document not found.");
  await audit(db, req, user, { action: "document_viewed", module: "documents", recordId: id, description: `Viewed document ${rows[0].name}` });
  const buffer = Buffer.from(rows[0].fileData, "base64");
  return new Response(buffer, {
    headers: {
      "Content-Type": rows[0].mimeType,
      "Content-Disposition": `attachment; filename="${rows[0].fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function documentsArchive(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "documents.upload");
  const body = await readJson(req);
  const reason = requireText(body.reason, "Reason", 200);
  const updated = await db.update(documents).set({ status: "Archived" }).where(eq(documents.id, id)).returning({ id: documents.id });
  if (!updated.length) throw new ApiError(404, "Document not found.");
  await audit(db, req, user, { action: "document_archived", module: "documents", recordId: id, description: `Archived document: ${reason}` });
  return json({ ok: true, message: "Document archived." });
}
