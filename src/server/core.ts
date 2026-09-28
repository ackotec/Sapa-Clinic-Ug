import { createHmac, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { accessOverrides, auditLogs, recordRevisions, sequences, settings, users, roles, rolePermissions, permissions } from "@/db/schema";
import { canAccess } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";

const scryptAsync = promisify(scrypt);
const COOKIE = "sapa_session";
const SESSION_HOURS = 8;

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, fields?: Record<string, string>, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.extra = extra;
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers });
}

export function errorResponse(error: unknown) {
  const apiError = toApiError(error);
  if (apiError) {
    return json({ error: apiError.message, fields: apiError.fields, ...(apiError.extra ?? {}) }, apiError.status);
  }
  console.error(error);
  return json({ error: "The request could not be completed. Please try again or contact the system administrator." }, 500);
}

function toApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (!error || typeof error !== "object" || !("status" in error) || !("message" in error)) return null;
  const status = Number((error as { status: unknown }).status);
  const message = String((error as { message: unknown }).message || "");
  if (!Number.isInteger(status) || status < 400 || status > 599 || !message) return null;
  const fields = (error as ApiError).fields;
  const extra = (error as ApiError).extra;
  return new ApiError(status, message, fields, extra);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "The request body is not valid.");
  }
}

export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim().slice(0, 64) || "unknown";
  return req.headers.get("x-real-ip")?.slice(0, 64) || "unknown";
}

export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new ApiError(403, "The request was blocked.");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, "The request was blocked.");
  }
}

function secret() {
  return process.env.SESSION_SECRET || process.env.DATABASE_URL || "sapa-session-development";
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

type TokenPayload = { uid: number; sv: number; exp: number };

function sign(payload: TokenPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (!payload.uid || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: number, sessionVersion: number) {
  const token = sign({ uid: userId, sv: sessionVersion, exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000 });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", path: "/", maxAge: 0 });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      staffCode: users.staffCode,
      email: users.email,
      phone: users.phone,
      department: users.department,
      specialty: users.specialty,
      status: users.status,
      sessionVersion: users.sessionVersion,
      lastLogin: users.lastLogin,
      roleId: users.roleId,
      role: roles.code,
      roleName: roles.name,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, payload.uid))
    .limit(1);
  const user = rows[0];
  if (!user || user.status !== "active" || user.sessionVersion !== payload.sv) return null;
  const grants = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, user.roleId));
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    staffCode: user.staffCode,
    email: user.email,
    phone: user.phone,
    department: user.department,
    specialty: user.specialty,
    role: user.role,
    roleName: user.roleName,
    permissions: grants.map((item) => item.code),
    lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
  };
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Please sign in to continue.");
  return user;
}

export async function hasActiveOverride(userId: number, module: string) {
  const rows = await db
    .select({ id: accessOverrides.id })
    .from(accessOverrides)
    .where(and(eq(accessOverrides.userId, userId), eq(accessOverrides.module, module), sql`${accessOverrides.expiresAt} > now()`))
    .limit(1);
  return rows.length > 0;
}

export async function requirePerm(user: SessionUser, code: string, moduleForOverride?: string) {
  if (canAccess(user.permissions, code)) return;
  if (moduleForOverride && canAccess(user.permissions, "override.emergency") && (await hasActiveOverride(user.id, moduleForOverride))) return;
  throw new ApiError(403, "You do not have permission to perform this action.");
}

export function can(user: SessionUser, code: string) {
  return canAccess(user.permissions, code);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Db = typeof db | Tx;

export async function audit(
  executor: Db,
  req: Request | null,
  user: { id?: number | null; name?: string | null; role?: string | null } | null,
  entry: {
    action: string;
    module: string;
    recordId?: string | number | null;
    description?: string;
    previousValue?: unknown;
    newValue?: unknown;
  },
) {
  await executor.insert(auditLogs).values({
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    role: user?.role ?? null,
    action: entry.action,
    module: entry.module,
    recordId: entry.recordId == null ? null : String(entry.recordId),
    ip: req ? clientIp(req) : null,
    description: entry.description ?? null,
    previousValue: entry.previousValue === undefined ? null : entry.previousValue,
    newValue: entry.newValue === undefined ? null : entry.newValue,
  });
}

export async function revise(executor: Db, module: string, recordId: string | number, userId: number | null, previousValue: unknown, newValue: unknown) {
  await executor.insert(recordRevisions).values({
    module,
    recordId: String(recordId),
    userId,
    previousValue,
    newValue,
  });
}

export async function nextNumber(executor: Db, name: string, prefix: string, width = 5) {
  await executor.insert(sequences).values({ name, nextValue: 1 }).onConflictDoNothing();
  const rows = await executor
    .update(sequences)
    .set({ nextValue: sql`${sequences.nextValue} + 1` })
    .where(eq(sequences.name, name))
    .returning({ nextValue: sequences.nextValue });
  const issued = (rows[0]?.nextValue ?? 1) - 1;
  return `${prefix}${String(issued).padStart(width, "0")}`;
}

export async function getSetting(key: string, fallback = "") {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? fallback;
}

export async function getSettings(keys: string[]) {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(keys.map((key) => [key, map.get(key) ?? ""]));
}

export function str(value: unknown, max = 500) {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

export function opt(value: unknown, max = 2000) {
  const text = str(value, max);
  return text ? text : null;
}

export function requireText(value: unknown, label: string, max = 160) {
  const text = str(value, max);
  if (!text) throw new ApiError(400, `${label} is required.`, { [label]: `${label} is required.` });
  return text;
}

export function dateOrNull(value: unknown, label: string) {
  const text = str(value, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00`))) {
    throw new ApiError(400, `${label} must be a valid date.`);
  }
  return text;
}

export function requireDate(value: unknown, label: string) {
  const text = dateOrNull(value, label);
  if (!text) throw new ApiError(400, `${label} is required.`);
  return text;
}

export function timeOrThrow(value: unknown) {
  const text = str(value, 5);
  if (!/^\d{2}:\d{2}$/.test(text)) throw new ApiError(400, "Enter a valid time.");
  const [h, m] = text.split(":").map(Number);
  if (h > 23 || m > 59) throw new ApiError(400, "Enter a valid time.");
  return text;
}

export function wholeAmount(value: unknown, label: string, allowZero = true) {
  if (value === "" || value == null) throw new ApiError(400, `${label} is required.`);
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0 || (!allowZero && number === 0)) {
    throw new ApiError(400, `${label} must be a whole non-negative amount.`);
  }
  if (number > 2_000_000_000) throw new ApiError(400, `${label} is too large.`);
  return number;
}

export function optionalAmount(value: unknown, label: string) {
  if (value === "" || value == null) return 0;
  return wholeAmount(value, label);
}

export function decimalOrNull(value: unknown, label: string, max = 1000) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new ApiError(400, `${label} is not valid.`);
  return number.toFixed(2);
}

export function intOrNull(value: unknown, label: string, min = 0, max = 1000) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new ApiError(400, `${label} is not valid.`);
  return number;
}

export function normalizePhone(value: unknown) {
  const display = str(value, 40);
  const digits = display.replace(/\D/g, "");
  return { display: display || null, digits: digits || null };
}

export function validEmail(value: unknown) {
  const email = opt(value, 160);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid email address.");
  return email.toLowerCase();
}

export function ageFromDob(dob: string | null | undefined) {
  if (!dob) return null;
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return age;
}

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const compact = phone.replace(/\s/g, "");
  if (compact.length < 6) return "•••";
  return `${compact.slice(0, 3)}${"•".repeat(Math.max(4, compact.length - 5))}${compact.slice(-2)}`;
}

export function bmi(weightKg: number | null, heightCm: number | null) {
  if (!weightKg || !heightCm) return null;
  const meters = heightCm / 100;
  if (meters <= 0) return null;
  return (weightKg / (meters * meters)).toFixed(2);
}

export function invoiceTotals(input: { consultationFee: number; medicineCost: number; laboratoryCharges: number; otherCharges: number; discount: number; amountPaid?: number }) {
  const gross = input.consultationFee + input.medicineCost + input.laboratoryCharges + input.otherCharges;
  if ([input.consultationFee, input.medicineCost, input.laboratoryCharges, input.otherCharges, input.discount].some((value) => value < 0)) {
    throw new ApiError(400, "Charges and discount cannot be negative.");
  }
  if (input.discount > gross) throw new ApiError(400, "Discount cannot be greater than the charges.");
  const totalAmount = gross - input.discount;
  const amountPaid = input.amountPaid ?? 0;
  if (amountPaid < 0) throw new ApiError(400, "Amount paid cannot be negative.");
  const balance = totalAmount - amountPaid;
  if (balance < 0) throw new ApiError(400, "Payments cannot exceed the invoice total.");
  let status = "Unpaid";
  if (totalAmount === 0 || balance === 0) status = "Paid";
  else if (amountPaid > 0) status = "Partially Paid";
  return { totalAmount, amountPaid, balance, status };
}

export function paymentStatus(totalAmount: number, amountPaid: number) {
  const balance = totalAmount - amountPaid;
  if (amountPaid <= 0 && totalAmount > 0) return { balance, status: "Unpaid" };
  if (balance > 0) return { balance, status: "Partially Paid" };
  return { balance, status: "Paid" };
}

export function todayISO(timeZone = "Africa/Kampala") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function formatMoney(amount: number, currency = "UGX") {
  return `${currency} ${new Intl.NumberFormat("en-UG").format(amount)}`;
}

export function pageParams(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get("pageSize") || 15) || 15));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export async function rows<T = Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const result = await db.execute(query);
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export async function runSql(statement: string) {
  await pool.query(statement);
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function assertLoginRate(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && current.resetAt > now && current.count >= 8) {
    throw new ApiError(429, "Too many sign-in attempts. Please wait 15 minutes and try again.");
  }
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
}

export function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

export function safeUser(user: SessionUser) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    staffCode: user.staffCode,
    email: user.email,
    phone: user.phone,
    role: user.role,
    roleName: user.roleName,
    department: user.department,
    specialty: user.specialty,
    permissions: user.permissions,
    lastLogin: user.lastLogin,
  };
}

export function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(records: Record<string, unknown>[]) {
  if (!records.length) return "message\nNo records\n";
  const headers = Object.keys(records[0]);
  return [headers.join(","), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(","))].join("\n");
}

export function parseCsv(text: string) {
  const rowsOut: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      if (row.some((item) => item !== "")) rowsOut.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  row.push(cell.trim());
  if (row.some((item) => item !== "")) rowsOut.push(row);
  if (!rowsOut.length) return [];
  const headers = rowsOut[0].map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  return rowsOut.slice(1).map((values, index) => {
    const record: Record<string, string> = { __row: String(index + 2) };
    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] ?? "";
    });
    return record;
  });
}

export function defaultSlots() {
  const slots: string[] = [];
  for (let hour = 8; hour <= 16; hour += 1) {
    slots.push(`${String(hour).padStart(2, "0")}:00`);
    if (hour !== 16) slots.push(`${String(hour).padStart(2, "0")}:30`);
  }
  return slots;
}

export function passwordOk(password: string, min = 8) {
  if (password.length < min) return `Password must be at least ${min} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must include a letter and a number.";
  return null;
}
