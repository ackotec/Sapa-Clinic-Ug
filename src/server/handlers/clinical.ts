import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  diagnoses,
  doctorEncounters,
  followUps,
  inventoryTransactions,
  investigations,
  invoiceItems,
  invoices,
  medicineBatches,
  medicines,
  nurseEncounters,
  patients,
  prescriptionItems,
  prescriptions,
  psychologySessions,
  queueEntries,
  users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/types";
import {
  ApiError,
  audit,
  bmi,
  can,
  dateOrNull,
  decimalOrNull,
  getSetting,
  intOrNull,
  invoiceTotals,
  json,
  nextNumber,
  opt,
  readJson,
  requireDate,
  requirePerm,
  requireText,
  revise,
  str,
  todayISO,
  wholeAmount,
} from "../core";
import { findPatient, presentPatient, readRows } from "../shared";

function requireIdentity(body: Record<string, unknown>) {
  if (body.confirmIdentity !== true) throw new ApiError(400, "Confirm the patient identity before saving this clinical record.");
}

async function moveQueue(patientId: number, status: string) {
  const open = await db.select().from(queueEntries).where(and(eq(queueEntries.patientId, patientId), sql`${queueEntries.status} <> 'Completed'`)).orderBy(desc(queueEntries.arrivalTime)).limit(1);
  if (!open[0]) return;
  await db.update(queueEntries).set({ status, updatedAt: new Date(), completedAt: status === "Completed" ? new Date() : open[0].completedAt }).where(eq(queueEntries.id, open[0].id));
}

export async function nurseList(req: Request, user: SessionUser) {
  await requirePerm(user, "nurse.view");
  const patientId = Number(new URL(req.url).searchParams.get("patientId") || 0);
  const rows = await db.select({
    encounter: nurseEncounters,
    patientName: patients.fullName,
    patientNumber: patients.patientNumber,
    nurseName: users.name,
  }).from(nurseEncounters)
    .innerJoin(patients, eq(nurseEncounters.patientId, patients.id))
    .leftJoin(users, eq(nurseEncounters.nurseId, users.id))
    .where(patientId ? eq(nurseEncounters.patientId, patientId) : undefined)
    .orderBy(desc(nurseEncounters.recordedAt))
    .limit(100);
  return json({ items: rows.map((row) => ({ ...row.encounter, patientName: row.patientName, patientNumber: row.patientNumber, nurseName: row.nurseName })) });
}

export async function nurseCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "nurse.create");
  const body = await readJson(req);
  requireIdentity(body);
  const patient = await findPatient(String(body.patientId || ""));
  if (!patient) throw new ApiError(400, "Select a patient.");
  const weight = decimalOrNull(body.weightKg, "Weight", 400);
  const height = decimalOrNull(body.heightCm, "Height", 250);
  const pulse = intOrNull(body.pulseRate, "Pulse", 0, 300);
  const spo2 = intOrNull(body.spo2, "SPO2", 0, 100);
  const rr = intOrNull(body.respiratoryRate, "Respiratory rate", 0, 80);
  const temperature = decimalOrNull(body.temperatureC, "Temperature", 45);
  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(nurseEncounters).values({
      encounterNumber: await nextNumber(tx, "nurse", "NUR"),
      patientId: patient.id,
      nurseId: user.id,
      appointmentId: body.appointmentId ? Number(body.appointmentId) : null,
      allergies: opt(body.allergies, 1000),
      bloodPressure: opt(body.bloodPressure, 20),
      weightKg: weight,
      heightCm: height,
      pulseRate: pulse,
      spo2,
      temperatureC: temperature,
      respiratoryRate: rr,
      bmi: bmi(weight ? Number(weight) : null, height ? Number(height) : null),
      medications: opt(body.medications, 1000),
      symptoms: opt(body.symptoms, 2000),
      assessment: opt(body.assessment, 2000),
      notes: opt(body.notes, 2000),
      status: "Completed",
    }).returning();
    await audit(tx, req, user, { action: "nurse_encounter_created", module: "nurse", recordId: rows[0].id, description: `Recorded vitals ${rows[0].encounterNumber} for ${patient.patientNumber}` });
    return rows[0];
  });
  await moveQueue(patient.id, "Waiting for Doctor");
  return json({ encounter: created, message: "Nurse record saved successfully. Previous vitals were kept." });
}

function clinicalFields(body: Record<string, unknown>) {
  return {
    presentingComplaints: opt(body.presentingComplaints, 4000),
    historyOfPresentingComplaints: opt(body.historyOfPresentingComplaints, 4000),
    pastPsychiatricHistory: opt(body.pastPsychiatricHistory, 4000),
    pastMedicalSurgicalHistory: opt(body.pastMedicalSurgicalHistory, 4000),
    familyHistory: opt(body.familyHistory, 4000),
    socialPersonalHistory: opt(body.socialPersonalHistory, 4000),
    medicalHistory: opt(body.medicalHistory, 4000),
    currentSituation: opt(body.currentSituation, 4000),
    examination: opt(body.examination, 4000),
    investigation: opt(body.investigation, 4000),
    diagnosis: opt(body.diagnosis, 2000),
    treatment: opt(body.treatment, 4000),
    prescriptionNotes: opt(body.prescriptionNotes, 2000),
    referral: opt(body.referral, 2000),
    followUpDate: dateOrNull(body.followUpDate, "Follow-up date"),
    comments: opt(body.comments, 4000),
  };
}

async function savePrescription(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], req: Request, user: SessionUser, patientId: number, encounterId: number | null, sessionId: number | null, body: Record<string, unknown>) {
  const raw = body.prescription;
  if (!raw || typeof raw !== "object") return null;
  const prescription = raw as Record<string, unknown>;
  const items = Array.isArray(prescription.items) ? prescription.items : [];
  if (!items.length && !str(prescription.notes, 10)) return null;
  await requirePerm(user, "prescriptions.create");
  const created = await tx.insert(prescriptions).values({
    prescriptionNumber: await nextNumber(tx, "prescription", "RX"),
    patientId,
    clinicianId: user.id,
    encounterId,
    sessionId,
    notes: opt(prescription.notes, 2000),
    status: "Active",
  }).returning();
  for (const item of items) {
    const row = item as Record<string, unknown>;
    const name = requireText(row.medicineName, "Medicine");
    const quantity = wholeAmount(row.quantity ?? 0, "Quantity");
    await tx.insert(prescriptionItems).values({
      prescriptionId: created[0].id,
      medicineId: row.medicineId ? Number(row.medicineId) : null,
      medicineName: name,
      dose: opt(row.dose, 80),
      frequency: opt(row.frequency, 80),
      route: opt(row.route, 80),
      duration: opt(row.duration, 80),
      quantity,
      instructions: opt(row.instructions, 300),
    });
  }
  await audit(tx, req, user, { action: "prescription_created", module: "prescriptions", recordId: created[0].id, description: `Created ${created[0].prescriptionNumber}` });
  return created[0];
}

export async function clinicalList(req: Request, user: SessionUser) {
  if (!can(user, "clinical.view")) await requirePerm(user, "clinical.view", "clinical");
  const patientId = Number(new URL(req.url).searchParams.get("patientId") || 0);
  const rows = await db.select({
    encounter: doctorEncounters,
    patientName: patients.fullName,
    patientNumber: patients.patientNumber,
    doctorName: users.name,
  }).from(doctorEncounters)
    .innerJoin(patients, eq(doctorEncounters.patientId, patients.id))
    .leftJoin(users, eq(doctorEncounters.doctorId, users.id))
    .where(patientId ? eq(doctorEncounters.patientId, patientId) : undefined)
    .orderBy(desc(doctorEncounters.recordedAt))
    .limit(80);
  return json({ items: rows.map((row) => ({ ...row.encounter, patientName: row.patientName, patientNumber: row.patientNumber, doctorName: row.doctorName })) });
}

export async function clinicalCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "clinical.create");
  const body = await readJson(req);
  requireIdentity(body);
  const patient = await findPatient(String(body.patientId || ""));
  if (!patient) throw new ApiError(400, "Select a patient.");
  const fields = clinicalFields(body);
  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(doctorEncounters).values({
      encounterNumber: await nextNumber(tx, "encounter", "ENC"),
      patientId: patient.id,
      doctorId: user.id,
      appointmentId: body.appointmentId ? Number(body.appointmentId) : null,
      ...fields,
      status: "Completed",
    }).returning();
    const diagnosisList = Array.isArray(body.diagnoses) ? body.diagnoses : fields.diagnosis ? [fields.diagnosis] : [];
    for (const item of diagnosisList) {
      const description = str(item, 300);
      if (!description) continue;
      await tx.insert(diagnoses).values({ patientId: patient.id, encounterId: rows[0].id, description, diagnosisType: "Primary", recordedBy: user.id });
    }
    if (Array.isArray(body.investigations)) {
      for (const item of body.investigations) {
        const name = str(item, 160);
        if (!name) continue;
        await tx.insert(investigations).values({ patientId: patient.id, encounterId: rows[0].id, name, orderedBy: user.id, status: "Ordered" });
      }
    }
    if (fields.followUpDate) {
      await tx.insert(followUps).values({ patientId: patient.id, source: "doctor", sourceId: rows[0].id, dueDate: fields.followUpDate, reason: fields.diagnosis || "Clinical follow-up", createdBy: user.id });
    }
    if (body.appointmentId) {
      await tx.execute(sql`update appointments set status = 'Completed', updated_at = now(), version = version + 1 where id = ${Number(body.appointmentId)} and status not in ('Cancelled', 'No Show')`);
    }
    const rx = await savePrescription(tx, req, user, patient.id, rows[0].id, null, body);
    await audit(tx, req, user, { action: "clinical_created", module: "clinical", recordId: rows[0].id, description: `Consultation ${rows[0].encounterNumber} for ${patient.patientNumber}` });
    return { encounter: rows[0], prescription: rx };
  });
  await moveQueue(patient.id, created.prescription ? "Waiting for Pharmacy" : "Waiting for Payment");
  return json({ ...created, message: "Consultation saved successfully." });
}

export async function clinicalUpdate(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "clinical.edit");
  const body = await readJson(req);
  requireIdentity(body);
  const existing = await db.select().from(doctorEncounters).where(eq(doctorEncounters.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Consultation not found.");
  if (Number(body.version) !== existing[0].version) throw new ApiError(409, "This consultation was changed by someone else. Reload and try again.");
  const fields = clinicalFields(body);
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(doctorEncounters).set({ ...fields, updatedAt: new Date(), version: existing[0].version + 1 }).where(and(eq(doctorEncounters.id, id), eq(doctorEncounters.version, existing[0].version))).returning();
    if (!rows.length) throw new ApiError(409, "This consultation was changed by someone else. Reload and try again.");
    await revise(tx, "clinical", id, user.id, existing[0], rows[0]);
    await audit(tx, req, user, { action: "clinical_updated", module: "clinical", recordId: id, description: `Corrected ${existing[0].encounterNumber}`, previousValue: { diagnosis: existing[0].diagnosis, treatment: existing[0].treatment }, newValue: { diagnosis: rows[0].diagnosis, treatment: rows[0].treatment } });
    if (fields.diagnosis) {
      await tx.insert(diagnoses).values({ patientId: existing[0].patientId, encounterId: id, description: fields.diagnosis, diagnosisType: "Updated", recordedBy: user.id });
    }
    return rows[0];
  });
  return json({ encounter: updated, message: "Consultation correction saved. The previous version remains in history." });
}

export async function psychologyList(req: Request, user: SessionUser) {
  if (!can(user, "psychology.view")) await requirePerm(user, "psychology.view", "psychology");
  const patientId = Number(new URL(req.url).searchParams.get("patientId") || 0);
  if (patientId) await audit(db, req, user, { action: "sensitive_view", module: "psychology", recordId: patientId, description: "Viewed psychology sessions" });
  const rows = await db.select({
    session: psychologySessions,
    patientName: patients.fullName,
    patientNumber: patients.patientNumber,
    psychologistName: users.name,
  }).from(psychologySessions)
    .innerJoin(patients, eq(psychologySessions.patientId, patients.id))
    .leftJoin(users, eq(psychologySessions.psychologistId, users.id))
    .where(patientId ? eq(psychologySessions.patientId, patientId) : undefined)
    .orderBy(desc(psychologySessions.sessionDate))
    .limit(80);
  return json({ items: rows.map((row) => ({ ...row.session, patientName: row.patientName, patientNumber: row.patientNumber, psychologistName: row.psychologistName })) });
}

export async function psychologyCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "psychology.create");
  const body = await readJson(req);
  requireIdentity(body);
  const patient = await findPatient(String(body.patientId || ""));
  if (!patient) throw new ApiError(400, "Select a patient.");
  const sessionDate = requireDate(body.sessionDate, "Session date");
  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(psychologySessions).values({
      sessionNumber: await nextNumber(tx, "psychology", "PSY"),
      patientId: patient.id,
      psychologistId: user.id,
      linkedEncounterId: body.linkedEncounterId ? Number(body.linkedEncounterId) : null,
      sessionDate,
      sessionType: opt(body.sessionType, 80),
      diagnosis: opt(body.diagnosis, 2000),
      treatment: opt(body.treatment, 4000),
      assessment: opt(body.assessment, 4000),
      progress: opt(body.progress, 4000),
      notes: opt(body.notes, 4000),
      followUpDate: dateOrNull(body.followUpDate, "Follow-up date"),
      status: "Completed",
    }).returning();
    if (rows[0].diagnosis) {
      await tx.insert(diagnoses).values({ patientId: patient.id, sessionId: rows[0].id, description: rows[0].diagnosis, diagnosisType: "Psychology", recordedBy: user.id });
    }
    if (rows[0].followUpDate) {
      await tx.insert(followUps).values({ patientId: patient.id, source: "psychology", sourceId: rows[0].id, dueDate: rows[0].followUpDate, reason: "Psychology follow-up", createdBy: user.id });
    }
    await audit(tx, req, user, { action: "psychology_created", module: "psychology", recordId: rows[0].id, description: `Session ${rows[0].sessionNumber} for ${patient.patientNumber}` });
    return rows[0];
  });
  return json({ session: created, message: "Psychology session saved successfully." });
}

export async function psychologyUpdate(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "psychology.edit");
  const body = await readJson(req);
  requireIdentity(body);
  const existing = await db.select().from(psychologySessions).where(eq(psychologySessions.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Session not found.");
  if (Number(body.version) !== existing[0].version) throw new ApiError(409, "This session was changed by someone else. Reload and try again.");
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(psychologySessions).set({
      sessionType: opt(body.sessionType, 80),
      diagnosis: opt(body.diagnosis, 2000),
      treatment: opt(body.treatment, 4000),
      assessment: opt(body.assessment, 4000),
      progress: opt(body.progress, 4000),
      notes: opt(body.notes, 4000),
      followUpDate: dateOrNull(body.followUpDate, "Follow-up date"),
      updatedAt: new Date(),
      version: existing[0].version + 1,
    }).where(and(eq(psychologySessions.id, id), eq(psychologySessions.version, existing[0].version))).returning();
    if (!rows.length) throw new ApiError(409, "This session was changed by someone else. Reload and try again.");
    await revise(tx, "psychology", id, user.id, { diagnosis: existing[0].diagnosis, treatment: existing[0].treatment, notes: existing[0].notes }, { diagnosis: rows[0].diagnosis, treatment: rows[0].treatment, notes: rows[0].notes });
    await audit(tx, req, user, { action: "psychology_updated", module: "psychology", recordId: id, description: `Corrected ${existing[0].sessionNumber}` });
    return rows[0];
  });
  return json({ session: updated, message: "Session correction saved. Previous content remains in history." });
}

export async function prescriptionList(req: Request, user: SessionUser) {
  await requirePerm(user, "prescriptions.view");
  const url = new URL(req.url);
  const patientId = Number(url.searchParams.get("patientId") || 0);
  const status = str(url.searchParams.get("status"), 40);
  const rows = await db.select({
    prescription: prescriptions,
    patientName: patients.fullName,
    patientNumber: patients.patientNumber,
    clinicianName: users.name,
  }).from(prescriptions)
    .innerJoin(patients, eq(prescriptions.patientId, patients.id))
    .leftJoin(users, eq(prescriptions.clinicianId, users.id))
    .where(and(patientId ? eq(prescriptions.patientId, patientId) : undefined, status ? eq(prescriptions.status, status) : undefined))
    .orderBy(desc(prescriptions.prescribedAt))
    .limit(100);
  const ids = rows.map((row) => row.prescription.id);
  const items = ids.length ? await db.select().from(prescriptionItems).where(sql`${prescriptionItems.prescriptionId} in (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})`) : [];
  return json({
    items: rows.map((row) => ({
      ...row.prescription,
      patientName: row.patientName,
      patientNumber: row.patientNumber,
      clinicianName: row.clinicianName,
      items: items.filter((item) => item.prescriptionId === row.prescription.id),
    })),
  });
}

export async function dispense(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "prescriptions.dispense");
  const body = await readJson(req);
  const requested = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  if (!requested.length) throw new ApiError(400, "Select at least one medicine to dispense.");
  const today = todayISO(await getSetting("timezone", "Africa/Kampala"));
  const result = await db.transaction(async (tx) => {
    const rx = await tx.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1);
    if (!rx[0]) throw new ApiError(404, "Prescription not found.");
    const patient = await tx.select().from(patients).where(eq(patients.id, rx[0].patientId)).limit(1);
    const charges: { description: string; amount: number; quantity: number; unitPrice: number }[] = [];
    for (const request of requested) {
      const itemId = Number(request.itemId);
      const quantity = wholeAmount(request.quantity, "Dispense quantity", false);
      const item = await tx.select().from(prescriptionItems).where(and(eq(prescriptionItems.id, itemId), eq(prescriptionItems.prescriptionId, id))).limit(1);
      if (!item[0]) throw new ApiError(400, "A prescription item was not found.");
      const remaining = item[0].quantity - item[0].dispensedQty;
      if (quantity > remaining) throw new ApiError(400, `${item[0].medicineName} only has ${remaining} remaining on this prescription.`);
      if (!item[0].medicineId) throw new ApiError(400, `${item[0].medicineName} is not linked to inventory. Link a stock item before dispensing.`);
      let left = quantity;
      const batches = await tx.select().from(medicineBatches).where(and(
        eq(medicineBatches.medicineId, item[0].medicineId),
        sql`${medicineBatches.quantityRemaining} > 0`,
        sql`${medicineBatches.expiryDate} >= ${today}`,
      )).orderBy(medicineBatches.expiryDate, medicineBatches.id);
      for (const batch of batches) {
        if (left <= 0) break;
        const take = Math.min(left, batch.quantityRemaining);
        const updated = await tx.update(medicineBatches).set({ quantityRemaining: sql`${medicineBatches.quantityRemaining} - ${take}` }).where(and(
          eq(medicineBatches.id, batch.id),
          sql`${medicineBatches.quantityRemaining} >= ${take}`,
          sql`${medicineBatches.expiryDate} >= ${today}`,
        )).returning();
        if (!updated.length) throw new ApiError(409, "Stock changed while dispensing. Please retry.");
        await tx.insert(inventoryTransactions).values({
          medicineId: item[0].medicineId,
          batchId: batch.id,
          type: "Dispensed",
          quantity: -take,
          unitCost: batch.unitCost,
          patientId: rx[0].patientId,
          prescriptionItemId: item[0].id,
          reference: rx[0].prescriptionNumber,
          performedBy: user.id,
          notes: "FEFO dispense",
        });
        charges.push({ description: `${item[0].medicineName} (${batch.batchNumber})`, amount: take * batch.sellingPrice, quantity: take, unitPrice: batch.sellingPrice });
        left -= take;
      }
      if (left > 0) throw new ApiError(400, `Not enough valid stock for ${item[0].medicineName}. Expired batches are not dispensed.`);
      await tx.update(prescriptionItems).set({ dispensedQty: item[0].dispensedQty + quantity }).where(eq(prescriptionItems.id, item[0].id));
    }
    const allItems = await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, id));
    const fully = allItems.every((item) => item.dispensedQty >= item.quantity);
    await tx.update(prescriptions).set({ status: fully ? "Dispensed" : "Partially Dispensed" }).where(eq(prescriptions.id, id));
    let invoice = null;
    if (body.createInvoice === true && charges.length) {
      await requirePerm(user, "billing.create");
      const medicineCost = charges.reduce((sum, charge) => sum + charge.amount, 0);
      const totals = invoiceTotals({ consultationFee: 0, medicineCost, laboratoryCharges: 0, otherCharges: 0, discount: 0 });
      const invoiceNumber = await nextNumber(tx, "invoice", "INV");
      const createdInvoice = await tx.insert(invoices).values({
        invoiceNumber,
        patientId: rx[0].patientId,
        doctorId: rx[0].clinicianId,
        invoiceDate: today,
        medicineCost,
        totalAmount: totals.totalAmount,
        amountPaid: 0,
        balance: totals.balance,
        status: totals.status,
        snapshotPatientName: patient[0]?.fullName,
        snapshotPatientNumber: patient[0]?.patientNumber,
        createdBy: user.id,
        notes: `Dispensed from ${rx[0].prescriptionNumber}`,
      }).returning();
      for (const charge of charges) {
        await tx.insert(invoiceItems).values({ invoiceId: createdInvoice[0].id, description: charge.description, category: "Medicine", quantity: charge.quantity, unitPrice: charge.unitPrice, amount: charge.amount });
      }
      invoice = createdInvoice[0];
    }
    await audit(tx, req, user, { action: "medicine_dispensed", module: "inventory", recordId: id, description: `Dispensed medicines for ${rx[0].prescriptionNumber}` });
    return { invoice };
  });
  const patientId = (await db.select({ patientId: prescriptions.patientId }).from(prescriptions).where(eq(prescriptions.id, id)))[0]?.patientId;
  if (patientId) await moveQueue(patientId, "Waiting for Payment");
  return json({ ...result, message: "Medicine stock updated successfully." });
}

export async function inventoryList(user: SessionUser) {
  await requirePerm(user, "inventory.view");
  const today = todayISO(await getSetting("timezone", "Africa/Kampala"));
  const warning = Number(await getSetting("expiry_warning_days", "30")) || 30;
  const meds = await db.select().from(medicines).orderBy(medicines.name);
  const batches = await db.select().from(medicineBatches).orderBy(medicineBatches.expiryDate);
  const items = meds.map((medicine) => {
    const own = batches.filter((batch) => batch.medicineId === medicine.id);
    const quantity = own.reduce((sum, batch) => sum + batch.quantityRemaining, 0);
    const available = own.filter((batch) => batch.expiryDate >= today).reduce((sum, batch) => sum + batch.quantityRemaining, 0);
    const stockValue = own.reduce((sum, batch) => sum + batch.quantityRemaining * batch.unitCost, 0);
    const expired = own.some((batch) => batch.quantityRemaining > 0 && batch.expiryDate < today);
    const expiring = own.some((batch) => batch.quantityRemaining > 0 && batch.expiryDate >= today && batch.expiryDate <= addDays(today, warning));
    let stockAlert = "OK";
    if (available === 0) stockAlert = "OUT OF STOCK";
    else if (available <= medicine.reorderLevel) stockAlert = "REORDER";
    let expiryAlert = "OK";
    if (expired) expiryAlert = "EXPIRED";
    else if (expiring) expiryAlert = "EXPIRING SOON";
    return { ...medicine, quantity, available, stockValue, stockAlert, expiryAlert, batches: own };
  });
  return json({ items, warningDays: warning });
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function medicineCreate(req: Request, user: SessionUser) {
  await requirePerm(user, "inventory.create");
  const body = await readJson(req);
  const name = requireText(body.name, "Medicine name");
  const created = await db.transaction(async (tx) => {
    const rows = await tx.insert(medicines).values({
      medicineCode: await nextNumber(tx, "medicine", "MED"),
      name,
      category: opt(body.category, 80),
      supplierName: opt(body.supplierName, 160),
      unit: str(body.unit, 40) || "tablet",
      reorderLevel: wholeAmount(body.reorderLevel ?? 0, "Reorder level"),
      unitPrice: wholeAmount(body.unitPrice ?? 0, "Unit price"),
      notes: opt(body.notes, 500),
      status: "Active",
    }).returning();
    await audit(tx, req, user, { action: "medicine_created", module: "inventory", recordId: rows[0].id, description: `Added ${rows[0].medicineCode} ${name}` });
    return rows[0];
  });
  return json({ medicine: created, message: "Medicine added successfully." });
}

export async function medicineUpdate(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "inventory.create");
  const body = await readJson(req);
  const existing = await db.select().from(medicines).where(eq(medicines.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "Medicine not found.");
  const status = str(body.status, 20) || existing[0].status;
  const updated = await db.update(medicines).set({
    name: body.name ? requireText(body.name, "Medicine name") : existing[0].name,
    category: body.category !== undefined ? opt(body.category, 80) : existing[0].category,
    supplierName: body.supplierName !== undefined ? opt(body.supplierName, 160) : existing[0].supplierName,
    reorderLevel: body.reorderLevel != null ? wholeAmount(body.reorderLevel, "Reorder level") : existing[0].reorderLevel,
    unitPrice: body.unitPrice != null ? wholeAmount(body.unitPrice, "Unit price") : existing[0].unitPrice,
    status: status === "Inactive" ? "Inactive" : "Active",
    notes: body.notes !== undefined ? opt(body.notes, 500) : existing[0].notes,
    updatedAt: new Date(),
  }).where(eq(medicines.id, id)).returning();
  await audit(db, req, user, { action: "medicine_updated", module: "inventory", recordId: id, description: `Updated ${existing[0].medicineCode}`, previousValue: { name: existing[0].name, status: existing[0].status }, newValue: { name: updated[0].name, status: updated[0].status } });
  return json({ medicine: updated[0], message: "Medicine updated successfully." });
}

export async function stockReceive(req: Request, user: SessionUser) {
  await requirePerm(user, "inventory.create");
  const body = await readJson(req);
  const medicineId = Number(body.medicineId);
  const medicine = await db.select().from(medicines).where(eq(medicines.id, medicineId)).limit(1);
  if (!medicine[0]) throw new ApiError(400, "Select a medicine.");
  const quantity = wholeAmount(body.quantity, "Quantity", false);
  const expiryDate = requireDate(body.expiryDate, "Expiry date");
  const batchNumber = requireText(body.batchNumber, "Batch number", 60);
  const created = await db.transaction(async (tx) => {
    const batch = await tx.insert(medicineBatches).values({
      medicineId,
      batchNumber,
      supplierName: opt(body.supplierName, 160) || medicine[0].supplierName,
      purchaseDate: dateOrNull(body.purchaseDate, "Purchase date") || todayISO(await getSetting("timezone", "Africa/Kampala")),
      expiryDate,
      quantityReceived: quantity,
      quantityRemaining: quantity,
      unitCost: wholeAmount(body.unitCost ?? 0, "Unit cost"),
      sellingPrice: wholeAmount(body.sellingPrice ?? medicine[0].unitPrice, "Selling price"),
    }).returning();
    await tx.insert(inventoryTransactions).values({
      medicineId,
      batchId: batch[0].id,
      type: "Received",
      quantity,
      unitCost: batch[0].unitCost,
      reference: opt(body.reference, 80),
      notes: opt(body.notes, 300),
      performedBy: user.id,
    });
    await audit(tx, req, user, { action: "stock_received", module: "inventory", recordId: batch[0].id, description: `Received ${quantity} of ${medicine[0].name} batch ${batchNumber}` });
    return batch[0];
  });
  return json({ batch: created, message: "Stock received successfully." });
}

export async function stockAdjust(req: Request, user: SessionUser) {
  await requirePerm(user, "inventory.adjust");
  const body = await readJson(req);
  const type = requireText(body.type, "Transaction type", 40);
  if (!["Adjusted", "Damaged", "Expired", "Returned", "Transferred"].includes(type)) throw new ApiError(400, "That stock transaction type is not allowed.");
  const reason = requireText(body.notes, "Reason", 300);
  const batchId = Number(body.batchId);
  const quantity = wholeAmount(body.quantity, "Quantity", false);
  const signed = type === "Returned" ? quantity : -quantity;
  const updated = await db.transaction(async (tx) => {
    const batch = await tx.select().from(medicineBatches).where(eq(medicineBatches.id, batchId)).limit(1);
    if (!batch[0]) throw new ApiError(404, "Batch not found.");
    if (signed < 0 && batch[0].quantityRemaining < quantity) throw new ApiError(400, "Cannot remove more than the remaining quantity.");
    const rows = await tx.update(medicineBatches).set({
      quantityRemaining: batch[0].quantityRemaining + signed,
      quantityReceived: type === "Returned" ? batch[0].quantityReceived : batch[0].quantityReceived,
    }).where(and(eq(medicineBatches.id, batchId), sql`${medicineBatches.quantityRemaining} >= ${signed < 0 ? quantity : 0}`)).returning();
    if (!rows.length) throw new ApiError(409, "Stock changed while saving. Please retry.");
    await tx.insert(inventoryTransactions).values({
      medicineId: batch[0].medicineId,
      batchId,
      type,
      quantity: signed,
      unitCost: batch[0].unitCost,
      notes: reason,
      reference: opt(body.reference, 80),
      performedBy: user.id,
    });
    await revise(tx, "inventory", batchId, user.id, { quantityRemaining: batch[0].quantityRemaining }, { quantityRemaining: rows[0].quantityRemaining, type, reason });
    await audit(tx, req, user, { action: "stock_adjusted", module: "inventory", recordId: batchId, description: `${type} ${quantity} on batch ${batch[0].batchNumber}: ${reason}` });
    return rows[0];
  });
  return json({ batch: updated, message: "Medicine stock updated successfully." });
}

export async function stockHistory(req: Request, user: SessionUser) {
  await requirePerm(user, "inventory.view");
  const medicineId = Number(new URL(req.url).searchParams.get("medicineId") || 0);
  const rows = await db.select({
    tx: inventoryTransactions,
    medicineName: medicines.name,
    batchNumber: medicineBatches.batchNumber,
    userName: users.name,
  }).from(inventoryTransactions)
    .innerJoin(medicines, eq(inventoryTransactions.medicineId, medicines.id))
    .leftJoin(medicineBatches, eq(inventoryTransactions.batchId, medicineBatches.id))
    .leftJoin(users, eq(inventoryTransactions.performedBy, users.id))
    .where(medicineId ? eq(inventoryTransactions.medicineId, medicineId) : undefined)
    .orderBy(desc(inventoryTransactions.createdAt))
    .limit(200);
  return json({ items: rows.map((row) => ({ ...row.tx, medicineName: row.medicineName, batchNumber: row.batchNumber, userName: row.userName })) });
}

export async function patientBrief(user: SessionUser, id: string) {
  const patient = await findPatient(id);
  if (!patient) return null;
  return presentPatient(patient, user);
}
