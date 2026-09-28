import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  doctorEncounters,
  expenses,
  followUps,
  inventoryTransactions,
  invoiceItems,
  invoices,
  medicineBatches,
  medicines,
  nurseEncounters,
  patients,
  payments,
  permissions,
  prescriptions,
  prescriptionItems,
  psychologySessions,
  queueEntries,
  receipts,
  referenceItems,
  rolePermissions,
  roles,
  settings,
  suppliers,
  users,
} from "@/db/schema";
import { PERMISSIONS, ROLE_SEEDS } from "@/lib/permissions";
import { ensureSchema } from "./bootstrap";
import { defaultSlots, hashPassword, invoiceTotals, nextNumber, todayISO } from "./core";

const SEED_VERSION = "1";
let seeded: Promise<void> | null = null;

const REFERENCE: Record<string, string[]> = {
  gender: ["Female", "Male", "Other", "Prefer not to say"],
  appointment_status: ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show", "Rescheduled"],
  payment_method: ["Cash", "Mobile Money", "Bank", "Card", "Other"],
  medicine_category: ["Analgesic", "Antibiotic", "Antihypertensive", "Antidepressant", "Antipsychotic", "Vitamin", "Other"],
  service: ["Consultation", "Psychology", "Nursing", "Laboratory", "Pharmacy", "Follow-up"],
  expense_category: ["Rent", "Utilities", "Salaries", "Supplies", "Medicines Purchase", "Maintenance", "Transport", "Other"],
  department: ["Reception", "Nursing", "Consultation", "Psychology", "Pharmacy", "Accounts", "Administration"],
  specialty: ["General Practice", "Psychiatry", "Psychology", "Pediatrics", "Internal Medicine", "Nursing"],
  patient_status: ["Active", "Inactive", "Archived"],
  queue_status: ["Waiting", "Called", "In Triage", "Waiting for Doctor", "With Doctor", "Waiting for Pharmacy", "Waiting for Payment", "Completed"],
  case_type: ["New Case", "Old Case"],
  blood_group: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"],
  document_type: ["Referral letter", "Laboratory result", "Medical report", "Identification", "Prescription", "Other"],
  priority: ["Normal", "Urgent", "Emergency"],
};

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ensureSeeded() {
  if (!seeded) {
    seeded = runSeed().catch((error) => {
      seeded = null;
      throw error;
    });
  }
  return seeded;
}

async function runSeed() {
  await ensureSchema();
  const existing = await db.select().from(settings).where(eq(settings.key, "seed_version")).limit(1);
  if (existing[0]?.value === SEED_VERSION) return;

  await db.transaction(async (tx) => {
    for (const permission of PERMISSIONS) {
      await tx.insert(permissions).values(permission).onConflictDoNothing();
    }
    const permissionRows = await tx.select().from(permissions);
    const permissionByCode = new Map(permissionRows.map((row) => [row.code, row.id]));
    for (const role of ROLE_SEEDS) {
      await tx.insert(roles).values({ code: role.code, name: role.name, description: role.description, isSystem: true }).onConflictDoNothing();
    }
    const roleRows = await tx.select().from(roles);
    const roleByCode = new Map(roleRows.map((row) => [row.code, row.id]));
    for (const role of ROLE_SEEDS) {
      const roleId = roleByCode.get(role.code);
      if (!roleId) continue;
      for (const code of role.permissions) {
        const permissionId = permissionByCode.get(code);
        if (!permissionId) continue;
        await tx.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
      }
    }
    let order = 0;
    for (const [listKey, labels] of Object.entries(REFERENCE)) {
      for (const label of labels) {
        order += 1;
        await tx.insert(referenceItems).values({
          listKey,
          code: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
          label,
          sortOrder: order,
          active: true,
        }).onConflictDoNothing();
      }
    }
    const settingValues: Record<string, string> = {
      clinic_name: "SAPA Clinic",
      clinic_address: "Plot 18, Clinic Road, Kampala",
      clinic_phone: "+256 700 000 000",
      clinic_email: "reception@sapa.clinic",
      clinic_website: "",
      currency: "UGX",
      timezone: "Africa/Kampala",
      expiry_warning_days: "30",
      default_consultation_fee: "50000",
      allow_negative_balance: "false",
      allow_inactive_doctors: "false",
      min_password_length: "8",
      time_slots: JSON.stringify(defaultSlots()),
      receipt_footer: "Thank you for choosing SAPA Clinic. Please keep this receipt for your records.",
      system_type: "Clinic Management System",
      demo_banner: "true",
    };
    for (const [key, value] of Object.entries(settingValues)) {
      await tx.insert(settings).values({ key, value }).onConflictDoNothing();
    }

    const userCount = await tx.select({ id: users.id }).from(users).limit(1);
    if (!userCount.length) {
      const accounts = [
        ["ADM00001", "System Administrator", "admin", "admin@sapa.clinic", "0700000001", "SapaAdmin#2026", "administrator", "Administration", ""],
        ["REC00001", "Demo Receptionist Ruth Atim", "reception", "reception@sapa.clinic", "0700000002", "Reception#2026", "receptionist", "Reception", ""],
        ["NUR00001", "Demo Nurse Amina Nansubuga", "nurse.amina", "nurse@sapa.clinic", "0700000003", "Nurse#2026", "nurse", "Nursing", "Nursing"],
        ["DOC00001", "Demo Dr. Samuel Okello", "dr.okello", "doctor@sapa.clinic", "0700000004", "Doctor#2026", "doctor", "Consultation", "Psychiatry"],
        ["PSY00001", "Demo Psychologist Joan Nakato", "psych.nakato", "psychology@sapa.clinic", "0700000005", "Psych#2026", "psychologist", "Psychology", "Psychology"],
        ["PHA00001", "Demo Pharmacist Brian Ssemakula", "pharmacy", "pharmacy@sapa.clinic", "0700000006", "Pharmacy#2026", "pharmacist", "Pharmacy", ""],
        ["ACC00001", "Demo Accountant Helen Adong", "accounts", "accounts@sapa.clinic", "0700000007", "Accounts#2026", "accountant", "Accounts", ""],
        ["MGR00001", "Demo Manager David Mukasa", "manager", "manager@sapa.clinic", "0700000008", "Manager#2026", "manager", "Administration", ""],
        ["IT00001", "Demo IT Administrator", "it.admin", "it@sapa.clinic", "0700000009", "ItAdmin#2026", "it_admin", "Administration", ""],
      ] as const;
      const ids: Record<string, number> = {};
      for (const account of accounts) {
        const roleId = roleByCode.get(account[6]);
        if (!roleId) continue;
        const inserted = await tx.insert(users).values({
          staffCode: account[0],
          name: account[1],
          username: account[2],
          email: account[3],
          phone: account[4],
          passwordHash: await hashPassword(account[5]),
          roleId,
          department: account[7],
          specialty: account[8] || null,
          status: "active",
          isDemo: true,
        }).returning({ id: users.id });
        ids[account[6]] = inserted[0].id;
      }
      const today = todayISO();
      const supplier = await tx.insert(suppliers).values({
        name: "Demo Pharma Supplies Ltd",
        phone: "0701230000",
        email: "orders@demopharma.example",
        address: "Industrial Area, Kampala",
      }).returning({ id: suppliers.id });
      const demoPatients = [
        ["Demo Patient Amina Okello", "1992-04-12", "Female", "0700111222", "0755000111", "Ntinda, Kampala", "Sister", "Mary Okello", "Sister", "0702223333", "New Case", ["Consultation", "Psychology"], "O+", "Penicillin", "Seasonal asthma. Demonstration record only."],
        ["Demo Patient Peter Mugisha", "1984-11-02", "Male", "0755333444", "", "Entebbe Road", "Spouse", "Lydia Mugisha", "Spouse", "0755333000", "Old Case", ["Consultation"], "A+", "None known", "Hypertension follow-up. Demonstration record only."],
        ["Demo Patient Sarah Namuli", "2016-06-20", "Female", "0777000111", "", "Kawempe", "Mother", "Joyce Namuli", "Mother", "0777000222", "New Case", ["Consultation", "Nursing"], "B+", "None known", "Demonstration paediatric record. Not a real child."],
        ["Demo Patient James Kato", "1975-01-30", "Male", "0709888777", "0709888000", "Jinja Road", "Brother", "Tom Kato", "Brother", "0709888111", "Old Case", ["Psychology"], "O-", "Sulfa drugs", "Demonstration mental health follow-up."],
        ["Demo Patient Grace Akello", "1998-09-09", "Female", "0788123456", "", "Bugolobi", "Friend", "Rita Akello", "Friend", "0788000001", "New Case", ["Consultation", "Laboratory"], "AB+", "None known", "Demonstration record only."],
        ["Demo Patient Daniel Ochieng", "1968-12-15", "Male", "0704455667", "", "Mukono", "Spouse", "Eva Ochieng", "Spouse", "0704455000", "Old Case", ["Pharmacy"], "B-", "None known", "Demonstration record only."],
      ] as const;
      const patientIds: number[] = [];
      for (const item of demoPatients) {
        const number = await nextNumber(tx, "patient", "PAT");
        const inserted = await tx.insert(patients).values({
          patientNumber: number,
          registrationDate: addDays(today, -10),
          fullName: item[0],
          dateOfBirth: item[1],
          gender: item[2],
          phone: item[3],
          phoneDigits: item[3],
          otherPhone: item[4] || null,
          otherPhoneDigits: item[4] || null,
          address: item[5],
          emergencyContact: item[10] === "New Case" ? item[8] : item[7],
          nokName: item[7],
          nokRelationship: item[8],
          nokPhone: item[9],
          nokPhoneDigits: item[9],
          caseType: item[10],
          services: [...item[11]],
          bloodGroup: item[12],
          allergies: item[13],
          medicalHistory: item[14],
          status: "Active",
          nextAppointment: item[0].includes("Amina") ? addDays(today, 7) : null,
          notes: "Demonstration record. Not a real patient.",
          isDemo: true,
          createdBy: ids.receptionist,
        }).returning({ id: patients.id });
        patientIds.push(inserted[0].id);
      }
      const appointmentSeeds = [
        [0, "09:00", "Scheduled", "Review of sleep and mood"],
        [1, "09:30", "Confirmed", "Blood pressure review"],
        [2, "10:00", "Scheduled", "Fever and cough"],
        [4, "11:00", "Completed", "General consultation"],
      ] as const;
      const appointmentIds: number[] = [];
      for (const item of appointmentSeeds) {
        const number = await nextNumber(tx, "appointment", "APT");
        const inserted = await tx.insert(appointments).values({
          appointmentNumber: number,
          patientId: patientIds[item[0]],
          doctorId: ids.doctor,
          appointmentDate: today,
          appointmentTime: item[1],
          reason: item[3],
          status: item[2],
          notes: "Demonstration appointment.",
          isDemo: true,
          createdBy: ids.receptionist,
        }).returning({ id: appointments.id });
        appointmentIds.push(inserted[0].id);
      }
      const queueNumber = `Q-${today.replace(/-/g, "")}-001`;
      await tx.insert(queueEntries).values([
        { queueNumber, patientId: patientIds[0], appointmentId: appointmentIds[0], service: "Consultation", department: "Nursing", status: "Waiting", priority: "Normal", createdBy: ids.receptionist },
        { queueNumber: `Q-${today.replace(/-/g, "")}-002`, patientId: patientIds[1], appointmentId: appointmentIds[1], service: "Consultation", department: "Consultation", status: "Waiting for Doctor", priority: "Urgent", createdBy: ids.receptionist },
      ]);
      const nurseNumber = await nextNumber(tx, "nurse", "NUR");
      await tx.insert(nurseEncounters).values({
        encounterNumber: nurseNumber,
        patientId: patientIds[4],
        nurseId: ids.nurse,
        appointmentId: appointmentIds[3],
        allergies: "None known",
        bloodPressure: "118/76",
        weightKg: "62.00",
        heightCm: "165.00",
        pulseRate: 78,
        spo2: 98,
        temperatureC: "36.7",
        respiratoryRate: 16,
        bmi: "22.77",
        medications: "None",
        symptoms: "Mild headache for two days. Demonstration note.",
        assessment: "Stable for clinician review.",
        status: "Completed",
      });
      const encounterNumber = await nextNumber(tx, "encounter", "ENC");
      const encounter = await tx.insert(doctorEncounters).values({
        encounterNumber,
        patientId: patientIds[4],
        doctorId: ids.doctor,
        appointmentId: appointmentIds[3],
        presentingComplaints: "Headache and poor sleep.",
        historyOfPresentingComplaints: "Two days, no vomiting. Demonstration note.",
        pastPsychiatricHistory: "None reported.",
        pastMedicalSurgicalHistory: "No surgery.",
        familyHistory: "Mother has hypertension.",
        socialPersonalHistory: "Works in an office. Non-smoker.",
        medicalHistory: "No chronic medicine.",
        currentSituation: "Able to work. Sleep reduced.",
        examination: "Alert. No focal neurological sign recorded in this demonstration note.",
        investigation: "No laboratory test ordered.",
        diagnosis: "Tension-type headache — demonstration diagnosis",
        treatment: "Rest, hydration, and simple analgesia.",
        referral: "",
        followUpDate: addDays(today, 14),
        comments: "Demonstration consultation. Not a real clinical decision.",
        status: "Completed",
      }).returning({ id: doctorEncounters.id });
      await tx.insert(followUps).values({
        patientId: patientIds[4],
        source: "doctor",
        sourceId: encounter[0].id,
        dueDate: addDays(today, 14),
        reason: "Review headache",
        createdBy: ids.doctor,
      });
      const rxNumber = await nextNumber(tx, "prescription", "RX");
      const rx = await tx.insert(prescriptions).values({
        prescriptionNumber: rxNumber,
        patientId: patientIds[4],
        clinicianId: ids.doctor,
        encounterId: encounter[0].id,
        notes: "Demonstration prescription.",
        status: "Active",
      }).returning({ id: prescriptions.id });
      const sessionNumber = await nextNumber(tx, "psychology", "PSY");
      await tx.insert(psychologySessions).values({
        sessionNumber,
        patientId: patientIds[3],
        psychologistId: ids.psychologist,
        sessionDate: addDays(today, -2),
        sessionType: "Individual",
        diagnosis: "Adjustment difficulties — demonstration only",
        treatment: "Supportive counselling",
        assessment: "Engaged in session. Demonstration note.",
        progress: "First session completed.",
        notes: "This is fictional training data, not a real psychology record.",
        followUpDate: addDays(today, 5),
        status: "Completed",
      });
      const meds = [
        ["Paracetamol 500mg", "Analgesic", 20, 500, 100, addDays(today, 400), "PARA-DEMO-1"],
        ["Amoxicillin 250mg", "Antibiotic", 15, 1200, 40, addDays(today, 12), "AMOX-DEMO-1"],
        ["Vitamin C 100mg", "Vitamin", 30, 300, 8, addDays(today, 200), "VITC-DEMO-1"],
        ["Ibuprofen 200mg", "Analgesic", 10, 400, 0, addDays(today, 300), "IBU-DEMO-1"],
        ["Demo Cough Syrup", "Other", 5, 2500, 6, addDays(today, -1), "COUGH-DEMO-1"],
      ] as const;
      const medicineIds: number[] = [];
      for (const med of meds) {
        const code = await nextNumber(tx, "medicine", "MED");
        const inserted = await tx.insert(medicines).values({
          medicineCode: code,
          name: med[0],
          category: med[1],
          supplierId: supplier[0].id,
          supplierName: "Demo Pharma Supplies Ltd",
          reorderLevel: med[2],
          unitPrice: med[3],
          status: "Active",
          isDemo: true,
          notes: "Demonstration stock. Not a real medicine batch.",
        }).returning({ id: medicines.id });
        medicineIds.push(inserted[0].id);
        if (med[5]) {
          const batch = await tx.insert(medicineBatches).values({
            medicineId: inserted[0].id,
            batchNumber: med[6],
            supplierId: supplier[0].id,
            supplierName: "Demo Pharma Supplies Ltd",
            purchaseDate: addDays(today, -20),
            expiryDate: med[5],
            quantityReceived: med[4],
            quantityRemaining: med[4],
            unitCost: Math.round(med[3] * 0.6),
            sellingPrice: med[3],
          }).returning({ id: medicineBatches.id });
          if (med[4] > 0) {
            await tx.insert(inventoryTransactions).values({
              medicineId: inserted[0].id,
              batchId: batch[0].id,
              type: "Received",
              quantity: med[4],
              unitCost: Math.round(med[3] * 0.6),
              reference: "DEMO-GRN",
              notes: "Opening demonstration stock",
              performedBy: ids.pharmacist,
            });
          }
        }
      }
      await tx.insert(prescriptionItems).values({
        prescriptionId: rx[0].id,
        medicineId: medicineIds[0],
        medicineName: "Paracetamol 500mg",
        dose: "500mg",
        frequency: "Every 8 hours",
        route: "Oral",
        duration: "3 days",
        quantity: 9,
        instructions: "Take after food. Demonstration prescription.",
      });
      const totals = invoiceTotals({ consultationFee: 50000, medicineCost: 15000, laboratoryCharges: 0, otherCharges: 0, discount: 5000, amountPaid: 40000 });
      const invoiceNumber = await nextNumber(tx, "invoice", "INV");
      const invoice = await tx.insert(invoices).values({
        invoiceNumber,
        patientId: patientIds[4],
        doctorId: ids.doctor,
        invoiceDate: today,
        consultationFee: 50000,
        medicineCost: 15000,
        laboratoryCharges: 0,
        otherCharges: 0,
        discount: 5000,
        totalAmount: totals.totalAmount,
        amountPaid: 40000,
        balance: totals.balance,
        status: totals.status,
        notes: "Demonstration invoice.",
        snapshotPatientName: "Demo Patient Grace Akello",
        snapshotPatientNumber: "PAT00005",
        isDemo: true,
        createdBy: ids.accountant,
      }).returning({ id: invoices.id });
      await tx.insert(invoiceItems).values([
        { invoiceId: invoice[0].id, description: "Consultation", category: "Consultation", quantity: 1, unitPrice: 50000, amount: 50000 },
        { invoiceId: invoice[0].id, description: "Paracetamol 500mg", category: "Medicine", quantity: 30, unitPrice: 500, amount: 15000 },
        { invoiceId: invoice[0].id, description: "Courtesy discount", category: "Discount", quantity: 1, unitPrice: 5000, amount: 5000 },
      ]);
      const paymentNumber = await nextNumber(tx, "payment", "PAY");
      const payment = await tx.insert(payments).values({
        paymentNumber,
        invoiceId: invoice[0].id,
        patientId: patientIds[4],
        amount: 40000,
        method: "Cash",
        status: "Completed",
        receivedBy: ids.receptionist,
        notes: "Demonstration part payment",
      }).returning({ id: payments.id });
      const receiptNumber = await nextNumber(tx, "receipt", "RCT");
      await tx.insert(receipts).values({
        receiptNumber,
        paymentId: payment[0].id,
        invoiceId: invoice[0].id,
        patientId: patientIds[4],
        amount: 40000,
        method: "Cash",
        receivedBy: ids.receptionist,
        receivedByName: "Demo Receptionist Ruth Atim",
        notes: "Demonstration receipt",
        snapshotPatientName: "Demo Patient Grace Akello",
        snapshotPatientNumber: "PAT00005",
        snapshotInvoiceNumber: invoiceNumber,
        balanceAfter: 20000,
      });
      const unpaidNumber = await nextNumber(tx, "invoice", "INV");
      const unpaidTotals = invoiceTotals({ consultationFee: 30000, medicineCost: 0, laboratoryCharges: 0, otherCharges: 0, discount: 0 });
      await tx.insert(invoices).values({
        invoiceNumber: unpaidNumber,
        patientId: patientIds[1],
        doctorId: ids.doctor,
        invoiceDate: today,
        consultationFee: 30000,
        totalAmount: unpaidTotals.totalAmount,
        amountPaid: 0,
        balance: unpaidTotals.balance,
        status: unpaidTotals.status,
        snapshotPatientName: "Demo Patient Peter Mugisha",
        snapshotPatientNumber: "PAT00002",
        isDemo: true,
        createdBy: ids.receptionist,
        notes: "Demonstration unpaid invoice.",
      });
      await tx.insert(expenses).values([
        { expenseNumber: await nextNumber(tx, "expense", "EXP"), expenseDate: today, category: "Supplies", description: "Demonstration clinic supplies", amount: 120000, paymentMethod: "Cash", payee: "Demo Stationery", enteredBy: ids.accountant, isDemo: true, notes: "Demonstration expense." },
        { expenseNumber: await nextNumber(tx, "expense", "EXP"), expenseDate: addDays(today, -3), category: "Utilities", description: "Demonstration utility bill", amount: 250000, paymentMethod: "Bank", payee: "Demo Power", enteredBy: ids.accountant, isDemo: true, notes: "Demonstration expense." },
      ]);
    }
    await tx.insert(settings).values({ key: "seed_version", value: SEED_VERSION }).onConflictDoUpdate({
      target: settings.key,
      set: { value: SEED_VERSION, updatedAt: new Date() },
    });
  });
}
