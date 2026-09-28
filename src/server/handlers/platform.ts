import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/db";
import {
  accessOverrides,
  auditLogs,
  notifications,
  patients,
  permissions,
  referenceItems,
  rolePermissions,
  roles,
  settings,
  users,
} from "@/db/schema";
import { ALL_PERMISSION_CODES, PERMISSIONS } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import {
  ApiError,
  assertLoginRate,
  audit,
  clearLoginFailures,
  clearSessionCookie,
  clientIp,
  getSessionUser,
  getSetting,
  hashPassword,
  json,
  opt,
  passwordOk,
  readJson,
  recordLoginFailure,
  requirePerm,
  requireText,
  requireUser,
  safeUser,
  setSessionCookie,
  str,
  validEmail,
  verifyPassword,
} from "../core";
import { activeLabels, clinicianOptions, readRows, syncAlerts } from "../shared";

export async function login(req: Request) {
  const body = await readJson(req);
  const username = str(body.username, 80).toLowerCase();
  const password = String(body.password ?? "");
  if (!username || !password) throw new ApiError(400, "Enter your username and password.");
  const key = `${clientIp(req)}:${username}`;
  assertLoginRate(key);
  const found = await db.select().from(users).where(sql`lower(${users.username}) = ${username}`).limit(1);
  const account = found[0];
  const valid = account ? await verifyPassword(password, account.passwordHash) : false;
  if (!account || !valid) {
    recordLoginFailure(key);
    if (account) {
      const attempts = account.failedAttempts + 1;
      await db.update(users).set({
        failedAttempts: attempts,
        lockedUntil: attempts >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : account.lockedUntil,
      }).where(eq(users.id, account.id));
      await audit(db, req, { id: account.id, name: account.name, role: "unknown" }, { action: "login_failed", module: "auth", recordId: account.id, description: "Failed sign-in attempt" });
    } else {
      await audit(db, req, null, { action: "login_failed", module: "auth", description: "Failed sign-in attempt for an unknown username" });
    }
    throw new ApiError(401, "Those sign-in details are not correct.");
  }
  if (account.status !== "active") throw new ApiError(403, "This account is inactive. Contact an administrator.");
  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    throw new ApiError(423, "This account is temporarily locked after repeated failed attempts.");
  }
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLogin: new Date(), updatedAt: new Date() }).where(eq(users.id, account.id));
  await setSessionCookie(account.id, account.sessionVersion);
  clearLoginFailures(key);
  const role = await db.select().from(roles).where(eq(roles.id, account.roleId)).limit(1);
  const grants = await db.select({ code: permissions.code }).from(rolePermissions).innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id)).where(eq(rolePermissions.roleId, account.roleId));
  await audit(db, req, { id: account.id, name: account.name, role: role[0]?.code ?? "" }, { action: "login", module: "auth", recordId: account.id, description: "Signed in" });
  return json({
    user: {
      id: account.id,
      name: account.name,
      username: account.username,
      staffCode: account.staffCode,
      email: account.email,
      phone: account.phone,
      department: account.department,
      specialty: account.specialty,
      role: role[0]?.code ?? "",
      roleName: role[0]?.name ?? "",
      permissions: grants.map((item) => item.code),
      lastLogin: new Date().toISOString(),
    },
  });
}

export async function logout(req: Request) {
  const user = await getSessionUser();
  if (user) await audit(db, req, user, { action: "logout", module: "auth", recordId: user.id, description: "Signed out" });
  await clearSessionCookie();
  return json({ ok: true });
}

export async function me() {
  const user = await requireUser();
  return json({ user: safeUser(user) });
}

export async function changePassword(req: Request, user: SessionUser) {
  const body = await readJson(req);
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  const min = Number(await getSetting("min_password_length", "8")) || 8;
  const problem = passwordOk(next, min);
  if (problem) throw new ApiError(400, problem);
  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!rows[0] || !(await verifyPassword(current, rows[0].passwordHash))) throw new ApiError(400, "The current password is not correct.");
  await db.update(users).set({
    passwordHash: await hashPassword(next),
    sessionVersion: sql`${users.sessionVersion} + 1`,
    updatedAt: new Date(),
  }).where(eq(users.id, user.id));
  await setSessionCookie(user.id, rows[0].sessionVersion + 1);
  await audit(db, req, user, { action: "password_changed", module: "auth", recordId: user.id, description: "Password changed" });
  return json({ ok: true, message: "Password changed successfully." });
}

export async function updateProfile(req: Request, user: SessionUser) {
  const body = await readJson(req);
  const name = requireText(body.name, "Name", 160);
  const email = validEmail(body.email);
  const phone = opt(body.phone, 40);
  const updated = await db.update(users).set({ name, email, phone, updatedAt: new Date() }).where(eq(users.id, user.id)).returning();
  await audit(db, req, user, { action: "profile_updated", module: "profile", recordId: user.id, description: "Profile updated", newValue: { name, email, phone } });
  return json({ user: { ...safeUser(user), name: updated[0].name, email: updated[0].email, phone: updated[0].phone }, message: "Profile updated successfully." });
}

export async function options(user: SessionUser) {
  const lists = ["gender", "appointment_status", "payment_method", "medicine_category", "service", "expense_category", "department", "specialty", "patient_status", "queue_status", "case_type", "blood_group", "document_type", "priority"];
  const listData: Record<string, { id: number; code: string; label: string; active: boolean }[]> = {};
  for (const key of lists) {
    const rows = await db.select().from(referenceItems).where(eq(referenceItems.listKey, key)).orderBy(referenceItems.sortOrder, referenceItems.id);
    listData[key] = rows.map((row) => ({ id: row.id, code: row.code, label: row.label, active: row.active }));
  }
  const people = await clinicianOptions();
  const visiblePeople = people.map((person) => ({
    id: person.id,
    name: person.name,
    staffCode: person.staffCode,
    specialty: person.specialty,
    department: person.department,
    status: person.status,
    role: person.role,
    phone: canContact(user) ? person.phone : null,
    email: canContact(user) ? person.email : null,
  }));
  const slots = JSON.parse(await getSetting("time_slots", "[]") || "[]") as string[];
  return json({
    clinicName: await getSetting("clinic_name", "SAPA Clinic"),
    currency: await getSetting("currency", "UGX"),
    timezone: await getSetting("timezone", "Africa/Kampala"),
    consultationFee: Number(await getSetting("default_consultation_fee", "0")) || 0,
    warningDays: Number(await getSetting("expiry_warning_days", "30")) || 30,
    slots,
    lists: listData,
    doctors: visiblePeople.filter((person) => person.role === "doctor"),
    psychologists: visiblePeople.filter((person) => person.role === "psychologist"),
    nurses: visiblePeople.filter((person) => person.role === "nurse"),
    staff: can(user, "users.manage") || can(user, "doctors.view") ? visiblePeople : visiblePeople.filter((person) => ["doctor", "psychologist", "nurse"].includes(person.role)),
  });
}

function canContact(user: SessionUser) {
  return can(user, "patients.view_contact") || can(user, "users.manage") || can(user, "doctors.view");
}

function can(user: SessionUser, code: string) {
  return user.permissions.includes(code);
}

export async function listNotifications(req: Request, user: SessionUser) {
  await requirePerm(user, "notifications.view");
  await syncAlerts(user);
  const url = new URL(req.url);
  const unread = url.searchParams.get("unread") === "1";
  const where = and(
    or(eq(notifications.userId, user.id), eq(notifications.roleCode, user.role), and(sql`${notifications.userId} is null`, sql`${notifications.roleCode} is null`)),
    unread ? sql`${notifications.readAt} is null` : undefined,
  );
  const items = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(80);
  const unreadCount = await db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(
    or(eq(notifications.userId, user.id), eq(notifications.roleCode, user.role)),
    sql`${notifications.readAt} is null`,
  ));
  return json({ items, unread: Number(unreadCount[0]?.count ?? 0) });
}

export async function readNotifications(req: Request, user: SessionUser) {
  await requirePerm(user, "notifications.view");
  const body = await readJson(req);
  if (body.all === true) {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`));
  } else if (body.id) {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, Number(body.id)), or(eq(notifications.userId, user.id), eq(notifications.roleCode, user.role))));
  }
  return json({ ok: true });
}

export async function search(req: Request, user: SessionUser) {
  const q = str(new URL(req.url).searchParams.get("q"), 80);
  if (q.length < 2) return json({ results: [] });
  const like = `%${q}%`;
  const results: { type: string; title: string; subtitle: string; href: string }[] = [];
  if (can(user, "patients.view")) {
    const rows = await db.select().from(patients).where(or(
      ilike(patients.fullName, like),
      ilike(patients.patientNumber, like),
      ilike(patients.phone, like),
      ilike(patients.phoneDigits, like.replace(/\D/g, "") ? `%${q.replace(/\D/g, "")}%` : like),
    )).limit(6);
    for (const row of rows) results.push({ type: "Patient", title: `${row.patientNumber} — ${row.fullName}`, subtitle: row.status, href: `/patients/${row.id}` });
  }
  if (can(user, "appointments.view")) {
    const rows = await db.execute(sql`
      select a.id, a.appointment_number, a.appointment_date, a.status, p.full_name
      from appointments a join patients p on p.id = a.patient_id
      where a.appointment_number ilike ${like} or p.full_name ilike ${like}
      order by a.appointment_date desc limit 5
    `);
    for (const row of readRows<{ id: number; appointment_number: string; appointment_date: string; status: string; full_name: string }>(rows)) {
      results.push({ type: "Appointment", title: row.appointment_number, subtitle: `${row.full_name} · ${row.appointment_date} · ${row.status}`, href: `/appointments?focus=${row.id}` });
    }
  }
  if (can(user, "billing.view")) {
    const rows = await db.execute(sql`
      select i.id, i.invoice_number, i.status, i.balance, p.full_name
      from invoices i join patients p on p.id = i.patient_id
      where i.invoice_number ilike ${like} or p.full_name ilike ${like}
      order by i.invoice_date desc limit 5
    `);
    for (const row of readRows<{ id: number; invoice_number: string; status: string; full_name: string }>(rows)) {
      results.push({ type: "Invoice", title: row.invoice_number, subtitle: `${row.full_name} · ${row.status}`, href: `/billing?focus=${row.id}` });
    }
  }
  if (can(user, "receipts.view")) {
    const rows = await db.execute(sql`select id, receipt_number, snapshot_patient_name, status from receipts where receipt_number ilike ${like} or snapshot_patient_name ilike ${like} order by receipt_date desc limit 5`);
    for (const row of readRows<{ id: number; receipt_number: string; snapshot_patient_name: string; status: string }>(rows)) {
      results.push({ type: "Receipt", title: row.receipt_number, subtitle: `${row.snapshot_patient_name} · ${row.status}`, href: `/receipts/${row.id}` });
    }
  }
  if (can(user, "inventory.view")) {
    const rows = await db.execute(sql`select id, medicine_code, name from medicines where name ilike ${like} or medicine_code ilike ${like} limit 5`);
    for (const row of readRows<{ id: number; medicine_code: string; name: string }>(rows)) {
      results.push({ type: "Medicine", title: row.name, subtitle: row.medicine_code, href: `/inventory?focus=${row.id}` });
    }
  }
  if (can(user, "doctors.view")) {
    const rows = await db.select({ id: users.id, name: users.name, staffCode: users.staffCode }).from(users).where(or(ilike(users.name, like), ilike(users.staffCode, like))).limit(4);
    for (const row of rows) results.push({ type: "Staff", title: row.name, subtitle: row.staffCode, href: "/doctors-info" });
  }
  return json({ results });
}

export async function settingsGet(user: SessionUser) {
  await requirePerm(user, "settings.manage");
  const rows = await db.select().from(settings);
  const data = Object.fromEntries(rows.filter((row) => row.key !== "logo_data").map((row) => [row.key, row.value]));
  data.hasLogo = rows.some((row) => row.key === "logo_data" && row.value) ? "true" : "false";
  const lists = await db.select().from(referenceItems).orderBy(referenceItems.listKey, referenceItems.sortOrder);
  return json({ settings: data, lists, permissions: PERMISSIONS });
}

export async function settingsPut(req: Request, user: SessionUser) {
  await requirePerm(user, "settings.manage");
  const body = await readJson(req);
  const allowed = ["clinic_name", "clinic_address", "clinic_phone", "clinic_email", "clinic_website", "currency", "timezone", "expiry_warning_days", "default_consultation_fee", "allow_negative_balance", "allow_inactive_doctors", "min_password_length", "time_slots", "receipt_footer", "system_type", "demo_banner"];
  const previous: Record<string, string> = {};
  const next: Record<string, string> = {};
  for (const key of allowed) {
    if (body[key] == null) continue;
    const value = key === "time_slots" ? JSON.stringify(body[key]) : str(body[key], 2000);
    const old = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    previous[key] = old[0]?.value ?? "";
    next[key] = value;
    await db.insert(settings).values({ key, value, updatedAt: new Date(), updatedBy: user.id }).onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date(), updatedBy: user.id },
    });
  }
  await audit(db, req, user, { action: "settings_updated", module: "settings", description: "Clinic settings updated", previousValue: previous, newValue: next });
  return json({ ok: true, message: "Settings saved successfully." });
}

export async function saveLogo(req: Request, user: SessionUser) {
  await requirePerm(user, "settings.manage");
  const body = await readJson(req);
  const data = str(body.dataUrl, 700_000);
  if (!data.startsWith("data:image/")) throw new ApiError(400, "Upload a PNG or JPG logo under 500KB.");
  if (data.length > 680_000) throw new ApiError(400, "Logo file is too large.");
  await db.insert(settings).values({ key: "logo_data", value: data, updatedBy: user.id }).onConflictDoUpdate({
    target: settings.key,
    set: { value: data, updatedAt: new Date(), updatedBy: user.id },
  });
  await audit(db, req, user, { action: "logo_updated", module: "settings", description: "Clinic logo updated" });
  return json({ ok: true, message: "Logo updated successfully." });
}

export async function referenceSave(req: Request, user: SessionUser) {
  await requirePerm(user, "settings.manage");
  const body = await readJson(req);
  const listKey = requireText(body.listKey, "List", 60);
  const label = requireText(body.label, "Label", 80);
  const code = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
  if (body.id) {
    const updated = await db.update(referenceItems).set({
      label,
      active: body.active !== false,
      sortOrder: Number(body.sortOrder ?? 0) || 0,
    }).where(eq(referenceItems.id, Number(body.id))).returning();
    await audit(db, req, user, { action: "reference_updated", module: "settings", recordId: body.id as number, description: `Updated ${listKey} value`, newValue: { label } });
    return json({ item: updated[0], message: "Reference value updated." });
  }
  const created = await db.insert(referenceItems).values({ listKey, code, label, active: true, sortOrder: Number(body.sortOrder ?? 0) || 0 }).returning();
  await audit(db, req, user, { action: "reference_created", module: "settings", recordId: created[0].id, description: `Added ${label} to ${listKey}` });
  return json({ item: created[0], message: "Reference value added." });
}

export async function usersGet(user: SessionUser) {
  await requirePerm(user, "users.manage");
  const rows = await db.select({
    id: users.id,
    staffCode: users.staffCode,
    name: users.name,
    username: users.username,
    email: users.email,
    phone: users.phone,
    department: users.department,
    specialty: users.specialty,
    status: users.status,
    lastLogin: users.lastLogin,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    roleId: users.roleId,
    role: roles.code,
    roleName: roles.name,
    isDemo: users.isDemo,
    version: users.version,
  }).from(users).innerJoin(roles, eq(users.roleId, roles.id)).orderBy(users.name);
  const roleRows = await db.select().from(roles).orderBy(roles.name);
  const grants = await db.select({ roleId: rolePermissions.roleId, code: permissions.code }).from(rolePermissions).innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id));
  return json({
    users: rows,
    roles: roleRows.map((role) => ({ ...role, permissions: grants.filter((grant) => grant.roleId === role.id).map((grant) => grant.code) })),
    permissions: PERMISSIONS,
  });
}

export async function usersPost(req: Request, user: SessionUser) {
  await requirePerm(user, "users.manage");
  const body = await readJson(req);
  const name = requireText(body.name, "Name");
  const username = requireText(body.username, "Username", 80).toLowerCase();
  const roleId = Number(body.roleId);
  if (!roleId) throw new ApiError(400, "Select a role.");
  const min = Number(await getSetting("min_password_length", "8")) || 8;
  const password = String(body.password ?? "");
  const problem = passwordOk(password, min);
  if (problem) throw new ApiError(400, problem);
  const duplicate = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${username}`).limit(1);
  if (duplicate.length) throw new ApiError(400, "That username is already in use.");
  const role = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role[0]) throw new ApiError(400, "Selected role was not found.");
  const prefix = role[0].code === "doctor" ? "DOC" : role[0].code === "psychologist" ? "PSY" : role[0].code === "nurse" ? "NUR" : "STF";
  const { nextNumber } = await import("../core");
  const created = await db.insert(users).values({
    staffCode: await nextNumber(db, "staff", prefix),
    name,
    username,
    email: validEmail(body.email),
    phone: opt(body.phone, 40),
    passwordHash: await hashPassword(password),
    roleId,
    department: opt(body.department, 80),
    specialty: opt(body.specialty, 80),
    status: "active",
  }).returning({ id: users.id, staffCode: users.staffCode });
  await audit(db, req, user, { action: "user_created", module: "users", recordId: created[0].id, description: `Created user ${username}`, newValue: { name, username, role: role[0].code } });
  return json({ user: created[0], message: "User created successfully." });
}

export async function usersPut(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "users.manage");
  const body = await readJson(req);
  const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing[0]) throw new ApiError(404, "User not found.");
  if (body.status === "inactive" && id === user.id) throw new ApiError(400, "You cannot deactivate your own account.");
  const nextRole = body.roleId ? Number(body.roleId) : existing[0].roleId;
  if (existing[0].status === "active" && body.status === "inactive") {
    await assertNotLastAdmin(existing[0].roleId, id);
  }
  const updated = await db.update(users).set({
    name: body.name ? requireText(body.name, "Name") : existing[0].name,
    email: body.email !== undefined ? validEmail(body.email) : existing[0].email,
    phone: body.phone !== undefined ? opt(body.phone, 40) : existing[0].phone,
    department: body.department !== undefined ? opt(body.department, 80) : existing[0].department,
    specialty: body.specialty !== undefined ? opt(body.specialty, 80) : existing[0].specialty,
    roleId: nextRole,
    status: body.status === "inactive" ? "inactive" : body.status === "active" ? "active" : existing[0].status,
    sessionVersion: body.status === "inactive" || (body.roleId && Number(body.roleId) !== existing[0].roleId) ? sql`${users.sessionVersion} + 1` : existing[0].sessionVersion,
    updatedAt: new Date(),
    version: sql`${users.version} + 1`,
  }).where(eq(users.id, id)).returning({ id: users.id, status: users.status });
  await audit(db, req, user, {
    action: "user_updated",
    module: "users",
    recordId: id,
    description: "User account updated",
    previousValue: { status: existing[0].status, roleId: existing[0].roleId, name: existing[0].name },
    newValue: { status: updated[0].status, roleId: nextRole, name: body.name ?? existing[0].name },
  });
  return json({ user: updated[0], message: "User updated successfully." });
}

async function assertNotLastAdmin(roleId: number, userId: number) {
  const role = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (role[0]?.code !== "administrator") return;
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.roleId, roleId), eq(users.status, "active")));
  if (admins.length <= 1 && admins[0]?.id === userId) throw new ApiError(400, "The last active administrator cannot be deactivated.");
}

export async function resetPassword(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "users.manage");
  const body = await readJson(req);
  const min = Number(await getSetting("min_password_length", "8")) || 8;
  const password = String(body.password ?? "");
  const problem = passwordOk(password, min);
  if (problem) throw new ApiError(400, problem);
  const updated = await db.update(users).set({
    passwordHash: await hashPassword(password),
    sessionVersion: sql`${users.sessionVersion} + 1`,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  }).where(eq(users.id, id)).returning({ id: users.id });
  if (!updated.length) throw new ApiError(404, "User not found.");
  await audit(db, req, user, { action: "password_reset", module: "users", recordId: id, description: "Administrator reset a user password" });
  return json({ ok: true, message: "Password reset successfully. Existing sessions were signed out." });
}

export async function rolesPost(req: Request, user: SessionUser) {
  await requirePerm(user, "users.manage");
  const body = await readJson(req);
  const name = requireText(body.name, "Role name", 80);
  const code = requireText(body.code, "Role code", 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const created = await db.insert(roles).values({ code, name, description: opt(body.description, 200), isSystem: false }).returning();
  await audit(db, req, user, { action: "role_created", module: "users", recordId: created[0].id, description: `Created role ${name}` });
  return json({ role: created[0], message: "Role created successfully." });
}

export async function rolesPerms(req: Request, user: SessionUser, id: number) {
  await requirePerm(user, "users.manage");
  const body = await readJson(req);
  const codes = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
  const invalid = codes.filter((code) => !ALL_PERMISSION_CODES.includes(code));
  if (invalid.length) throw new ApiError(400, "One or more permissions are not recognized.");
  const role = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role[0]) throw new ApiError(404, "Role not found.");
  if (role[0].code === "administrator" && (!codes.includes("users.manage") || !codes.includes("settings.manage"))) {
    throw new ApiError(400, "The administrator role must keep user and settings management.");
  }
  const permissionRows = await db.select().from(permissions);
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
  for (const code of codes) {
    const permission = permissionRows.find((item) => item.code === code);
    if (permission) await db.insert(rolePermissions).values({ roleId: id, permissionId: permission.id });
  }
  await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.roleId, id));
  await audit(db, req, user, { action: "permissions_updated", module: "users", recordId: id, description: `Updated permissions for ${role[0].name}`, newValue: codes });
  return json({ ok: true, message: "Permissions updated. Affected users must sign in again." });
}

export async function auditGet(req: Request, user: SessionUser) {
  await requirePerm(user, "audit.view");
  const url = new URL(req.url);
  const q = str(url.searchParams.get("q"), 80);
  const moduleName = str(url.searchParams.get("module"), 40);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = 25;
  const where = and(
    moduleName ? eq(auditLogs.module, moduleName) : undefined,
    q ? or(ilike(auditLogs.description, `%${q}%`), ilike(auditLogs.userName, `%${q}%`), ilike(auditLogs.action, `%${q}%`), ilike(auditLogs.recordId, `%${q}%`)) : undefined,
  );
  const items = await db.select({
    id: auditLogs.id,
    createdAt: auditLogs.createdAt,
    userId: auditLogs.userId,
    userName: auditLogs.userName,
    role: auditLogs.role,
    action: auditLogs.action,
    module: auditLogs.module,
    recordId: auditLogs.recordId,
    ip: auditLogs.ip,
    description: auditLogs.description,
  }).from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  return json({ items, total: Number(total[0]?.count ?? 0), page, pageSize });
}

export async function createOverride(req: Request, user: SessionUser) {
  await requirePerm(user, "override.emergency");
  const body = await readJson(req);
  const reason = requireText(body.reason, "Reason", 300);
  const moduleName = requireText(body.module, "Module", 40);
  if (!["psychology", "clinical", "documents"].includes(moduleName)) throw new ApiError(400, "Override is only available for psychology, clinical, or documents.");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const created = await db.insert(accessOverrides).values({
    userId: user.id,
    reason,
    module: moduleName,
    recordId: opt(body.recordId, 40),
    expiresAt,
  }).returning();
  await audit(db, req, user, { action: "emergency_override", module: "security", recordId: created[0].id, description: `Emergency view override for ${moduleName}: ${reason}` });
  return json({ override: created[0], message: "Emergency view access granted for 15 minutes and recorded in the audit log." });
}

export async function quality(user: SessionUser) {
  await requirePerm(user, "settings.manage");
  const duplicatePhones = await db.execute(sql`
    select phone_digits as phone, count(*)::int as count
    from patients
    where phone_digits is not null and phone_digits <> '' and status <> 'Archived'
    group by phone_digits having count(*) > 1
    limit 20
  `);
  const missing = await db.execute(sql`
    select count(*)::int as count from patients
    where status <> 'Archived' and (phone is null or phone = '' or date_of_birth is null or gender is null or gender = '')
  `);
  const noBatch = await db.execute(sql`
    select m.id, m.medicine_code, m.name from medicines m
    left join medicine_batches b on b.medicine_id = m.id
    where m.status = 'Active' and b.id is null
    limit 20
  `);
  const unpaid = await db.execute(sql`select count(*)::int as count from invoices where status in ('Unpaid', 'Partially Paid')`);
  const openAppointments = await db.execute(sql`select count(*)::int as count from appointments where status in ('Scheduled', 'Confirmed') and appointment_date < current_date`);
  return json({
    duplicatePhones: readRows(duplicatePhones),
    missingDemographics: Number(readRows<{ count: number }>(missing)[0]?.count ?? 0),
    medicinesWithoutBatch: readRows(noBatch),
    unpaidInvoices: Number(readRows<{ count: number }>(unpaid)[0]?.count ?? 0),
    pastOpenAppointments: Number(readRows<{ count: number }>(openAppointments)[0]?.count ?? 0),
    backup: {
      managedBy: "Deployment environment",
      note: "Database backups and restores are controlled outside this application. This screen does not pretend to run an infrastructure backup. Authorized administrators can export an operational JSON snapshot from Reports.",
    },
  });
}

export async function qrFor(req: Request, patientNumber: string, patientId: number) {
  const origin = new URL(req.url).origin;
  const url = `${origin}/patients/${patientNumber}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240, color: { dark: "#0B2C4A", light: "#ffffff" } });
  return json({ svg, url, patientId, patientNumber });
}

export async function logo() {
  const value = await getSetting("logo_data", "");
  if (value.startsWith("data:image/")) {
    const [meta, data] = value.split(",");
    const mime = meta.match(/data:(.*);base64/)?.[1] || "image/png";
    const buffer = Buffer.from(data, "base64");
    return new Response(buffer, { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=300" } });
  }
  return new Response(null, { status: 302, headers: { Location: "/branding/logo.svg" } });
}

export { activeLabels };
