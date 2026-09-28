"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, money } from "@/lib/client";
import { Badge, Bars, LineChart } from "../kit";

type Dash = {
  financial: boolean;
  demo: boolean;
  kpis: Record<string, number>;
  charts: {
    revenueDaily: { label: string; value: number }[];
    revenueMonthly: { label: string; value: number }[];
    appointmentsByStatus: { label: string; value: number }[];
    appointmentsByDoctor: { label: string; value: number }[];
    registrations: { label: string; value: number }[];
    demographics: { label: string; value: number }[];
    financialTrend: { label: string; income: number; expenses: number }[];
    doctorActivity: { label: string; value: number }[];
  };
  todayAppointments: { id: number; time: string; status: string; reason: string | null; patient: string; number: string; doctor: string }[];
};

const CARDS = [
  ["totalPatients", "Total patients"],
  ["newPatients", "New patients this month"],
  ["appointmentsToday", "Appointments today"],
  ["pendingAppointments", "Pending today"],
  ["completedVisits", "Completed visits today"],
  ["visitsThisMonth", "Consultations this month"],
  ["lowStock", "Low stock medicines"],
  ["outOfStock", "Out of stock"],
  ["expiring", "Expiring medicines"],
  ["expired", "Expired medicines"],
];

export function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Dash>("/api/dashboard").then(setData).catch((err) => setError(err.message));
  }, []);
  if (error) return <div className="page"><div className="card card-pad">{error}</div></div>;
  if (!data) return <div className="page"><div className="card card-pad">Loading dashboard…</div></div>;
  const finCards = data.financial ? [
    ["unpaidInvoices", "Unpaid invoices"],
    ["outstanding", "Outstanding balance"],
    ["revenueMonth", "Revenue this month"],
    ["expensesMonth", "Expenses this month"],
    ["net", "Net financial position"],
  ] : [];
  return (
    <div className="page">
      <div>
        <p className="muted" style={{ margin: 0 }}>SAPA Clinic Management System</p>
        <h1 className="display" style={{ margin: "4px 0 0", fontSize: 40 }}>Today at the clinic</h1>
      </div>
      {data.demo && <div className="banner">Demonstration data is loaded so the workflow can be reviewed. These are not real patient records. An administrator can archive them in Settings.</div>}
      <section className="grid-4">
        {[...CARDS, ...finCards].map(([key, label]) => (
          <article key={key} className="card kpi">
            <div className="icon" aria-hidden>{label.slice(0, 1)}</div>
            <div>
              <strong className="tabular">{["outstanding", "revenueMonth", "expensesMonth", "net"].includes(key) ? money(data.kpis[key]) : data.kpis[key] ?? 0}</strong>
              <span>{label}</span>
            </div>
          </article>
        ))}
      </section>
      <section className="grid-2">
        {data.financial && <article className="card card-pad"><h2>Revenue — last 14 days</h2><LineChart points={data.charts.revenueDaily} /><h3>By month</h3><Bars points={data.charts.revenueMonthly} /></article>}
        <article className="card card-pad"><h2>Appointments by status</h2><Bars points={data.charts.appointmentsByStatus} color="#0b2c4a" /><h3>By doctor</h3><Bars points={data.charts.appointmentsByDoctor} color="#14919b" /></article>
        <article className="card card-pad"><h2>New registrations</h2><LineChart points={data.charts.registrations} /><h3>Demographics</h3><Bars points={data.charts.demographics} color="#b08948" /></article>
        {data.financial && <article className="card card-pad"><h2>Income and expenses</h2>{data.charts.financialTrend.map((row) => <div key={row.label} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr", gap: 8, marginBottom: 6 }}><strong>{row.label}</strong><span>In {money(row.income)}</span><span>Out {money(row.expenses)}</span></div>)}<p className="muted">Net position is cash collected minus recorded expenses.</p></article>}
        {data.charts.doctorActivity.length > 0 && <article className="card card-pad"><h2>Doctor activity this month</h2><Bars points={data.charts.doctorActivity} /></article>}
      </section>
      <article className="card">
        <div className="card-pad" style={{ display: "flex", justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>Appointments today</h2><Link href="/appointments">Open calendar</Link></div>
        {data.todayAppointments.length === 0 ? <div className="empty">No appointments scheduled for today.</div> : (
          <table>
            <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>{data.todayAppointments.map((row) => <tr key={row.id}><td className="tabular">{row.time}</td><td>{row.number} · {row.patient}</td><td>{row.doctor}</td><td>{row.reason || "—"}</td><td><Badge status={row.status} /></td></tr>)}</tbody>
          </table>
        )}
      </article>
    </div>
  );
}
