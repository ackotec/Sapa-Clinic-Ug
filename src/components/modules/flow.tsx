"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import type { PatientBrief } from "@/lib/types";
import { Badge, Empty, Field, Modal, useToast } from "../kit";
import { PatientPicker } from "./patients";

type Options = { lists: Record<string, { label: string; active: boolean }[]>; doctors: Staff[]; psychologists: Staff[]; slots: string[]; consultationFee: number };
type Staff = { id: number; name: string; specialty: string | null; status: string; staffCode: string };

export function Appointments() {
  const toast = useToast();
  const params = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [open, setOpen] = useState(Boolean(params.get("patientId")));
  const [patient, setPatient] = useState<PatientBrief | null>(params.get("patientId") ? { id: Number(params.get("patientId")), patientNumber: "", fullName: "Selected patient", dateOfBirth: null, age: null, gender: null, phone: null, status: "Active", caseType: null } : null);
  const range = useMemo(() => rangeFor(cursor, view), [cursor, view]);
  function load() {
    api<{ items: any[] }>(`/api/appointments?from=${range.from}&to=${range.to}`).then((data) => setItems(data.items)).catch((err) => toast.push(err.message));
  }
  useEffect(() => { api<Options>("/api/options").then(setOptions).catch(() => undefined); }, []);
  useEffect(() => { load(); }, [range.from, range.to]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!patient) return toast.push("Select a patient.");
    try {
      await api("/api/appointments", { method: "POST", body: JSON.stringify({ ...Object.fromEntries(form.entries()), patientId: patient.id }) });
      toast.push("Appointment created successfully.");
      setOpen(false);
      load();
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not save."); }
  }
  async function setStatus(row: any, status: string) {
    const cancelReason = ["Cancelled", "No Show"].includes(status) ? window.prompt("Reason for this status") || "" : "";
    if (["Cancelled", "No Show"].includes(status) && !cancelReason) return;
    try {
      await api(`/api/appointments/${row.id}`, { method: "PUT", body: JSON.stringify({ version: row.version, status, cancelReason, appointmentDate: row.appointmentDate, appointmentTime: row.appointmentTime }) });
      toast.push("Appointment updated successfully.");
      load();
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not update."); }
  }
  const days = daysBetween(range.from, range.to);
  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h1 className="display" style={{ margin: 0 }}>Appointments</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" type="button" onClick={() => setCursor(shift(cursor, view, -1))}>Previous</button>
          <button className="btn ghost" type="button" onClick={() => setCursor(new Date())}>Today</button>
          <button className="btn ghost" type="button" onClick={() => setCursor(shift(cursor, view, 1))}>Next</button>
          {(["day", "week", "month"] as const).map((item) => <button key={item} className={`btn ${view === item ? "teal" : "ghost"}`} type="button" onClick={() => setView(item)}>{item}</button>)}
          <button className="btn" type="button" onClick={() => setOpen(true)}>Create appointment</button>
        </div>
      </div>
      {view === "month" ? (
        <div className="cal">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <strong key={day}>{day}</strong>)}{padMonth(days[0]).map((n) => <div key={`p${n}`} />)}{days.map((day) => <div className="day" key={day}><strong>{day.slice(8)}</strong>{items.filter((item) => item.appointmentDate === day).map((item) => <span className="chip" key={item.id} title={item.status}>{item.appointmentTime} {item.patientName}</span>)}</div>)}</div>
      ) : (
        <div className="card">{items.length === 0 ? <Empty title="No appointments in this view." body="Create an appointment for a registered patient." /> : <table><thead><tr><th>When</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="tabular">{item.appointmentDate} {item.appointmentTime}</td><td>{item.patientNumber} · {item.patientName}</td><td>{item.doctorName}</td><td>{item.reason || "—"}</td><td><Badge status={item.status} /></td><td style={{ display: "flex", gap: 4 }}>{["Confirmed", "Completed", "No Show", "Cancelled"].map((status) => <button key={status} className="btn ghost" type="button" onClick={() => setStatus(item, status)}>{status}</button>)}</td></tr>)}</tbody></table>}</div>
      )}
      {open && <Modal title="Create appointment" onClose={() => setOpen(false)}><form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        <PatientPicker value={patient} onChange={setPatient} />
        <Field label="Doctor" required><select name="doctorId" required><option value="">Select</option>{(options?.doctors || []).filter((doctor) => doctor.status === "active").map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.specialty || "Clinician"} · {doctor.status}</option>)}</select></Field>
        <div className="grid-2"><Field label="Date" required><input type="date" name="appointmentDate" required /></Field><Field label="Time" required><select name="appointmentTime" required><option value="">Select</option>{(options?.slots || []).map((slot) => <option key={slot}>{slot}</option>)}</select></Field></div>
        <Field label="Reason"><input name="reason" /></Field>
        <Field label="Notes"><textarea name="notes" rows={2} /></Field>
        <Field label="Status"><select name="status" defaultValue="Scheduled">{(options?.lists.appointment_status || []).filter((item) => item.active).map((item) => <option key={item.label}>{item.label}</option>)}</select></Field>
        <button className="btn teal">Save appointment</button>
      </form></Modal>}
    </div>
  );
}

export function QueueBoard() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [open, setOpen] = useState(false);
  const [patient, setPatient] = useState<PatientBrief | null>(null);
  const [department, setDepartment] = useState("");
  function load() { api<{ items: any[] }>(`/api/queue${department ? `?department=${encodeURIComponent(department)}` : ""}`).then((data) => setItems(data.items)).catch((err) => toast.push(err.message)); }
  useEffect(() => { api<Options>("/api/options").then(setOptions); load(); }, [department]);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return toast.push("Select a patient.");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/queue", { method: "POST", body: JSON.stringify({ ...Object.fromEntries(form.entries()), patientId: patient.id }) });
      toast.push("Patient added to the queue.");
      setOpen(false); load();
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not add to queue."); }
  }
  async function move(id: number, status: string) {
    try { await api(`/api/queue/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }); toast.push(status === "Called" ? "Patient called." : "Queue updated successfully."); load(); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not update queue."); }
  }
  const calling = items.find((item) => item.status === "Called");
  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between" }}><h1 className="display" style={{ margin: 0 }}>Patient queue</h1><button className="btn teal" type="button" onClick={() => setOpen(true)}>Add arrival</button></div>
      {calling && <div className="card card-pad"><div className="muted">Now calling</div><h2 className="display" style={{ margin: 0 }}>{calling.queueNumber} · {calling.patientName}</h2></div>}
      <select aria-label="Department" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All departments</option>{(options?.lists.department || []).map((item) => <option key={item.label}>{item.label}</option>)}</select>
      <div className="card">{items.length === 0 ? <Empty title="No one is waiting." body="Add an arrival when a patient reaches the clinic." /> : <table><thead><tr><th>Queue</th><th>Patient</th><th>Service</th><th>Department</th><th>Waiting</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="tabular">{item.queueNumber}</td><td>{item.patientNumber} · {item.patientName}</td><td>{item.service || "—"}</td><td>{item.department}</td><td>{item.waitingMinutes} min</td><td><Badge status={item.priority} /></td><td><Badge status={item.status} /></td><td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{["Called", "In Triage", "Waiting for Doctor", "With Doctor", "Waiting for Pharmacy", "Waiting for Payment", "Completed"].map((status) => <button key={status} className="btn ghost" type="button" onClick={() => move(item.id, status)}>{status}</button>)}</td></tr>)}</tbody></table>}</div>
      {open && <Modal title="Add to queue" onClose={() => setOpen(false)}><form onSubmit={add} style={{ display: "grid", gap: 10 }}><PatientPicker value={patient} onChange={setPatient} /><Field label="Department"><select name="department">{(options?.lists.department || []).map((item) => <option key={item.label}>{item.label}</option>)}</select></Field><Field label="Service"><select name="service">{(options?.lists.service || []).map((item) => <option key={item.label}>{item.label}</option>)}</select></Field><Field label="Priority"><select name="priority">{(options?.lists.priority || []).map((item) => <option key={item.label}>{item.label}</option>)}</select></Field><button className="btn teal">Add arrival</button></form></Modal>}
    </div>
  );
}

export function NurseStation() {
  return <EncounterPage title="Nurse Station" endpoint="/api/nurse" kind="nurse" />;
}
export function Doctors() {
  return <EncounterPage title="Doctors" endpoint="/api/clinical" kind="doctor" />;
}
export function Psychology() {
  return <EncounterPage title="Psychologist" endpoint="/api/psychology" kind="psychology" />;
}

function EncounterPage({ title, endpoint, kind }: { title: string; endpoint: string; kind: "nurse" | "doctor" | "psychology" }) {
  const toast = useToast();
  const params = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [patient, setPatient] = useState<PatientBrief | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [meds, setMeds] = useState<any[]>([]);
  const [rxRows, setRxRows] = useState([{ medicineName: "", dose: "", frequency: "", route: "", duration: "", quantity: 1, instructions: "", medicineId: "" }]);
  useEffect(() => { api<Options>("/api/options").then(setOptions).catch(() => undefined); api<{ items: any[] }>(endpoint).then((data) => setItems(data.items)).catch((err) => toast.push(err.message)); if (kind === "doctor") api<{ items: any[] }>("/api/inventory/medicines").then((data) => setMeds(data.items)).catch(() => undefined); }, [endpoint, kind]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return toast.push("Select a patient.");
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = { ...Object.fromEntries(form.entries()), patientId: patient.id, confirmIdentity: form.get("confirmIdentity") === "on" };
    if (kind === "doctor") body.prescription = { notes: form.get("prescriptionNotes"), items: rxRows.filter((row) => row.medicineName) };
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(body) });
      toast.push(kind === "nurse" ? "Nurse record saved successfully." : kind === "doctor" ? "Consultation saved successfully." : "Psychology session saved successfully.");
      const data = await api<{ items: any[] }>(endpoint);
      setItems(data.items);
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not save."); }
  }
  return (
    <div className="page">
      <h1 className="display" style={{ margin: 0 }}>{title}</h1>
      <div className="grid-2">
        <form className="card card-pad" onSubmit={save} style={{ display: "grid", gap: 10 }}>
          <div className="banner">Recording {kind === "psychology" ? "session" : "encounter"} for: {patient ? `${patient.patientNumber} — ${patient.fullName}` : "no patient selected"}</div>
          <PatientPicker value={patient} onChange={setPatient} />
          {kind === "nurse" && <>
            <div className="section-title">Vital signs</div>
            <div className="grid-2">
              <Field label="Allergies"><input name="allergies" /></Field>
              <Field label="Blood pressure"><input name="bloodPressure" placeholder="120/80" /></Field>
              <Field label="Weight (kg)"><input name="weightKg" type="number" step="0.1" /></Field>
              <Field label="Height (cm)"><input name="heightCm" type="number" step="0.1" /></Field>
              <Field label="Pulse rate"><input name="pulseRate" type="number" /></Field>
              <Field label="SPO2"><input name="spo2" type="number" /></Field>
              <Field label="Temperature °C"><input name="temperatureC" type="number" step="0.1" /></Field>
              <Field label="Respiratory rate"><input name="respiratoryRate" type="number" /></Field>
            </div>
            <Field label="Any medication"><textarea name="medications" rows={2} /></Field>
            <Field label="Symptoms / notes"><textarea name="symptoms" rows={2} /></Field>
            <Field label="Assessment"><textarea name="assessment" rows={2} /></Field>
          </>}
          {kind === "doctor" && <>
            {["presentingComplaints", "historyOfPresentingComplaints", "pastPsychiatricHistory", "pastMedicalSurgicalHistory", "familyHistory", "socialPersonalHistory", "medicalHistory", "currentSituation", "examination", "investigation", "diagnosis", "treatment", "referral", "comments"].map((name) => <Field key={name} label={labelize(name)}><textarea name={name} rows={2} /></Field>)}
            <Field label="Follow-up date"><input type="date" name="followUpDate" /></Field>
            <div className="section-title">Prescription</div>
            {rxRows.map((row, index) => <div className="grid-3" key={index}>
              <input placeholder="Medicine" list="meds" value={row.medicineName} onChange={(event) => setRxRows((rows) => rows.map((item, i) => i === index ? { ...item, medicineName: event.target.value, medicineId: String(meds.find((med) => med.name === event.target.value)?.id || "") } : item))} />
              <input placeholder="Dose" value={row.dose} onChange={(event) => setRxRows((rows) => rows.map((item, i) => i === index ? { ...item, dose: event.target.value } : item))} />
              <input placeholder="Frequency" value={row.frequency} onChange={(event) => setRxRows((rows) => rows.map((item, i) => i === index ? { ...item, frequency: event.target.value } : item))} />
              <input placeholder="Route" value={row.route} onChange={(event) => setRxRows((rows) => rows.map((item, i) => i === index ? { ...item, route: event.target.value } : item))} />
              <input placeholder="Duration" value={row.duration} onChange={(event) => setRxRows((rows) => rows.map((item, i) => i === index ? { ...item, duration: event.target.value } : item))} />
              <input placeholder="Qty" type="number" value={row.quantity} onChange={(event) => setRxRows((rows) => rows.map((item, i) => i === index ? { ...item, quantity: Number(event.target.value) } : item))} />
            </div>)}
            <datalist id="meds">{meds.map((med) => <option key={med.id} value={med.name} />)}</datalist>
            <button className="btn ghost" type="button" onClick={() => setRxRows((rows) => [...rows, { medicineName: "", dose: "", frequency: "", route: "", duration: "", quantity: 1, instructions: "", medicineId: "" }])}>Add medicine</button>
            <Field label="Prescription notes"><textarea name="prescriptionNotes" rows={2} /></Field>
          </>}
          {kind === "psychology" && <>
            <div className="grid-2"><Field label="Session date" required><input type="date" name="sessionDate" required /></Field><Field label="Session type"><input name="sessionType" placeholder="Individual" /></Field></div>
            {["assessment", "diagnosis", "treatment", "progress", "notes"].map((name) => <Field key={name} label={labelize(name)}><textarea name={name} rows={3} /></Field>)}
            <Field label="Follow-up date"><input type="date" name="followUpDate" /></Field>
          </>}
          <label><input type="checkbox" name="confirmIdentity" required /> I confirm this record is for the selected patient.</label>
          <button className="btn teal">Save record</button>
        </form>
        <div className="card">
          <div className="card-pad"><h2 style={{ margin: 0 }}>History</h2><p className="muted">Previous records stay unchanged.</p></div>
          {items.length === 0 ? <Empty title="No records yet." body="Saved encounters will appear here." /> : <table><thead><tr><th>Record</th><th>Patient</th><th>When</th><th>Summary</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.encounterNumber || item.sessionNumber}</td><td>{item.patientNumber} · {item.patientName}</td><td>{String(item.recordedAt || item.sessionDate).slice(0, 16)}</td><td>{item.diagnosis || item.assessment || item.bloodPressure || "—"}</td></tr>)}</tbody></table>}
        </div>
      </div>
    </div>
  );
}

function labelize(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}
function iso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
function rangeFor(cursor: Date, view: "day" | "week" | "month") {
  if (view === "day") return { from: iso(cursor), to: iso(cursor) };
  if (view === "week") {
    const start = new Date(cursor); start.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { from: iso(start), to: iso(end) };
}
function shift(date: Date, view: "day" | "week" | "month", direction: number) {
  const next = new Date(date);
  if (view === "month") next.setMonth(date.getMonth() + direction);
  else next.setDate(date.getDate() + direction * (view === "week" ? 7 : 1));
  return next;
}
function daysBetween(from: string, to: string) {
  const days = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) { days.push(iso(cursor)); cursor.setDate(cursor.getDate() + 1); }
  return days;
}
function padMonth(first: string) {
  const day = new Date(`${first}T00:00:00`).getDay();
  return Array.from({ length: (day + 6) % 7 }, (_, index) => index);
}
