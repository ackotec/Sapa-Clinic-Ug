"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, money } from "@/lib/client";
import { Badge, Empty, Field, Modal, useToast } from "../kit";

export function Inventory() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [rx, setRx] = useState<any[]>([]);
  const [mode, setMode] = useState<"" | "medicine" | "receive" | "adjust">("");
  const [selected, setSelected] = useState<any>(null);
  function load() {
    api<{ items: any[] }>("/api/inventory/medicines").then((data) => setItems(data.items)).catch((err) => toast.push(err.message));
    api<{ items: any[] }>("/api/inventory/transactions").then((data) => setHistory(data.items)).catch(() => undefined);
    api<{ items: any[] }>("/api/prescriptions?status=Active").then((data) => setRx(data.items)).catch(() => undefined);
  }
  useEffect(() => { load(); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (mode === "medicine") await api("/api/inventory/medicines", { method: "POST", body: JSON.stringify(body) });
      if (mode === "receive") await api("/api/inventory/receive", { method: "POST", body: JSON.stringify(body) });
      if (mode === "adjust") await api("/api/inventory/adjust", { method: "POST", body: JSON.stringify(body) });
      toast.push("Medicine stock updated successfully.");
      setMode("");
      load();
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not save stock."); }
  }
  async function dispense(prescriptionId: number, itemId: number, quantity: number) {
    try {
      await api(`/api/prescriptions/${prescriptionId}/dispense`, { method: "POST", body: JSON.stringify({ items: [{ itemId, quantity }], createInvoice: true }) });
      toast.push("Medicine dispensed and invoice created.");
      load();
    } catch (err) { toast.push(err instanceof Error ? err.message : "Could not dispense."); }
  }
  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div><h1 className="display" style={{ margin: 0 }}>Drug inventory</h1><p className="muted">Batch stock, FEFO dispensing, and expiry alerts.</p></div>
        <div style={{ display: "flex", gap: 8 }}><button className="btn teal" type="button" onClick={() => setMode("medicine")}>Add medicine</button><button className="btn" type="button" onClick={() => setMode("receive")}>Stock received</button><button className="btn ghost" type="button" onClick={() => setMode("adjust")}>Adjust stock</button></div>
      </div>
      <div className="card">{items.length === 0 ? <Empty title="No medicines yet." body="Add a medicine, then receive a batch." /> : <table><thead><tr><th>ID</th><th>Medicine</th><th>Category</th><th>Available</th><th>Reorder</th><th>Price</th><th>Stock value</th><th>Stock</th><th>Expiry</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} onClick={() => setSelected(item)}><td>{item.medicineCode}</td><td>{item.name}</td><td>{item.category || "—"}</td><td className="tabular">{item.available}</td><td>{item.reorderLevel}</td><td>{money(item.unitPrice)}</td><td>{money(item.stockValue)}</td><td><Badge status={item.stockAlert} /></td><td><Badge status={item.expiryAlert} /></td></tr>)}</tbody></table>}</div>
      {selected && <div className="card card-pad"><h2>{selected.name} batches</h2>{selected.batches?.length ? <table><thead><tr><th>Batch</th><th>Expiry</th><th>Remaining</th><th>Cost</th><th>Sell</th><th>Supplier</th></tr></thead><tbody>{selected.batches.map((batch: any) => <tr key={batch.id}><td>{batch.batchNumber}</td><td>{batch.expiryDate}</td><td>{batch.quantityRemaining}</td><td>{money(batch.unitCost)}</td><td>{money(batch.sellingPrice)}</td><td>{batch.supplierName || "—"}</td></tr>)}</tbody></table> : <p>No batch or expiry data for this medicine.</p>}</div>}
      <div className="card card-pad"><h2>Prescriptions ready to dispense</h2>{rx.length === 0 ? <p className="muted">No active prescriptions.</p> : rx.map((item) => <div key={item.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}><strong>{item.prescriptionNumber}</strong> · {item.patientNumber} {item.patientName}{item.items.map((line: any) => <div key={line.id} style={{ display: "flex", gap: 8, alignItems: "center" }}><span>{line.medicineName} · remaining {line.quantity - line.dispensedQty}</span>{line.quantity > line.dispensedQty && <button className="btn teal" type="button" onClick={() => dispense(item.id, line.id, line.quantity - line.dispensedQty)}>Dispense FEFO</button>}</div>)}</div>)}</div>
      <div className="card"><div className="card-pad"><h2 style={{ margin: 0 }}>Stock movement history</h2></div>{history.length === 0 ? <Empty title="No stock movements." body="Receipts, dispensing, and adjustments will be listed here." /> : <table><thead><tr><th>When</th><th>Medicine</th><th>Batch</th><th>Type</th><th>Qty</th><th>By</th><th>Notes</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{String(item.createdAt).slice(0, 16)}</td><td>{item.medicineName}</td><td>{item.batchNumber || "—"}</td><td>{item.type}</td><td className="tabular">{item.quantity}</td><td>{item.userName || "—"}</td><td>{item.notes || item.reference || "—"}</td></tr>)}</tbody></table>}</div>
      {mode && <Modal title={mode === "medicine" ? "Add medicine" : mode === "receive" ? "Receive stock" : "Adjust stock"} onClose={() => setMode("")}><form onSubmit={save} style={{ display: "grid", gap: 10 }}>
        {mode !== "medicine" && <Field label="Medicine" required><select name="medicineId" required>{items.map((item) => <option key={item.id} value={item.id}>{item.medicineCode} · {item.name}</option>)}</select></Field>}
        {mode === "adjust" && <Field label="Batch" required><select name="batchId" required>{items.flatMap((item) => item.batches.map((batch: any) => <option key={batch.id} value={batch.id}>{item.name} · {batch.batchNumber} · {batch.quantityRemaining}</option>))}</select></Field>}
        {mode === "medicine" && <><Field label="Name" required><input name="name" required /></Field><Field label="Category"><input name="category" /></Field><Field label="Supplier"><input name="supplierName" /></Field><div className="grid-2"><Field label="Reorder level"><input name="reorderLevel" type="number" defaultValue={10} /></Field><Field label="Unit price"><input name="unitPrice" type="number" defaultValue={0} /></Field></div></>}
        {mode === "receive" && <><Field label="Batch number" required><input name="batchNumber" required /></Field><Field label="Expiry date" required><input type="date" name="expiryDate" required /></Field><div className="grid-2"><Field label="Quantity" required><input name="quantity" type="number" required /></Field><Field label="Unit cost"><input name="unitCost" type="number" defaultValue={0} /></Field><Field label="Selling price"><input name="sellingPrice" type="number" /></Field><Field label="Supplier"><input name="supplierName" /></Field></div></>}
        {mode === "adjust" && <><Field label="Type" required><select name="type"><option>Adjusted</option><option>Damaged</option><option>Expired</option><option>Returned</option><option>Transferred</option></select></Field><Field label="Quantity" required><input name="quantity" type="number" required /></Field><Field label="Reason" required><textarea name="notes" required rows={2} /></Field></>}
        <button className="btn teal">Save</button>
      </form></Modal>}
    </div>
  );
}
