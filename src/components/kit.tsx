"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ToastApi = { push: (message: string) => void };
const ToastContext = createContext<ToastApi>({ push: () => undefined });
export function useToast() { return useContext(ToastContext); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string }[]>([]);
  const api = useMemo<ToastApi>(() => ({
    push(message: string) {
      const id = Date.now() + Math.random();
      setItems((current) => [...current, { id, message }]);
      setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
    },
  }), []);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast" aria-live="polite">
        {items.map((item) => <div key={item.id}>{item.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export function Badge({ status }: { status?: string | null }) {
  const value = status || "—";
  const tone = /paid|active|completed|ok|issued|recorded|confirmed/i.test(value) ? "good"
    : /partial|reorder|expir|waiting|pending|scheduled|open/i.test(value) ? "warn"
    : /unpaid|cancel|void|expired|out|inactive|archived|no show|reversed|failed/i.test(value) ? "bad"
    : /called|doctor|pharmacy|triage/i.test(value) ? "info" : "neutral";
  return <span className={`badge ${tone}`}>{value}</span>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="card-pad" style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line)" }}>
          <h2 className="display" style={{ margin: 0, fontSize: 28 }}>{title}</h2>
          <button className="btn ghost" onClick={onClose} type="button">Close</button>
        </div>
        <div className="card-pad">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return <label className="field"><span className={required ? "req" : ""}>{label}</span>{children}</label>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty"><h3 className="display" style={{ margin: "0 0 6px", color: "var(--ink)" }}>{title}</h3><p>{body}</p>{action}</div>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px" }}>
      <span className="muted">{total} records</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn ghost" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="tabular">{page} / {pages}</span>
        <button className="btn ghost" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Bars({ points, color = "#0f766e" }: { points: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  if (!points.length) return <div className="empty">No chart data yet.</div>;
  return (
    <div style={{ display: "flex", alignItems: "end", gap: 8, height: 180, paddingTop: 8 }}>
      {points.map((point) => (
        <div key={point.label} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ height: `${Math.max(4, (Number(point.value) / max) * 140)}px`, background: color, borderRadius: 8 }} title={`${point.label}: ${point.value}`} />
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, overflow: "hidden" }}>{point.label}</div>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ points }: { points: { label: string; value: number }[] }) {
  if (!points.length) return <div className="empty">No chart data yet.</div>;
  const width = 640;
  const height = 180;
  const max = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? 20 : 16 + (index * (width - 32)) / (points.length - 1);
    const y = height - 28 - ((Number(point.value) || 0) / max) * (height - 48);
    return { ...point, x, y };
  });
  const d = coords.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend chart" style={{ width: "100%", height: 190 }}>
      <path d={d} fill="none" stroke="#0f766e" strokeWidth="3" />
      {coords.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="3.5" fill="#0b2c4a" />)}
      {coords.map((point, index) => index % Math.ceil(coords.length / 6) === 0 ? <text key={`${point.label}-t`} x={point.x} y={height - 6} fontSize="11" textAnchor="middle" fill="#607284">{point.label}</text> : null)}
    </svg>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ message: string; resolve: (value: boolean) => void } | null>(null);
  function confirm(message: string) {
    return new Promise<boolean>((resolve) => setState({ message, resolve }));
  }
  const dialog = state ? (
    <Modal title="Please confirm" onClose={() => { state.resolve(false); setState(null); }}>
      <p>{state.message}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" type="button" onClick={() => { state.resolve(false); setState(null); }}>Cancel</button>
        <button className="btn danger" type="button" onClick={() => { state.resolve(true); setState(null); }}>Confirm</button>
      </div>
    </Modal>
  ) : null;
  return { confirm, dialog };
}
