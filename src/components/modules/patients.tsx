"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ClientError, ageLabel } from "@/lib/client";
import type { PatientBrief } from "@/lib/types";
import { Badge, Empty, Field, Modal, Pager, useToast } from "../kit";

type Options = { lists: Record<string, { label: string; active: boolean }[]> };

export function PatientPicker({ value, onChange }: { value: PatientBrief | null; onChange: (patient: PatientBrief) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PatientBrief[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (q.trim().length < 2) return;
      api<{ items: PatientBrief[] }>(`/api/patients?q=${encodeURIComponent(q)}&pageSize=8`).then((data) => setItems(data.items)).catch(() => setItems([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <div className="field">
      <span className="req">Patient</span>
      <input placeholder="Search name, PAT number, or phone" value={q} onChange={(event) => setQ(event.target.value)} />
      {value && <div className="banner">Selected {value.patientNumber} — {value.fullName} · {ageLabel(value.age)} · {value.gender || "Gender not recorded"}</div>}
      {items.length > 0 && <div className="card">{items.map((item) => <button key={item.id} type="button" className="btn ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => { onChange(item); setItems([]); setQ(item.fullName); }}>{item.patientNumber} · {item.fullName} · {item.phone || "No phone"}</button>)}</div>}
    </div>
  );
}

export function Patients() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: PatientBrief[]; total: number }>({ items: [], total: 0 });
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  useEffect(() => { api<Options>("/api/options").then(setOptions).catch(() => undefined); }, []);
  function load(nextPage = page) {
    const params = new URLSearchParams({ q, page: String(nextPage), pageSize: "12", status });
    api<{ items: PatientBrief[]; total: number }>(`/api/patients?${params}`).then(setData).catch((err) => toast.push(err.message));
  }
  useEffect(() => { load(1); setPage(1); }, [q, status]);
  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h1 className="display" style={{ margin: 0 }}>Patients</h1><p className="muted">Search an existing patient before registering a new one.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn ghost" href={`/api/patients?export=1&q=${encodeURIComponent(q)}`}>Export CSV</a>
          <button className="btn teal" type="button" onClick={() => setOpen(true)}>Register patient</button>
        </div>
      </div>
      <div className="card card-pad" style={{ display: "flex", gap: 8 }}>
        <input aria-label="Search patients" placeholder="Name, PAT number, phone, next of kin, invoice" value={q} onChange={(event) => setQ(event.target.value)} style={{ flex: 1 }} />
        <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Active records</option>
          {(options?.lists.patient_status || []).map((item) => <option key={item.label}>{item.label}</option>)}
        </select>
      </div>
      <div className="card">
        {data.items.length === 0 ? <Empty title="No patients found." body="Try another search, or register a patient if this is a first visit." action={<button className="btn" type="button" onClick={() => setOpen(true)}>Register patient</button>} /> : (
          <table>
            <thead><tr><th>Patient ID</th><th>Name</th><th>Age / gender</th><th>Phone</th><th>Case</th><th>Status</th></tr></thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="tabular"><Link href={`/patients/${item.id}`}>{item.patientNumber}</Link></td>
                  <td>{item.fullName}{item.isDemo ? " · Demo" : ""}</td>
                  <td>{ageLabel(item.age)} · {item.gender || "—"}</td>
                  <td>{item.phone || "—"}</td>
                  <td>{item.caseType || "—"}</td>
                  <td><Badge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={page} pageSize={12} total={data.total} onPage={(next) => { setPage(next); load(next); }} />
      </div>
      {open && <PatientForm options={options} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(1); toast.push("Patient registered successfully."); }} />}
    </div>
  );
}

export function PatientForm({ options, onClose, onSaved, initial }: { options: Options | null; onClose: () => void; onSaved: () => void; initial?: Record<string, unknown> }) {
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<ClientError["duplicates"]>([]);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(form.entries());
    body.services = form.getAll("services");
    body.confirmDuplicate = Boolean(duplicates?.length);
    if (initial?.version) body.version = String(initial.version);
    setBusy(true);
    setError("");
    try {
      const path = initial?.id ? `/api/patients/${initial.id}` : "/api/patients";
      await api(path, { method: initial?.id ? "PUT" : "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (err) {
      if (err instanceof ClientError && err.duplicates?.length) setDuplicates(err.duplicates);
      setError(err instanceof Error ? err.message : "Could not save the patient.");
    } finally { setBusy(false); }
  }
  const list = (key: string) => (options?.lists[key] || []).filter((item) => item.active);
  return (
    <Modal title={initial ? "Edit patient" : "Register patient"} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <div className="section-title">Identity</div>
        <div className="grid-2">
          <Field label="Full name" required><input name="fullName" defaultValue={String(initial?.fullName || "")} required /></Field>
          <Field label="Registration date"><input type="date" name="registrationDate" defaultValue={String(initial?.registrationDate || "")} /></Field>
          <Field label="Date of birth"><input type="date" name="dateOfBirth" defaultValue={String(initial?.dateOfBirth || "")} /></Field>
          <Field label="Gender"><select name="gender" defaultValue={String(initial?.gender || "")}><option value="">Select</option>{list("gender").map((item) => <option key={item.label}>{item.label}</option>)}</select></Field>
          <Field label="Phone"><input name="phone" defaultValue={String(initial?.phone || "")} placeholder="070..." /></Field>
          <Field label="Other phone"><input name="otherPhone" defaultValue={String(initial?.otherPhone || "")} /></Field>
        </div>
        <Field label="Address"><textarea name="address" defaultValue={String(initial?.address || "")} rows={2} /></Field>
        <div className="section-title">Next of kin</div>
        <div className="grid-2">
          <Field label="Emergency contact"><input name="emergencyContact" defaultValue={String(initial?.emergencyContact || "")} /></Field>
          <Field label="Next of kin name"><input name="nokName" defaultValue={String(initial?.nokName || "")} /></Field>
          <Field label="Relationship"><input name="nokRelationship" defaultValue={String(initial?.nokRelationship || "")} /></Field>
          <Field label="Next of kin phone"><input name="nokPhone" defaultValue={String(initial?.nokPhone || "")} /></Field>
          <Field label="Next of kin other phone"><input name="nokOtherPhone" defaultValue={String(initial?.nokOtherPhone || "")} /></Field>
          <Field label="Blood group"><select name="bloodGroup" defaultValue={String(initial?.bloodGroup || "")}><option value="">Select</option>{list("blood_group").map((item) => <option key={item.label}>{item.label}</option>)}</select></Field>
        </div>
        <div className="section-title">Case</div>
        <div className="grid-2">
          <Field label="Case type"><select name="caseType" defaultValue={String(initial?.caseType || "")}><option value="">Select</option>{list("case_type").map((item) => <option key={item.label}>{item.label}</option>)}</select></Field>
          <Field label="Status"><select name="status" defaultValue={String(initial?.status || "Active")}>{list("patient_status").map((item) => <option key={item.label}>{item.label}</option>)}</select></Field>
          <Field label="Next appointment"><input type="date" name="nextAppointment" defaultValue={String(initial?.nextAppointment || "")} /></Field>
        </div>
        <fieldset><legend>Services</legend><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{list("service").map((item) => <label key={item.label}><input type="checkbox" name="services" value={item.label} defaultChecked={Array.isArray(initial?.services) && (initial.services as string[]).includes(item.label)} /> {item.label}</label>)}</div></fieldset>
        <Field label="Allergies"><textarea name="allergies" defaultValue={String(initial?.allergies || "")} rows={2} /></Field>
        <Field label="Medical history"><textarea name="medicalHistory" defaultValue={String(initial?.medicalHistory || "")} rows={3} /></Field>
        <Field label="Notes"><textarea name="notes" defaultValue={String(initial?.notes || "")} rows={2} /></Field>
        {duplicates && duplicates.length > 0 && <div className="banner">Possible existing patient found. {duplicates.map((item) => `${item.patientNumber} ${item.fullName}`).join("; ")}. Submit again only if this is a different person.</div>}
        {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
        <button className="btn teal" disabled={busy}>{busy ? "Saving…" : duplicates?.length ? "Continue and register" : "Save patient"}</button>
      </form>
    </Modal>
  );
}

export function PatientProfile({ id }: { id: string }) {
  const toast = useToast();
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [tab, setTab] = useState("Overview");
  const [edit, setEdit] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  useEffect(() => {
    api(`/api/patients/${id}`).then(setData).catch((err) => toast.push(err.message));
    api<Options>("/api/options").then(setOptions).catch(() => undefined);
  }, [id]);
  if (!data?.patient) return <div className="page"><div className="card card-pad">Loading patient record…</div></div>;
  const patient = data.patient;
  const tabs = ["Overview", "Appointments", "Nurse/Triage", "Doctor Visits", "Psychology", "Prescriptions", "Billing", "Payments", "Receipts", "Documents", "Follow-ups", "Audit / History"].filter((item) => {
    if (item === "Psychology" && !data.psychology) return false;
    if (item === "Doctor Visits" && !data.clinical) return false;
    if (item === "Billing" && !data.invoices) return false;
    return true;
  });
  return (
    <div className="page">
      <div className="card card-pad" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="muted">Recording for</div>
          <h1 className="display" style={{ margin: "4px 0" }}>{patient.patientNumber} — {patient.fullName}</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge status={patient.status} />
            <span>{ageLabel(patient.age)} · {patient.gender || "Gender not recorded"}</span>
            <span>{patient.phone || "No phone"}</span>
            <span>{patient.caseType || "Case not set"}</span>
            {patient.isDemo && <Badge status="Demonstration" />}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn ghost" href={`/patients/${patient.id}/card`}>Patient card</Link>
          <Link className="btn ghost" href={`/appointments?patientId=${patient.id}`}>Book</Link>
          <Link className="btn ghost" href={`/nurse?patientId=${patient.id}`}>Triage</Link>
          <Link className="btn ghost" href={`/doctors?patientId=${patient.id}`}>Consult</Link>
          <button className="btn teal" type="button" onClick={() => setEdit(true)}>Edit</button>
        </div>
      </div>
      <div className="tabs">{tabs.map((item) => <button key={item} className={tab === item ? "on" : ""} type="button" onClick={() => setTab(item)}>{item}</button>)}</div>
      <div className="card card-pad">
        {tab === "Overview" && (
          <div className="grid-2">
            <div><h3>Timeline</h3>{(data.timeline || []).slice(0, 12).map((item: any, index: number) => <p key={index}><strong>{String(item.at).slice(0, 16)}</strong> — {item.label}: {item.detail}</p>)}</div>
            <div>
              <p><strong>Address:</strong> {patient.address || "—"}</p>
              <p><strong>Allergies:</strong> {patient.allergies || "—"}</p>
              <p><strong>Medical history:</strong> {patient.medicalHistory || "—"}</p>
              <p><strong>Next of kin:</strong> {patient.nokName || "—"} ({patient.nokRelationship || "—"}) {patient.nokPhone || ""}</p>
              <p><strong>Services:</strong> {(patient.services || []).join(", ") || "—"}</p>
              <p><strong>Next appointment:</strong> {patient.nextAppointment || "—"}</p>
            </div>
          </div>
        )}
        {tab === "Appointments" && <SimpleTable rows={data.appointments} cols={["appointmentNumber", "appointmentDate", "appointmentTime", "doctorName", "status", "reason"]} />}
        {tab === "Nurse/Triage" && <SimpleTable rows={data.nurse} cols={["encounterNumber", "recordedAt", "bloodPressure", "pulseRate", "spo2", "bmi", "nurseName"]} />}
        {tab === "Doctor Visits" && <SimpleTable rows={data.clinical} cols={["encounterNumber", "recordedAt", "doctorName", "diagnosis", "treatment", "referral"]} />}
        {tab === "Psychology" && <SimpleTable rows={data.psychology} cols={["sessionNumber", "sessionDate", "psychologistName", "diagnosis", "treatment", "progress"]} />}
        {tab === "Prescriptions" && (data.prescriptions || []).map((rx: any) => <div key={rx.id}><strong>{rx.prescriptionNumber}</strong> · {rx.status}<ul>{rx.items.map((item: any) => <li key={item.id}>{item.medicineName} · {item.dose} · {item.frequency} · qty {item.quantity} · dispensed {item.dispensedQty}</li>)}</ul></div>)}
        {tab === "Billing" && <SimpleTable rows={data.invoices} cols={["invoiceNumber", "invoiceDate", "totalAmount", "amountPaid", "balance", "status"]} />}
        {tab === "Payments" && <SimpleTable rows={data.payments} cols={["paymentNumber", "amount", "method", "status", "createdAt"]} />}
        {tab === "Receipts" && <SimpleTable rows={data.receipts} cols={["receiptNumber", "amount", "method", "status", "receiptDate"]} />}
        {tab === "Documents" && <SimpleTable rows={data.documents} cols={["name", "type", "fileName", "createdAt"]} />}
        {tab === "Follow-ups" && <SimpleTable rows={data.followUps} cols={["dueDate", "source", "reason", "status"]} />}
        {tab === "Audit / History" && <SimpleTable rows={data.history} cols={["createdAt", "userName", "action", "module", "description"]} />}
      </div>
      {edit && <PatientForm options={options} initial={patient} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); api(`/api/patients/${id}`).then(setData); toast.push("Patient updated successfully."); }} />}
    </div>
  );
}

function SimpleTable({ rows, cols }: { rows: Record<string, unknown>[]; cols: string[] }) {
  if (!rows?.length) return <div className="empty">No records in this section.</div>;
  return <table><thead><tr>{cols.map((col) => <th key={col}>{col.replace(/([A-Z])/g, " $1")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{cols.map((col) => <td key={col}>{formatCell(row[col])}</td>)}</tr>)}</tbody></table>;
}
function formatCell(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && value.includes("T")) return value.slice(0, 16).replace("T", " ");
  return String(value);
}

export function PatientCard({ id }: { id: string }) {
  const [data, setData] = useState<{ svg: string; url: string; patientNumber: string } | null>(null);
  const [patient, setPatient] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    api(`/api/patients/${id}`).then((row) => setPatient((row as { patient: Record<string, any> }).patient));
    api<{ svg: string; url: string; patientNumber: string }>(`/api/patients/${id}/qr`).then(setData);
  }, [id]);
  if (!patient || !data) return <div className="page">Loading card…</div>;
  return (
    <div className="page">
      <div className="no-print"><button className="btn" type="button" onClick={() => window.print()}>Print card</button></div>
      <article className="card card-pad" style={{ maxWidth: 420, display: "grid", gap: 8 }}>
        <img src="/api/branding/logo" alt="" width={48} height={48} />
        <strong>SAPA Clinic</strong>
        <h1 className="display" style={{ margin: 0 }}>{patient.fullName}</h1>
        <div className="tabular">{data.patientNumber}</div>
        <div dangerouslySetInnerHTML={{ __html: data.svg }} />
        <p className="muted">This code opens the authenticated patient record. It does not contain medical information.</p>
      </article>
    </div>
  );
}
