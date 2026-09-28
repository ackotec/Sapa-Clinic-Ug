"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, ClientError } from "@/lib/client";

const DEMOS = [
  ["Administrator", "admin", "SapaAdmin#2026"],
  ["Reception", "reception", "Reception#2026"],
  ["Nurse", "nurse.amina", "Nurse#2026"],
  ["Doctor", "dr.okello", "Doctor#2026"],
  ["Psychologist", "psych.nakato", "Psych#2026"],
  ["Pharmacist", "pharmacy", "Pharmacy#2026"],
  ["Accountant", "accounts", "Accounts#2026"],
  ["Manager", "manager", "Manager#2026"],
];

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("SapaAdmin#2026");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      router.push(params.get("next") || "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientError ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.1fr 0.9fr" }} className="login-grid">
      <section style={{ background: `#0b2c4a url('/images/login-clinic.jpg') center/cover`, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(7,30,51,.82), rgba(15,118,110,.45))" }} />
        <div style={{ position: "relative", color: "white", padding: 48, maxWidth: 640 }}>
          <img src="/branding/logo.svg" alt="" width={64} height={64} />
          <p style={{ letterSpacing: "0.16em", textTransform: "uppercase", fontSize: 13 }}>SAPA Clinic Management System</p>
          <h1 className="display" style={{ fontSize: "clamp(40px, 5vw, 68px)", lineHeight: 1.02, margin: "12px 0" }}>Care, records, and accounts in one trusted workspace.</h1>
          <p style={{ fontSize: 18, maxWidth: 520, color: "#e7f3f4" }}>From registration to receipt, every action stays linked to the patient record, the role that performed it, and an audit trail.</p>
        </div>
      </section>
      <section style={{ display: "grid", placeItems: "center", padding: 28 }}>
        <form onSubmit={submit} className="card card-pad" style={{ width: "min(460px, 100%)" }}>
          <h2 className="display" style={{ marginTop: 0, fontSize: 36 }}>Sign in</h2>
          <p className="muted">Use your staff username. Demonstration accounts are labeled and are not real clinic staff.</p>
          <label className="field">Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label className="field" style={{ marginTop: 12 }}>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
          <button className="btn teal" style={{ width: "100%", marginTop: 16 }} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <details style={{ marginTop: 16 }}>
            <summary>Demonstration access</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {DEMOS.map(([label, user, pass]) => (
                <button key={user} type="button" className="btn ghost" onClick={() => { setUsername(user); setPassword(pass); }}>{label}: {user}</button>
              ))}
            </div>
          </details>
          <p className="muted" style={{ fontSize: 13 }}>Forgotten password? An administrator can reset it from Users & Staff. This system does not send password email.</p>
        </form>
      </section>
      <style>{`@media (max-width: 900px) { .login-grid { grid-template-columns: 1fr !important; } .login-grid > section:first-child { min-height: 240px; } }`}</style>
    </main>
  );
}
