"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, money } from "@/lib/client";
import type { PatientBrief } from "@/lib/types";
import { Badge, Empty, Field, Modal, Pager, useToast } from "../kit";
import { PatientPicker } from "./patients";

export function Billing() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [pay, setPay] = useState<any>(null);
  const [patient, setPatient] = useState<PatientBrief | null>(null);
  const [options, setOptions] = useState<any>(null);
  function load(next = page) { api<{ items: any[]; total: number }>(`/api/invoices?q=${encodeURIComponent(q)}&page=${next}`).then((data) => { setItems(data.items); setTotal(data.total); }).catch((err) => toast.push(err.message)); }
  useEffect(() => { api("/api/options").then(setOptions); }, []);
  useEffect(() => { load(1); }, [q]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return toast.push("Select a patient.");
    const body = { ...Object.fromEntries(new FormData(event.currentTarget).entries()), patientId: patient.id, confirmIdentity: true };
    try { await api("/api/invoices", { method: "POST", body: JSON.stringify(body) }); toast.push("Invoice created successfully."); setOpen(false); load(1); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not create invoice."); }
  }
  async function takePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { ...Object.fromEntries(new FormData(event.currentTarget).entries()), invoiceId: pay.id };
    try {
      const result = await api<{ receipt: { id: number } }>("/api/payments", { method: "POST", body: JSON.stringify(body) });
      toast.push("Payment recorded successfully.");
      setPay(null); load();
      window.location.href = `/receipts/${result.receipt.id}`;
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not record payment."); }
  }
  async function voidInvoice(row: any) {
    const reason = window.prompt("Reason for voiding this invoice");
    if (!reason) return;
    try { await api(`/api/invoices/${row.id}/void`, { method: "POST", body: JSON.stringify({ reason }) }); toast.push("Invoice voided."); load(); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not void invoice."); }
  }
  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between" }}><h1 className="display" style={{ margin: 0 }}>Billing</h1><button className="btn teal" type="button" onClick={() => setOpen(true)}>Create invoice</button></div>
      <input aria-label="Search invoices" placeholder="Invoice number or patient" value={q} onChange={(event) => setQ(event.target.value)} />
      <div className="card">{items.length === 0 ? <Empty title="No invoices found." body="Create an invoice after a consultation, laboratory test, or dispensing." action={<button className="btn" type="button" onClick={() => setOpen(true)}>Create invoice</button>} /> : <table><thead><tr><th>Invoice</th><th>Date</th><th>Patient</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.invoiceNumber}</td><td>{item.invoiceDate}</td><td>{item.snapshotPatientNumber} · {item.snapshotPatientName}</td><td className="tabular">{money(item.totalAmount, options?.currency)}</td><td>{money(item.amountPaid, options?.currency)}</td><td>{money(item.balance, options?.currency)}</td><td><Badge status={item.status} /></td><td style={{ display: "flex", gap: 4 }}>{item.balance > 0 && item.status !== "Voided" && <button className="btn teal" type="button" onClick={() => setPay(item)}>Pay</button>}{item.status !== "Voided" && item.amountPaid === 0 && <button className="btn ghost" type="button" onClick={() => voidInvoice(item)}>Void</button>}</td></tr>)}</tbody></table>}<Pager page={page} pageSize={15} total={total} onPage={(next) => { setPage(next); load(next); }} /></div>
      {open && <Modal title="Create invoice" onClose={() => setOpen(false)}><form onSubmit={create} style={{ display: "grid", gap: 10 }}><PatientPicker value={patient} onChange={setPatient} /><Field label="Doctor"><select name="doctorId"><option value="">None</option>{(options?.doctors || []).map((doctor: any) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></Field><Field label="Invoice date"><input type="date" name="invoiceDate" /></Field><div className="grid-2"><Field label="Consultation fee"><input name="consultationFee" type="number" defaultValue={options?.consultationFee || 0} /></Field><Field label="Medicine cost"><input name="medicineCost" type="number" defaultValue={0} /></Field><Field label="Laboratory charges"><input name="laboratoryCharges" type="number" defaultValue={0} /></Field><Field label="Other charges"><input name="otherCharges" type="number" defaultValue={0} /></Field><Field label="Discount"><input name="discount" type="number" defaultValue={0} /></Field></div><p className="muted">Total is calculated on the server as charges minus discount. Balance is total minus payments.</p><button className="btn teal">Create invoice</button></form></Modal>}
      {pay && <Modal title={`Pay ${pay.invoiceNumber}`} onClose={() => setPay(null)}><form onSubmit={takePayment} style={{ display: "grid", gap: 10 }}><p>Balance {money(pay.balance, options?.currency)}. Another payment can be recorded later.</p><Field label="Amount" required><input name="amount" type="number" required defaultValue={pay.balance} /></Field><Field label="Method" required><select name="method" required>{(options?.lists.payment_method || []).filter((item: any) => item.active).map((item: any) => <option key={item.label}>{item.label}</option>)}</select></Field><Field label="Notes"><input name="notes" /></Field><button className="btn teal">Record payment</button></form></Modal>}
    </div>
  );
}

export function Receipts() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { api<{ items: any[] }>(`/api/receipts?q=${encodeURIComponent(q)}`).then((data) => setItems(data.items)).catch((err) => toast.push(err.message)); }, [q]);
  return <div className="page"><h1 className="display">Receipts</h1><input aria-label="Search receipts" placeholder="Receipt, invoice, or patient" value={q} onChange={(event) => setQ(event.target.value)} /><div className="card">{items.length === 0 ? <Empty title="No receipts yet." body="A receipt is generated when a payment is recorded." /> : <table><thead><tr><th>Receipt</th><th>Invoice</th><th>Patient</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><Link href={`/receipts/${item.id}`}>{item.receiptNumber}</Link></td><td>{item.snapshotInvoiceNumber}</td><td>{item.snapshotPatientNumber} · {item.snapshotPatientName}</td><td>{money(item.amount)}</td><td>{item.method}</td><td><Badge status={item.status} /></td></tr>)}</tbody></table>}</div></div>;
}

export function ReceiptPrint({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api(`/api/receipts/${id}`).then(setData); }, [id]);
  if (!data) return <div className="page">Loading receipt…</div>;
  const receipt = data.receipt;
  const clinic = data.clinic;
  return <div className="page"><div className="no-print" style={{ display: "flex", gap: 8 }}><button className="btn" type="button" onClick={() => window.print()}>Print A4</button><Link className="btn ghost" href="/receipts">Back</Link></div><article className="card card-pad" style={{ maxWidth: 760 }}>
    <div style={{ display: "flex", justifyContent: "space-between" }}><div><img src="/api/branding/logo" alt="" width={56} height={56} /><h1 className="display" style={{ margin: "8px 0" }}>{clinic.name}</h1><p>{clinic.address}<br />{clinic.phone}<br />{clinic.email}</p></div><div><h2>Receipt</h2><div className="tabular">{receipt.receiptNumber}</div><Badge status={receipt.status} /></div></div>
    <hr /><p><strong>Patient:</strong> {receipt.snapshotPatientNumber} · {receipt.snapshotPatientName}</p><p><strong>Invoice:</strong> {receipt.snapshotInvoiceNumber}</p><p><strong>Date:</strong> {String(receipt.receiptDate).slice(0, 16).replace("T", " ")}</p><p><strong>Amount paid:</strong> {money(receipt.amount, clinic.currency)}</p><p><strong>Method:</strong> {receipt.method}</p><p><strong>Received by:</strong> {receipt.receivedByName}</p><p><strong>Remaining balance:</strong> {money(receipt.balanceAfter, clinic.currency)}</p>{receipt.notes && <p>{receipt.notes}</p>}{receipt.voidReason && <p>Void reason: {receipt.voidReason}</p>}<hr /><p>{clinic.footer}</p>
  </article></div>;
}

export function Expenses() {
  const toast = useToast();
  const [data, setData] = useState<any>({ items: [], total: 0, summary: {}, byCategory: [], byMethod: [] });
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<any>(null);
  function load() { api("/api/expenses").then(setData).catch((err) => toast.push(err.message)); }
  useEffect(() => { load(); api("/api/options").then(setOptions); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await api("/api/expenses", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) }); toast.push("Expense recorded successfully."); setOpen(false); load(); }
    catch (err) { toast.push(err instanceof Error ? err.message : "Could not save expense."); }
  }
  async function voidExpense(id: number) {
    const reason = window.prompt("Reason for voiding this expense");
    if (!reason) return;
    try { await api(`/api/expenses/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) }); toast.push("Expense voided."); load(); } catch (err) { toast.push(err instanceof Error ? err.message : "Could not void."); }
  }
  const summary = data.summary || {};
  return <div className="page"><div style={{ display: "flex", justifyContent: "space-between" }}><h1 className="display" style={{ margin: 0 }}>Expenses</h1><button className="btn teal" type="button" onClick={() => setOpen(true)}>Record expense</button></div>
    <section className="grid-4">{[["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"]].map(([key, label]) => <article key={key} className="card kpi"><div><strong>{money(summary[key], options?.currency)}</strong><span>{label}</span></div></article>)}</section>
    <div className="grid-2"><article className="card card-pad"><h3>By category</h3>{(data.byCategory || []).map((row: any) => <p key={row.category}>{row.category}: {money(row.amount, options?.currency)}</p>)}</article><article className="card card-pad"><h3>By payment method</h3>{(data.byMethod || []).map((row: any) => <p key={row.method}>{row.method}: {money(row.amount, options?.currency)}</p>)}</article></div>
    <div className="card">{data.items?.length ? <table><thead><tr><th>ID</th><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Payee</th><th>Status</th><th></th></tr></thead><tbody>{data.items.map((item: any) => <tr key={item.id}><td>{item.expenseNumber}</td><td>{item.expenseDate}</td><td>{item.category}</td><td>{item.description}</td><td>{money(item.amount, options?.currency)}</td><td>{item.payee || "—"}</td><td><Badge status={item.status} /></td><td>{item.status === "Recorded" && <button className="btn ghost" type="button" onClick={() => voidExpense(item.id)}>Void</button>}</td></tr>)}</tbody></table> : <Empty title="No expenses recorded." body="Record rent, supplies, salaries, and other clinic costs here." />}</div>
    {open && <Modal title="Record expense" onClose={() => setOpen(false)}><form onSubmit={save} style={{ display: "grid", gap: 10 }}><Field label="Date" required><input type="date" name="expenseDate" required /></Field><Field label="Category" required><select name="category" required>{(options?.lists.expense_category || []).map((item: any) => <option key={item.label}>{item.label}</option>)}</select></Field><Field label="Description" required><input name="description" required /></Field><Field label="Amount" required><input name="amount" type="number" required /></Field><Field label="Payment method"><select name="paymentMethod">{(options?.lists.payment_method || []).map((item: any) => <option key={item.label}>{item.label}</option>)}</select></Field><Field label="Payee"><input name="payee" /></Field><Field label="Reference"><input name="reference" /></Field><Field label="Notes"><textarea name="notes" rows={2} /></Field><button className="btn teal">Save expense</button></form></Modal>}
  </div>;
}

export function Finance() {
  const [data, setData] = useState<any>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [doctorId, setDoctorId] = useState("");
  const [options, setOptions] = useState<any>(null);
  useEffect(() => { api("/api/options").then(setOptions); }, []);
  useEffect(() => { api(`/api/finance?month=${month}&year=${year}&doctorId=${doctorId}`).then(setData).catch(() => setData(null)); }, [month, year, doctorId]);
  if (!data) return <div className="page">Loading financial summary…</div>;
  const rows = [["Consultation revenue", data.consultation], ["Medicine revenue", data.medicine], ["Laboratory revenue", data.laboratory], ["Other revenue", data.other], ["Total billed revenue", data.totalRevenue], ["Cash collected", data.cashCollected], ["Expenses", data.expenses], ["Net billed position", data.netBilled], ["Net cash position", data.netCash], ["Outstanding receivables", data.outstanding]];
  return <div className="page"><h1 className="display">Monthly financial summary</h1><div style={{ display: "flex", gap: 8 }}><input type="number" aria-label="Month" value={month} min={1} max={12} onChange={(event) => setMonth(Number(event.target.value))} /><input type="number" aria-label="Year" value={year} onChange={(event) => setYear(Number(event.target.value))} /><select aria-label="Doctor" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}><option value="">All doctors</option>{(options?.doctors || []).map((doctor: any) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select><button className="btn ghost" type="button" onClick={() => window.print()}>Print</button></div>
    <div className="card card-pad"><p className="muted">{data.note}</p>{rows.map(([label, value]) => <p key={String(label)} style={{ display: "flex", justifyContent: "space-between" }}><span>{label}</span><strong className="tabular">{money(Number(value), options?.currency)}</strong></p>)}<p>Paid invoices: {data.paid} · Partially paid: {data.partial} · Unpaid: {data.unpaid}</p></div></div>;
}
