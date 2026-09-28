import { pool } from "@/db";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sequences (
  name text PRIMARY KEY,
  next_value integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS roles (
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_code_uq ON roles (code);
CREATE TABLE IF NOT EXISTS permissions (
  id serial PRIMARY KEY,
  code text NOT NULL,
  module text NOT NULL,
  description text
);
CREATE UNIQUE INDEX IF NOT EXISTS permissions_code_uq ON permissions (code);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id integer NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  staff_code text NOT NULL,
  name text NOT NULL,
  username text NOT NULL,
  email text,
  phone text,
  password_hash text NOT NULL,
  role_id integer NOT NULL REFERENCES roles(id),
  department text,
  specialty text,
  status text NOT NULL DEFAULT 'active',
  last_login timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  session_version integer NOT NULL DEFAULT 1,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS users_staff_code_uq ON users (staff_code);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role_id);
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);
CREATE TABLE IF NOT EXISTS reference_items (
  id serial PRIMARY KEY,
  list_key text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS reference_list_code_uq ON reference_items (list_key, code);
CREATE INDEX IF NOT EXISTS reference_list_idx ON reference_items (list_key);
CREATE TABLE IF NOT EXISTS suppliers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS patients (
  id serial PRIMARY KEY,
  patient_number text NOT NULL,
  registration_date date NOT NULL,
  full_name text NOT NULL,
  date_of_birth date,
  gender text,
  phone text,
  phone_digits text,
  other_phone text,
  other_phone_digits text,
  address text,
  emergency_contact text,
  nok_name text,
  nok_relationship text,
  nok_phone text,
  nok_phone_digits text,
  nok_other_phone text,
  case_type text,
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  blood_group text,
  allergies text,
  medical_history text,
  status text NOT NULL DEFAULT 'Active',
  next_appointment date,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS patients_number_uq ON patients (patient_number);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (full_name);
CREATE INDEX IF NOT EXISTS patients_phone_idx ON patients (phone_digits);
CREATE INDEX IF NOT EXISTS patients_status_idx ON patients (status);
CREATE TABLE IF NOT EXISTS appointments (
  id serial PRIMARY KEY,
  appointment_number text NOT NULL,
  patient_id integer NOT NULL REFERENCES patients(id),
  doctor_id integer NOT NULL REFERENCES users(id),
  appointment_date date NOT NULL,
  appointment_time text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'Scheduled',
  notes text,
  cancel_reason text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_number_uq ON appointments (appointment_number);
CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments (appointment_date);
CREATE INDEX IF NOT EXISTS appointments_doctor_idx ON appointments (doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);
CREATE TABLE IF NOT EXISTS queue_entries (
  id serial PRIMARY KEY,
  queue_number text NOT NULL,
  patient_id integer NOT NULL REFERENCES patients(id),
  appointment_id integer REFERENCES appointments(id),
  service text,
  department text NOT NULL DEFAULT 'Reception',
  status text NOT NULL DEFAULT 'Waiting',
  priority text NOT NULL DEFAULT 'Normal',
  arrival_time timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_status_idx ON queue_entries (status);
CREATE INDEX IF NOT EXISTS queue_patient_idx ON queue_entries (patient_id);
CREATE TABLE IF NOT EXISTS nurse_encounters (
  id serial PRIMARY KEY,
  encounter_number text NOT NULL,
  patient_id integer NOT NULL REFERENCES patients(id),
  nurse_id integer REFERENCES users(id),
  appointment_id integer REFERENCES appointments(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  allergies text,
  blood_pressure text,
  weight_kg numeric(6,2),
  height_cm numeric(6,2),
  pulse_rate integer,
  spo2 integer,
  temperature_c numeric(4,1),
  respiratory_rate integer,
  bmi numeric(5,2),
  medications text,
  symptoms text,
  assessment text,
  notes text,
  status text NOT NULL DEFAULT 'Completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS nurse_number_uq ON nurse_encounters (encounter_number);
CREATE INDEX IF NOT EXISTS nurse_patient_idx ON nurse_encounters (patient_id);
CREATE TABLE IF NOT EXISTS doctor_encounters (
  id serial PRIMARY KEY,
  encounter_number text NOT NULL,
  patient_id integer NOT NULL REFERENCES patients(id),
  doctor_id integer REFERENCES users(id),
  appointment_id integer REFERENCES appointments(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  presenting_complaints text,
  history_of_presenting_complaints text,
  past_psychiatric_history text,
  past_medical_surgical_history text,
  family_history text,
  social_personal_history text,
  medical_history text,
  current_situation text,
  examination text,
  investigation text,
  diagnosis text,
  treatment text,
  prescription_notes text,
  referral text,
  follow_up_date date,
  comments text,
  status text NOT NULL DEFAULT 'Completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS doctor_number_uq ON doctor_encounters (encounter_number);
CREATE INDEX IF NOT EXISTS doctor_patient_idx ON doctor_encounters (patient_id);
CREATE TABLE IF NOT EXISTS diagnoses (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id),
  encounter_id integer REFERENCES doctor_encounters(id),
  session_id integer,
  description text NOT NULL,
  diagnosis_type text NOT NULL DEFAULT 'Primary',
  status text NOT NULL DEFAULT 'Active',
  recorded_by integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diagnoses_patient_idx ON diagnoses (patient_id);
CREATE TABLE IF NOT EXISTS investigations (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id),
  encounter_id integer REFERENCES doctor_encounters(id),
  name text NOT NULL,
  result text,
  status text NOT NULL DEFAULT 'Ordered',
  ordered_by integer,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE TABLE IF NOT EXISTS follow_ups (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id),
  source text NOT NULL,
  source_id integer,
  due_date date NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'Open',
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followups_due_idx ON follow_ups (due_date, status);
CREATE TABLE IF NOT EXISTS psychology_sessions (
  id serial PRIMARY KEY,
  session_number text NOT NULL,
  patient_id integer NOT NULL REFERENCES patients(id),
  psychologist_id integer REFERENCES users(id),
  linked_encounter_id integer REFERENCES doctor_encounters(id),
  session_date date NOT NULL,
  session_type text,
  diagnosis text,
  treatment text,
  assessment text,
  progress text,
  notes text,
  follow_up_date date,
  status text NOT NULL DEFAULT 'Completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS psych_number_uq ON psychology_sessions (session_number);
CREATE INDEX IF NOT EXISTS psych_patient_idx ON psychology_sessions (patient_id);
CREATE TABLE IF NOT EXISTS medicines (
  id serial PRIMARY KEY,
  medicine_code text NOT NULL,
  name text NOT NULL,
  category text,
  supplier_id integer REFERENCES suppliers(id),
  supplier_name text,
  unit text NOT NULL DEFAULT 'tablet',
  reorder_level integer NOT NULL DEFAULT 0,
  unit_price integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Active',
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS medicines_code_uq ON medicines (medicine_code);
CREATE INDEX IF NOT EXISTS medicines_name_idx ON medicines (name);
CREATE TABLE IF NOT EXISTS medicine_batches (
  id serial PRIMARY KEY,
  medicine_id integer NOT NULL REFERENCES medicines(id),
  batch_number text NOT NULL,
  supplier_id integer REFERENCES suppliers(id),
  supplier_name text,
  purchase_date date,
  expiry_date date NOT NULL,
  quantity_received integer NOT NULL DEFAULT 0,
  quantity_remaining integer NOT NULL DEFAULT 0,
  unit_cost integer NOT NULL DEFAULT 0,
  selling_price integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batches_medicine_idx ON medicine_batches (medicine_id);
CREATE INDEX IF NOT EXISTS batches_expiry_idx ON medicine_batches (expiry_date);
CREATE TABLE IF NOT EXISTS prescriptions (
  id serial PRIMARY KEY,
  prescription_number text NOT NULL,
  patient_id integer NOT NULL REFERENCES patients(id),
  clinician_id integer REFERENCES users(id),
  encounter_id integer REFERENCES doctor_encounters(id),
  session_id integer REFERENCES psychology_sessions(id),
  prescribed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'Active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rx_number_uq ON prescriptions (prescription_number);
CREATE INDEX IF NOT EXISTS rx_patient_idx ON prescriptions (patient_id);
CREATE TABLE IF NOT EXISTS prescription_items (
  id serial PRIMARY KEY,
  prescription_id integer NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id integer REFERENCES medicines(id),
  medicine_name text NOT NULL,
  dose text,
  frequency text,
  route text,
  duration text,
  quantity integer NOT NULL DEFAULT 0,
  instructions text,
  dispensed_qty integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id serial PRIMARY KEY,
  medicine_id integer NOT NULL REFERENCES medicines(id),
  batch_id integer REFERENCES medicine_batches(id),
  type text NOT NULL,
  quantity integer NOT NULL,
  unit_cost integer,
  reference text,
  patient_id integer REFERENCES patients(id),
  prescription_item_id integer REFERENCES prescription_items(id),
  notes text,
  performed_by integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_medicine_idx ON inventory_transactions (medicine_id);
CREATE INDEX IF NOT EXISTS stock_created_idx ON inventory_transactions (created_at);
CREATE TABLE IF NOT EXISTS invoices (
  id serial PRIMARY KEY,
  invoice_number text NOT NULL,
  patient_id integer NOT NULL REFERENCES patients(id),
  doctor_id integer REFERENCES users(id),
  invoice_date date NOT NULL,
  consultation_fee integer NOT NULL DEFAULT 0,
  medicine_cost integer NOT NULL DEFAULT 0,
  laboratory_charges integer NOT NULL DEFAULT 0,
  other_charges integer NOT NULL DEFAULT 0,
  discount integer NOT NULL DEFAULT 0,
  total_amount integer NOT NULL DEFAULT 0,
  amount_paid integer NOT NULL DEFAULT 0,
  balance integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Unpaid',
  notes text,
  void_reason text,
  snapshot_patient_name text,
  snapshot_patient_number text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_uq ON invoices (invoice_number);
CREATE INDEX IF NOT EXISTS invoices_patient_idx ON invoices (patient_id);
CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices (invoice_date);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status);
CREATE TABLE IF NOT EXISTS invoice_items (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  category text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price integer NOT NULL DEFAULT 0,
  amount integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  payment_number text NOT NULL,
  invoice_id integer NOT NULL REFERENCES invoices(id),
  patient_id integer NOT NULL REFERENCES patients(id),
  amount integer NOT NULL,
  method text NOT NULL,
  status text NOT NULL DEFAULT 'Completed',
  received_by integer,
  notes text,
  reversal_reason text,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_number_uq ON payments (payment_number);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice_id);
CREATE TABLE IF NOT EXISTS receipts (
  id serial PRIMARY KEY,
  receipt_number text NOT NULL,
  payment_id integer NOT NULL REFERENCES payments(id),
  invoice_id integer NOT NULL REFERENCES invoices(id),
  patient_id integer NOT NULL REFERENCES patients(id),
  receipt_date timestamptz NOT NULL DEFAULT now(),
  amount integer NOT NULL,
  method text NOT NULL,
  received_by integer,
  received_by_name text,
  notes text,
  status text NOT NULL DEFAULT 'Issued',
  void_reason text,
  snapshot_patient_name text,
  snapshot_patient_number text,
  snapshot_invoice_number text,
  balance_after integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS receipts_number_uq ON receipts (receipt_number);
CREATE UNIQUE INDEX IF NOT EXISTS receipts_payment_uq ON receipts (payment_id);
CREATE TABLE IF NOT EXISTS expenses (
  id serial PRIMARY KEY,
  expense_number text NOT NULL,
  expense_date date NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount integer NOT NULL,
  payment_method text,
  payee text,
  reference text,
  entered_by integer,
  notes text,
  status text NOT NULL DEFAULT 'Recorded',
  void_reason text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS expenses_number_uq ON expenses (expense_number);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (expense_date);
CREATE TABLE IF NOT EXISTS documents (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Other',
  description text,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL DEFAULT 0,
  file_data text NOT NULL,
  uploaded_by integer,
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_patient_idx ON documents (patient_id);
CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  user_id integer,
  role_code text,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uq ON notifications (dedupe_key);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id integer,
  user_name text,
  role text,
  action text NOT NULL,
  module text NOT NULL,
  record_id text,
  ip text,
  description text,
  previous_value jsonb,
  new_value jsonb
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS audit_module_idx ON audit_logs (module);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_logs (user_id);
CREATE TABLE IF NOT EXISTS record_revisions (
  id serial PRIMARY KEY,
  module text NOT NULL,
  record_id text NOT NULL,
  user_id integer,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revisions_record_idx ON record_revisions (module, record_id);
CREATE TABLE IF NOT EXISTS access_overrides (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  module text NOT NULL,
  record_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

let ready: Promise<void> | null = null;

export function ensureSchema() {
  if (!ready) {
    ready = pool.query(SCHEMA_SQL).then(() => undefined).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
