"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NAV_ITEMS, ROUTE_GUARDS, canAccess } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { api } from "@/lib/client";
import { ToastProvider } from "./kit";

export function Shell({ user, clinic, children }: { user: SessionUser; clinic: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ type: string; title: string; subtitle: string; href: string }[]>([]);
  const [notes, setNotes] = useState<{ id: number; title: string; body: string; link?: string }[]>([]);
  const [unread, setUnread] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [online, setOnline] = useState(true);
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const prompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (q.trim().length < 2) { setResults([]); return; }
      api<{ results: { type: string; title: string; subtitle: string; href: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((data) => setResults(data.results)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!user.permissions.includes("notifications.view")) return;
    api<{ items: { id: number; title: string; body: string; link?: string }[]; unread: number }>("/api/notifications?unread=1")
      .then((data) => { setNotes(data.items.slice(0, 6)); setUnread(data.unread); })
      .catch(() => undefined);
  }, [user.permissions, path]);

  const groups = useMemo(() => {
    const visible = NAV_ITEMS.filter((item) => canAccess(user.permissions, item.perm) || item.href === "/help");
    return visible.reduce<Record<string, typeof visible>>((map, item) => {
      map[item.group] = map[item.group] || [];
      map[item.group].push(item);
      return map;
    }, {});
  }, [user.permissions]);

  const guard = ROUTE_GUARDS.find((item) => path === item.prefix || path.startsWith(`${item.prefix}/`));
  const denied = guard && !canAccess(user.permissions, guard.perm) && guard.prefix !== "/help";

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <ToastProvider>
      <div className="app-shell">
        <aside className={`sidebar ${open ? "open" : ""}`}>
          <div className="brand">
            <img src="/api/branding/logo" alt="" />
            <div><strong>SAPA Clinic</strong><span>{clinic}</span></div>
          </div>
          <nav>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div className="nav-group">{group}</div>
                {items.map((item) => (
                  <Link key={item.href} href={item.href} className={`nav-link ${path === item.href || path.startsWith(`${item.href}/`) ? "active" : ""}`} onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div style={{ marginTop: "auto", color: "#b7c9d8", fontSize: 12, padding: "8px" }}>
            <span className={`status-dot ${online ? "" : "off"}`} /> {online ? "Connected" : "Offline — changes cannot be synchronized."}
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn ghost menu-btn" type="button" onClick={() => setOpen((value) => !value)} aria-label="Open menu">Menu</button>
            <div className="search-wrap">
              <input aria-label="Search patients, invoices, receipts, medicines" placeholder="Search patient, appointment, invoice, receipt, medicine" value={q} onChange={(event) => setQ(event.target.value)} />
              {results.length > 0 && (
                <div className="results">
                  {results.map((result) => (
                    <Link key={`${result.type}-${result.href}-${result.title}`} href={result.href} onClick={() => { setQ(""); setResults([]); }}>
                      <strong>{result.type}</strong> · {result.title}<div className="muted">{result.subtitle}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <button className="btn ghost" type="button" onClick={() => setShowNotes((value) => !value)} aria-label="Notifications">{unread > 0 ? `Alerts ${unread}` : "Alerts"}</button>
            <Link className="btn ghost" href="/profile">{user.name}<div className="muted" style={{ fontSize: 12 }}>{user.roleName}</div></Link>
            <button className="btn secondary" type="button" onClick={logout}>Logout</button>
          </header>
          {showNotes && (
            <div className="card" style={{ margin: "12px 22px 0" }}>
              {notes.length === 0 ? <div className="empty">No unread notifications.</div> : notes.map((note) => (
                <Link key={note.id} href={note.link || "/notifications"} style={{ display: "block", padding: 12, textDecoration: "none", color: "inherit", borderBottom: "1px solid var(--line)" }}>
                  <strong>{note.title}</strong><div className="muted">{note.body}</div>
                </Link>
              ))}
            </div>
          )}
          {!online && <div className="banner" style={{ margin: "12px 22px 0" }}>Offline — changes cannot be synchronized.</div>}
          {install && <div className="banner no-print" style={{ margin: "12px 22px 0" }}>SAPA Clinic can be installed on this device. <button className="btn teal" type="button" onClick={() => install.prompt()}>Install app</button></div>}
          {denied ? (
            <div className="page"><div className="card card-pad"><h1 className="display">Access denied</h1><p>You do not have permission to access this section.</p></div></div>
          ) : children}
        </div>
      </div>
    </ToastProvider>
  );
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };
