"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { SessionUser } from "@/lib/types";
import { Badge, Empty, Field, useToast } from "../kit";
import { PatientPicker } from "./patients";
import type { PatientBrief } from "@/lib/types";

export function DoctorsInfo() {
  const [staff, setStaff] = useState<any[]>([]);
  useEffect(() => { api<{ doctors: any[]; psychologists: any[] }>("/api/options").then((data) => setStaff([...(data.doctors || []), ...(data.psychologists || [])])); }, []);
  return <div className="page"><h1 className="display">Doctors information</h1><div className="card">{staff.length === 0 ? <Empty title="No clinicians found." body="Add doctor users from Users & Staff." /> : <table><thead><tr><th>ID</th><th>Name</th><th>Specialty</th><th>Phone</th><th>Email</th><th>Status</th></tr></thead><tbody>{staff.map((item) => <tr key={item.id}><td>{item.staffCode}</td><td>{item.name}</td><td>{item.specialty || item.role}</td><td>{item.phone || "—"}</td><td>{item.email || "—"}</td><td><Badge status={item.status} /></td></tr>)}</tbody></table>}</div></div>;
}

export function UsersAdmin() {
  const toast = useToast();
  const [data, setData] = useState<any>({ users: [], roles: [], permissions: [] });
  const [roleId, setRoleId] = useState<number | null>(null);
  function load() { api("/api/users").then(setData).catch((err) => toast.push(err.message)); }
  useEffect(() => { load(); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) }); toast.push("User created successfully."); load(); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not create user."); }
  }
  async function toggle(user: any) {
    try { await api(`/api/users/${user.id}`, { method: "PUT", body: JSON.stringify({ status: user.status === "active" ? "inactive" : "active" }) }); toast.push("User updated successfully."); load(); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not update user."); }
  }
  async function reset(id: number) {
    const password = window.prompt("New temporary password");
    if (!password) return;
    try { await api(`/api/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }); toast.push("Password reset successfully."); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not reset password."); }
  }
  async function savePerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = Array.from(new FormData(event.currentTarget).getAll("perm")).map(String);
    try { await api(`/api/roles/${roleId}/permissions`, { method: "PUT", body: JSON.stringify({ permissions: selected }) }); toast.push("Permissions updated."); load(); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not update permissions."); }
  }
  const role = data.roles.find((item: any) => item.id === roleId);
  return <div className="page"><h1 className="display">Users & staff</h1>
    <form className="card card-pad grid-3" onSubmit={create}><Field label="Name" required><input name="name" required /></Field><Field label="Username" required><input name="username" required /></Field><Field label="Password" required><input name="password" required /></Field><Field label="Role" required><select name="roleId" required>{data.roles.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Department"><input name="department" /></Field><Field label="Specialty"><input name="specialty" /></Field><button className="btn teal">Add user</button></form>
    <div className="card"><table><thead><tr><th>Staff ID</th><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>{data.users.map((user: any) => <tr key={user.id}><td>{user.staffCode}</td><td>{user.name}</td><td>{user.username}</td><td>{user.roleName}</td><td><Badge status={user.status} /></td><td>{user.lastLogin ? String(user.lastLogin).slice(0, 16) : "Never"}</td><td style={{ display: "flex", gap: 4 }}><button className="btn ghost" type="button" onClick={() => toggle(user)}>{user.status === "active" ? "Deactivate" : "Activate"}</button><button className="btn ghost" type="button" onClick={() => reset(user.id)}>Reset password</button></td></tr>)}</tbody></table></div>
    <div className="card card-pad"><h2>Role permissions</h2><select aria-label="Role" value={roleId || ""} onChange={(event) => setRoleId(Number(event.target.value))}><option value="">Select role</option>{data.roles.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {role && <form key={role.id} onSubmit={savePerms} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 12 }}>{data.permissions.map((perm: any) => <label key={perm.code}><input type="checkbox" name="perm" value={perm.code} defaultChecked={role.permissions.includes(perm.code)} /> {perm.code}<div className="muted">{perm.description}</div></label>)}<button className="btn">Save permissions</button></form>}
    </div>
  </div>;
}

export function AuditView() {
  const [data, setData] = useState<any>({ items: [], total: 0 });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { api(`/api/audit?q=${encodeURIComponent(q)}&page=${page}`).then(setData); }, [q, page]);
  return <div className="page"><h1 className="display">Audit logs</h1><p className="muted">Audit records cannot be edited or deleted from this screen.</p><input aria-label="Search audit" value={q} onChange={(event) => setQ(event.target.value)} placeholder="User, action, or description" /><div className="card"><table><thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Record</th><th>Description</th></tr></thead><tbody>{data.items.map((item: any) => <tr key={item.id}><td>{String(item.createdAt).slice(0, 19).replace("T", " ")}</td><td>{item.userName || "—"}</td><td>{item.role || "—"}</td><td>{item.action}</td><td>{item.module}</td><td>{item.recordId || "—"}</td><td>{item.description}</td></tr>)}</tbody></table><div className="card-pad"><button className="btn ghost" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button> <button className="btn ghost" type="button" onClick={() => setPage(page + 1)}>Next</button> · {data.total} events</div></div></div>;
}

export function SettingsView() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [quality, setQuality] = useState<any>(null);
  const [csv, setCsv] = useState("full_name,date_of_birth,gender,phone\nDemo Import Patient,1990-01-01,Female,0701234567");
  const [preview, setPreview] = useState<any>(null);
  useEffect(() => { api("/api/settings").then(setData); api("/api/settings/quality").then(setQuality).catch(() => undefined); }, []);
  if (!data) return <div className="page">Loading settings…</div>;
  const s = data.settings;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify(body) }); toast.push("Settings saved successfully."); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not save settings."); }
  }
  async function logo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = (event.currentTarget.elements.namedItem("logo") as HTMLInputElement).files?.[0];
    if (!file) return;
    const dataUrl = await file.arrayBuffer().then((buffer) => `data:${file.type};base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`);
    try { await api("/api/settings/logo", { method: "POST", body: JSON.stringify({ dataUrl }) }); toast.push("Logo updated successfully."); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not upload logo."); }
  }
  async function addRef(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await api("/api/settings/reference", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) }); toast.push("Reference value added."); api("/api/settings").then(setData); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not add value."); }
  }
  return <div className="page"><h1 className="display">Settings</h1>
    <form className="card card-pad grid-2" onSubmit={save}>
      <Field label="Clinic name"><input name="clinic_name" defaultValue={s.clinic_name} /></Field>
      <Field label="Phone"><input name="clinic_phone" defaultValue={s.clinic_phone} /></Field>
      <Field label="Email"><input name="clinic_email" defaultValue={s.clinic_email} /></Field>
      <Field label="Website"><input name="clinic_website" defaultValue={s.clinic_website} /></Field>
      <Field label="Address"><input name="clinic_address" defaultValue={s.clinic_address} /></Field>
      <Field label="Currency"><input name="currency" defaultValue={s.currency} /></Field>
      <Field label="Timezone"><input name="timezone" defaultValue={s.timezone} /></Field>
      <Field label="Expiry warning days"><input name="expiry_warning_days" defaultValue={s.expiry_warning_days} /></Field>
      <Field label="Default consultation fee"><input name="default_consultation_fee" defaultValue={s.default_consultation_fee} /></Field>
      <Field label="Allow negative balance"><select name="allow_negative_balance" defaultValue={s.allow_negative_balance}><option value="false">No</option><option value="true">Yes</option></select></Field>
      <Field label="Allow inactive doctors"><select name="allow_inactive_doctors" defaultValue={s.allow_inactive_doctors}><option value="false">No</option><option value="true">Yes</option></select></Field>
      <Field label="Receipt footer"><input name="receipt_footer" defaultValue={s.receipt_footer} /></Field>
      <button className="btn teal">Save settings</button>
    </form>
    <form className="card card-pad" onSubmit={logo}><h2>Clinic logo</h2><input name="logo" type="file" accept="image/png,image/jpeg" /><button className="btn">Upload logo</button></form>
    <form className="card card-pad grid-3" onSubmit={addRef}><h2 style={{ gridColumn: "1 / -1" }}>Reference lists</h2><Field label="List"><select name="listKey"><option>gender</option><option>appointment_status</option><option>payment_method</option><option>medicine_category</option><option>service</option><option>expense_category</option><option>department</option><option>specialty</option><option>patient_status</option><option>queue_status</option><option>document_type</option></select></Field><Field label="Label"><input name="label" required /></Field><button className="btn">Add value</button></form>
    <div className="card card-pad"><h2>Data quality</h2><p>Missing demographics: {quality?.missingDemographics ?? "—"}</p><p>Unpaid invoices: {quality?.unpaidInvoices ?? "—"}</p><p>Past open appointments: {quality?.pastOpenAppointments ?? "—"}</p><p>Duplicate phones: {(quality?.duplicatePhones || []).map((row: any) => row.phone).join(", ") || "None"}</p><p>Medicines without batches: {(quality?.medicinesWithoutBatch || []).map((row: any) => row.name).join(", ") || "None"}</p><p className="muted">{quality?.backup?.note}</p><button className="btn danger" type="button" onClick={async () => { const confirm = window.prompt("Type CLEAR DEMO to archive demonstration records"); if (!confirm) return; try { const result = await api<{ message: string }>("/api/settings/clear-demo", { method: "POST", body: JSON.stringify({ confirm }) }); toast.push(result.message); } catch (err) { toast.push(err instanceof Error ? err.message : "Could not clear demo data."); } }}>Archive demonstration data</button></div>
    <div className="card card-pad"><h2>Import</h2><p className="muted">Paste CSV for patients, medicines, expenses, or doctors. Invalid rows are reported and are not silently dropped.</p><select id="import-type" defaultValue="patients"><option value="patients">patients</option><option value="medicines">medicines</option><option value="expenses">expenses</option><option value="doctors">doctors</option></select><textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={6} /><div style={{ display: "flex", gap: 8 }}><button className="btn ghost" type="button" onClick={async () => setPreview(await api("/api/import/preview", { method: "POST", body: JSON.stringify({ type: (document.getElementById("import-type") as HTMLSelectElement).value, csv }) }))}>Preview</button><button className="btn" type="button" onClick={async () => { const result = await api<{ message: string }>("/api/import/commit", { method: "POST", body: JSON.stringify({ type: (document.getElementById("import-type") as HTMLSelectElement).value, csv }) }); toast.push(result.message); setPreview(result); }}>Commit valid rows</button></div>{preview && <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(preview, null, 2)}</pre>}</div>
  </div>;
}

export function Reports() {
  const toast = useToast();
  const [type, setType] = useState("patients");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<any[]>([]);
  async function run() {
    try { const data = await api<{ items: any[] }>(`/api/reports/${type}?from=${from}&to=${to}`); setItems(data.items); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not load report."); }
  }
  const cols = items[0] ? Object.keys(items[0]) : [];
  return <div className="page"><h1 className="display">Reports</h1><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><select value={type} onChange={(event) => setType(event.target.value)}><option value="patients">Patient registrations</option><option value="appointments">Appointments</option><option value="clinical">Clinical visits</option><option value="pharmacy">Pharmacy stock</option><option value="financial">Financial invoices</option></select><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /><button className="btn" type="button" onClick={run}>Run</button><a className="btn ghost" href={`/api/reports/${type}?from=${from}&to=${to}&export=1`}>Export CSV</a><button className="btn ghost" type="button" onClick={() => window.print()}>Print</button></div><div className="card">{items.length === 0 ? <Empty title="No report loaded." body="Choose a report and run it. Exports follow your permissions." /> : <table><thead><tr>{cols.map((col) => <th key={col}>{col}</th>)}</tr></thead><tbody>{items.map((row, index) => <tr key={index}>{cols.map((col) => <td key={col}>{String(row[col] ?? "")}</td>)}</tr>)}</tbody></table>}</div></div>;
}

export function DocumentsPage() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [patient, setPatient] = useState<PatientBrief | null>(null);
  useEffect(() => { api<{ items: any[] }>("/api/documents").then((data) => setItems(data.items)).catch((err) => toast.push(err.message)); }, []);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return toast.push("Select a patient.");
    const form = event.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    const dataBase64 = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
    try {
      await api("/api/documents", { method: "POST", body: JSON.stringify({ patientId: patient.id, name: (form.elements.namedItem("name") as HTMLInputElement).value, type: (form.elements.namedItem("type") as HTMLSelectElement).value, description: (form.elements.namedItem("description") as HTMLInputElement).value, fileName: file.name, mimeType: file.type || "application/octet-stream", dataBase64 }) });
      toast.push("Document uploaded successfully.");
      api<{ items: any[] }>("/api/documents").then((data) => setItems(data.items));
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not upload."); }
  }
  return <div className="page"><h1 className="display">Documents</h1><form className="card card-pad grid-2" onSubmit={upload}><PatientPicker value={patient} onChange={setPatient} /><Field label="Name" required><input name="name" required /></Field><Field label="Type"><select name="type"><option>Referral letter</option><option>Laboratory result</option><option>Medical report</option><option>Identification</option><option>Prescription</option><option>Other</option></select></Field><Field label="Description"><input name="description" /></Field><Field label="File"><input name="file" type="file" required /></Field><button className="btn teal">Upload</button></form><div className="card">{items.length === 0 ? <Empty title="No documents." body="Attach referrals, results, and reports to a patient." /> : <table><thead><tr><th>Patient</th><th>Name</th><th>Type</th><th>File</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.patientNumber} · {item.fullName}</td><td>{item.name}</td><td>{item.type}</td><td>{item.fileName}</td><td><a href={`/api/documents/${item.id}/file`}>Download</a></td></tr>)}</tbody></table>}</div></div>;
}

export function Profile({ user }: { user: SessionUser }) {
  const toast = useToast();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await api("/api/profile", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) }); toast.push("Profile updated successfully."); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not update profile."); }
  }
  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await api("/api/auth/password", { method: "POST", body: JSON.stringify(form) }); toast.push("Password changed successfully."); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not change password."); }
  }
  return <div className="page"><h1 className="display">Profile</h1><div className="card card-pad"><p><strong>Staff ID:</strong> {user.staffCode}</p><p><strong>Role:</strong> {user.roleName}</p><p><strong>Department:</strong> {user.department || "—"}</p><p><strong>Last login:</strong> {user.lastLogin || "—"}</p></div><form className="card card-pad grid-2" onSubmit={save}><Field label="Name"><input name="name" defaultValue={user.name} /></Field><Field label="Email"><input name="email" defaultValue={user.email || ""} /></Field><Field label="Phone"><input name="phone" defaultValue={user.phone || ""} /></Field><button className="btn">Save profile</button></form><form className="card card-pad grid-2" onSubmit={password}><Field label="Current password"><input name="current" type="password" required /></Field><Field label="New password"><input name="next" type="password" required /></Field><button className="btn teal">Change password</button></form></div>;
}

export function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { api<{ items: any[] }>("/api/notifications").then((data) => setItems(data.items)); }, []);
  return <div className="page"><h1 className="display">Notifications</h1><button className="btn ghost" type="button" onClick={() => api("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) })}>Mark my alerts read</button><div className="card">{items.length === 0 ? <Empty title="No notifications." body="Stock, appointment, invoice, and follow-up alerts appear here." /> : items.map((item) => <div key={item.id} className="card-pad" style={{ borderBottom: "1px solid var(--line)" }}><strong>{item.title}</strong><div>{item.body}</div><div className="muted">{String(item.createdAt).slice(0, 16)} · {item.type}</div></div>)}</div></div>;
}

export function HelpPage() {
  return <div className="page"><h1 className="display">Help</h1><div className="card card-pad" style={{ display: "grid", gap: 10 }}><p>SAPA Clinic Management System keeps one patient record and links appointments, triage, consultations, psychology, prescriptions, stock, invoices, payments, and receipts to that record.</p><h2>Daily workflow</h2><ol><li>Search before registering a patient.</li><li>Create an appointment and add the arrival to the queue.</li><li>Record vitals at Nurse Station. Old vitals are kept.</li><li>Open Doctors, confirm the patient identity, and save the consultation.</li><li>Dispense from Drug Inventory. FEFO uses the earliest valid expiry.</li><li>Create an invoice, record one or more payments, and print the receipt.</li></ol><h2>Administrators</h2><p>Add users from Users & Staff. Permissions are fine-grained and checked on the server, not only in the menu. Inactive users cannot sign in. Audit logs cannot be edited here.</p><p>Backups are managed by the deployment environment. Settings explains this and does not pretend to run an infrastructure backup. Use Reports export for an operational extract.</p><p>The system organizes, calculates, and alerts. It does not make diagnoses or treatment decisions.</p></div></div>;
}

export function AccessDenied() {
  return <div className="page"><div className="card card-pad"><h1 className="display">Access denied</h1><p>You do not have permission to access this section.</p></div></div>;
}
