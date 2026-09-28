"use client";

import { useEffect, useState } from "react";
import { AccessDenied, AuditView, DoctorsInfo, DocumentsPage, HelpPage, NotificationsPage, Profile, Reports, SettingsView, UsersAdmin } from "./modules/admin";
import { Dashboard } from "./modules/dashboard";
import { Appointments, Doctors, NurseStation, Psychology, QueueBoard } from "./modules/flow";
import { Billing, Expenses, Finance, ReceiptPrint, Receipts } from "./modules/money";
import { PatientCard, PatientProfile, Patients } from "./modules/patients";
import { Inventory } from "./modules/stock";
import { api } from "@/lib/client";
import type { SessionUser } from "@/lib/types";

export function Router({ slug }: { slug: string[] }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => { api<{ user: SessionUser }>("/api/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null)); }, []);
  const [a, b, c] = slug;
  if (!a || a === "dashboard") return <Dashboard />;
  if (a === "patients" && b && c === "card") return <PatientCard id={b} />;
  if (a === "patients" && b) return <PatientProfile id={b} />;
  if (a === "patients") return <Patients />;
  if (a === "appointments") return <Appointments />;
  if (a === "queue") return <QueueBoard />;
  if (a === "nurse") return <NurseStation />;
  if (a === "doctors") return <Doctors />;
  if (a === "psychology") return <Psychology />;
  if (a === "inventory") return <Inventory />;
  if (a === "billing") return <Billing />;
  if (a === "receipts" && b) return <ReceiptPrint id={b} />;
  if (a === "receipts") return <Receipts />;
  if (a === "expenses") return <Expenses />;
  if (a === "finance") return <Finance />;
  if (a === "reports") return <Reports />;
  if (a === "documents") return <DocumentsPage />;
  if (a === "doctors-info") return <DoctorsInfo />;
  if (a === "users") return <UsersAdmin />;
  if (a === "audit") return <AuditView />;
  if (a === "settings") return <SettingsView />;
  if (a === "notifications") return <NotificationsPage />;
  if (a === "profile") return user ? <Profile user={user} /> : <div className="page">Loading profile…</div>;
  if (a === "help") return <HelpPage />;
  if (a === "access-denied") return <AccessDenied />;
  return <div className="page"><div className="card card-pad"><h1 className="display">Page not found</h1><p>That section is not part of SAPA Clinic.</p></div></div>;
}
