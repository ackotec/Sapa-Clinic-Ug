import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const sequences = pgTable("sequences", {
  name: text("name").primaryKey(),
  nextValue: integer("next_value").notNull().default(1),
});

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("roles_code_uq").on(t.code)]);

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  module: text("module").notNull(),
  description: text("description"),
}, (t) => [uniqueIndex("permissions_code_uq").on(t.code)]);

export const rolePermissions = pgTable("role_permissions", {
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: integer("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  staffCode: text("staff_code").notNull(),
  name: text("name").notNull(),
  username: text("username").notNull(),
  email: text("email"),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  roleId: integer("role_id").notNull().references(() => roles.id),
  department: text("department"),
  specialty: text("specialty"),
  status: text("status").notNull().default("active"),
  lastLogin: ts("last_login"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  sessionVersion: integer("session_version").notNull().default(1),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
}, (t) => [
  uniqueIndex("users_staff_code_uq").on(t.staffCode),
  uniqueIndex("users_username_uq").on(t.username),
  index("users_role_idx").on(t.roleId),
]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by"),
});

export const referenceItems = pgTable("reference_items", {
  id: serial("id").primaryKey(),
  listKey: text("list_key").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
}, (t) => [uniqueIndex("reference_list_code_uq").on(t.listKey, t.code), index("reference_list_idx").on(t.listKey)]);

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  status: text("status").notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  patientNumber: text("patient_number").notNull(),
  registrationDate: date("registration_date").notNull(),
  fullName: text("full_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  phone: text("phone"),
  phoneDigits: text("phone_digits"),
  otherPhone: text("other_phone"),
  otherPhoneDigits: text("other_phone_digits"),
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  nokName: text("nok_name"),
  nokRelationship: text("nok_relationship"),
  nokPhone: text("nok_phone"),
  nokPhoneDigits: text("nok_phone_digits"),
  nokOtherPhone: text("nok_other_phone"),
  caseType: text("case_type"),
  services: jsonb("services").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  bloodGroup: text("blood_group"),
  allergies: text("allergies"),
  medicalHistory: text("medical_history"),
  status: text("status").notNull().default("Active"),
  nextAppointment: date("next_appointment"),
  notes: text("notes"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  archivedAt: ts("archived_at"),
}, (t) => [
  uniqueIndex("patients_number_uq").on(t.patientNumber),
  index("patients_name_idx").on(t.fullName),
  index("patients_phone_idx").on(t.phoneDigits),
  index("patients_status_idx").on(t.status),
]);

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  appointmentNumber: text("appointment_number").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  doctorId: integer("doctor_id").notNull().references(() => users.id),
  appointmentDate: date("appointment_date").notNull(),
  appointmentTime: text("appointment_time").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("Scheduled"),
  notes: text("notes"),
  cancelReason: text("cancel_reason"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
}, (t) => [
  uniqueIndex("appointments_number_uq").on(t.appointmentNumber),
  index("appointments_date_idx").on(t.appointmentDate),
  index("appointments_doctor_idx").on(t.doctorId, t.appointmentDate),
  index("appointments_patient_idx").on(t.patientId),
]);

export const queueEntries = pgTable("queue_entries", {
  id: serial("id").primaryKey(),
  queueNumber: text("queue_number").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  service: text("service"),
  department: text("department").notNull().default("Reception"),
  status: text("status").notNull().default("Waiting"),
  priority: text("priority").notNull().default("Normal"),
  arrivalTime: ts("arrival_time").notNull().defaultNow(),
  calledAt: ts("called_at"),
  completedAt: ts("completed_at"),
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("queue_status_idx").on(t.status), index("queue_patient_idx").on(t.patientId)]);

export const nurseEncounters = pgTable("nurse_encounters", {
  id: serial("id").primaryKey(),
  encounterNumber: text("encounter_number").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  nurseId: integer("nurse_id").references(() => users.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  allergies: text("allergies"),
  bloodPressure: text("blood_pressure"),
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
  heightCm: numeric("height_cm", { precision: 6, scale: 2 }),
  pulseRate: integer("pulse_rate"),
  spo2: integer("spo2"),
  temperatureC: numeric("temperature_c", { precision: 4, scale: 1 }),
  respiratoryRate: integer("respiratory_rate"),
  bmi: numeric("bmi", { precision: 5, scale: 2 }),
  medications: text("medications"),
  symptoms: text("symptoms"),
  assessment: text("assessment"),
  notes: text("notes"),
  status: text("status").notNull().default("Completed"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("nurse_number_uq").on(t.encounterNumber), index("nurse_patient_idx").on(t.patientId)]);

export const doctorEncounters = pgTable("doctor_encounters", {
  id: serial("id").primaryKey(),
  encounterNumber: text("encounter_number").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  doctorId: integer("doctor_id").references(() => users.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  presentingComplaints: text("presenting_complaints"),
  historyOfPresentingComplaints: text("history_of_presenting_complaints"),
  pastPsychiatricHistory: text("past_psychiatric_history"),
  pastMedicalSurgicalHistory: text("past_medical_surgical_history"),
  familyHistory: text("family_history"),
  socialPersonalHistory: text("social_personal_history"),
  medicalHistory: text("medical_history"),
  currentSituation: text("current_situation"),
  examination: text("examination"),
  investigation: text("investigation"),
  diagnosis: text("diagnosis"),
  treatment: text("treatment"),
  prescriptionNotes: text("prescription_notes"),
  referral: text("referral"),
  followUpDate: date("follow_up_date"),
  comments: text("comments"),
  status: text("status").notNull().default("Completed"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
}, (t) => [uniqueIndex("doctor_number_uq").on(t.encounterNumber), index("doctor_patient_idx").on(t.patientId)]);

export const diagnoses = pgTable("diagnoses", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  encounterId: integer("encounter_id").references(() => doctorEncounters.id),
  sessionId: integer("session_id"),
  description: text("description").notNull(),
  diagnosisType: text("diagnosis_type").notNull().default("Primary"),
  status: text("status").notNull().default("Active"),
  recordedBy: integer("recorded_by"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
}, (t) => [index("diagnoses_patient_idx").on(t.patientId)]);

export const investigations = pgTable("investigations", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  encounterId: integer("encounter_id").references(() => doctorEncounters.id),
  name: text("name").notNull(),
  result: text("result"),
  status: text("status").notNull().default("Ordered"),
  orderedBy: integer("ordered_by"),
  orderedAt: ts("ordered_at").notNull().defaultNow(),
  notes: text("notes"),
});

export const followUps = pgTable("follow_ups", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  source: text("source").notNull(),
  sourceId: integer("source_id"),
  dueDate: date("due_date").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("Open"),
  createdBy: integer("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("followups_due_idx").on(t.dueDate, t.status)]);

export const psychologySessions = pgTable("psychology_sessions", {
  id: serial("id").primaryKey(),
  sessionNumber: text("session_number").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  psychologistId: integer("psychologist_id").references(() => users.id),
  linkedEncounterId: integer("linked_encounter_id").references(() => doctorEncounters.id),
  sessionDate: date("session_date").notNull(),
  sessionType: text("session_type"),
  diagnosis: text("diagnosis"),
  treatment: text("treatment"),
  assessment: text("assessment"),
  progress: text("progress"),
  notes: text("notes"),
  followUpDate: date("follow_up_date"),
  status: text("status").notNull().default("Completed"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
}, (t) => [uniqueIndex("psych_number_uq").on(t.sessionNumber), index("psych_patient_idx").on(t.patientId)]);

export const medicines = pgTable("medicines", {
  id: serial("id").primaryKey(),
  medicineCode: text("medicine_code").notNull(),
  name: text("name").notNull(),
  category: text("category"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  supplierName: text("supplier_name"),
  unit: text("unit").notNull().default("tablet"),
  reorderLevel: integer("reorder_level").notNull().default(0),
  unitPrice: integer("unit_price").notNull().default(0),
  status: text("status").notNull().default("Active"),
  notes: text("notes"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("medicines_code_uq").on(t.medicineCode), index("medicines_name_idx").on(t.name)]);

export const medicineBatches = pgTable("medicine_batches", {
  id: serial("id").primaryKey(),
  medicineId: integer("medicine_id").notNull().references(() => medicines.id),
  batchNumber: text("batch_number").notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  supplierName: text("supplier_name"),
  purchaseDate: date("purchase_date"),
  expiryDate: date("expiry_date").notNull(),
  quantityReceived: integer("quantity_received").notNull().default(0),
  quantityRemaining: integer("quantity_remaining").notNull().default(0),
  unitCost: integer("unit_cost").notNull().default(0),
  sellingPrice: integer("selling_price").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("batches_medicine_idx").on(t.medicineId), index("batches_expiry_idx").on(t.expiryDate)]);

export const prescriptions = pgTable("prescriptions", {
  id: serial("id").primaryKey(),
  prescriptionNumber: text("prescription_number").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  clinicianId: integer("clinician_id").references(() => users.id),
  encounterId: integer("encounter_id").references(() => doctorEncounters.id),
  sessionId: integer("session_id").references(() => psychologySessions.id),
  prescribedAt: ts("prescribed_at").notNull().defaultNow(),
  status: text("status").notNull().default("Active"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("rx_number_uq").on(t.prescriptionNumber), index("rx_patient_idx").on(t.patientId)]);

export const prescriptionItems = pgTable("prescription_items", {
  id: serial("id").primaryKey(),
  prescriptionId: integer("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  medicineId: integer("medicine_id").references(() => medicines.id),
  medicineName: text("medicine_name").notNull(),
  dose: text("dose"),
  frequency: text("frequency"),
  route: text("route"),
  duration: text("duration"),
  quantity: integer("quantity").notNull().default(0),
  instructions: text("instructions"),
  dispensedQty: integer("dispensed_qty").notNull().default(0),
});

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  medicineId: integer("medicine_id").notNull().references(() => medicines.id),
  batchId: integer("batch_id").references(() => medicineBatches.id),
  type: text("type").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost"),
  reference: text("reference"),
  patientId: integer("patient_id").references(() => patients.id),
  prescriptionItemId: integer("prescription_item_id").references(() => prescriptionItems.id),
  notes: text("notes"),
  performedBy: integer("performed_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("stock_medicine_idx").on(t.medicineId), index("stock_created_idx").on(t.createdAt)]);

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  doctorId: integer("doctor_id").references(() => users.id),
  invoiceDate: date("invoice_date").notNull(),
  consultationFee: integer("consultation_fee").notNull().default(0),
  medicineCost: integer("medicine_cost").notNull().default(0),
  laboratoryCharges: integer("laboratory_charges").notNull().default(0),
  otherCharges: integer("other_charges").notNull().default(0),
  discount: integer("discount").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  amountPaid: integer("amount_paid").notNull().default(0),
  balance: integer("balance").notNull().default(0),
  status: text("status").notNull().default("Unpaid"),
  notes: text("notes"),
  voidReason: text("void_reason"),
  snapshotPatientName: text("snapshot_patient_name"),
  snapshotPatientNumber: text("snapshot_patient_number"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
}, (t) => [
  uniqueIndex("invoices_number_uq").on(t.invoiceNumber),
  index("invoices_patient_idx").on(t.patientId),
  index("invoices_date_idx").on(t.invoiceDate),
  index("invoices_status_idx").on(t.status),
]);

export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: text("category").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: integer("unit_price").notNull().default(0),
  amount: integer("amount").notNull().default(0),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentNumber: text("payment_number").notNull(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  amount: integer("amount").notNull(),
  method: text("method").notNull(),
  status: text("status").notNull().default("Completed"),
  receivedBy: integer("received_by"),
  notes: text("notes"),
  reversalReason: text("reversal_reason"),
  reversedAt: ts("reversed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("payments_number_uq").on(t.paymentNumber), index("payments_invoice_idx").on(t.invoiceId)]);

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  receiptNumber: text("receipt_number").notNull(),
  paymentId: integer("payment_id").notNull().references(() => payments.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  receiptDate: ts("receipt_date").notNull().defaultNow(),
  amount: integer("amount").notNull(),
  method: text("method").notNull(),
  receivedBy: integer("received_by"),
  receivedByName: text("received_by_name"),
  notes: text("notes"),
  status: text("status").notNull().default("Issued"),
  voidReason: text("void_reason"),
  snapshotPatientName: text("snapshot_patient_name"),
  snapshotPatientNumber: text("snapshot_patient_number"),
  snapshotInvoiceNumber: text("snapshot_invoice_number"),
  balanceAfter: integer("balance_after").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("receipts_number_uq").on(t.receiptNumber), uniqueIndex("receipts_payment_uq").on(t.paymentId)]);

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseNumber: text("expense_number").notNull(),
  expenseDate: date("expense_date").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  paymentMethod: text("payment_method"),
  payee: text("payee"),
  reference: text("reference"),
  enteredBy: integer("entered_by"),
  notes: text("notes"),
  status: text("status").notNull().default("Recorded"),
  voidReason: text("void_reason"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("expenses_number_uq").on(t.expenseNumber), index("expenses_date_idx").on(t.expenseDate)]);

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("Other"),
  description: text("description"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull().default(0),
  fileData: text("file_data").notNull(),
  uploadedBy: integer("uploaded_by"),
  status: text("status").notNull().default("Active"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("documents_patient_idx").on(t.patientId)]);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  roleCode: text("role_code"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull(),
  link: text("link"),
  dedupeKey: text("dedupe_key"),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey), index("notifications_user_idx").on(t.userId)]);

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  userId: integer("user_id"),
  userName: text("user_name"),
  role: text("role"),
  action: text("action").notNull(),
  module: text("module").notNull(),
  recordId: text("record_id"),
  ip: text("ip"),
  description: text("description"),
  previousValue: jsonb("previous_value").$type<unknown>(),
  newValue: jsonb("new_value").$type<unknown>(),
}, (t) => [index("audit_created_idx").on(t.createdAt), index("audit_module_idx").on(t.module), index("audit_user_idx").on(t.userId)]);

export const recordRevisions = pgTable("record_revisions", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(),
  recordId: text("record_id").notNull(),
  userId: integer("user_id"),
  previousValue: jsonb("previous_value").$type<unknown>(),
  newValue: jsonb("new_value").$type<unknown>(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("revisions_record_idx").on(t.module, t.recordId)]);

export const accessOverrides = pgTable("access_overrides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  module: text("module").notNull(),
  recordId: text("record_id"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
