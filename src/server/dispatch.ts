import { ApiError, assertSameOrigin, errorResponse, requireUser } from "./core";
import { ensureSeeded } from "./seed";
import {
  appointmentsCollection,
  appointmentsCreate,
  appointmentsUpdate,
  documentsArchive,
  documentsCollection,
  documentsCreate,
  documentsFile,
  patientsArchive,
  patientsCheck,
  patientsCollection,
  patientsCreate,
  patientsGet,
  patientsQr,
  patientsUpdate,
  queueCollection,
  queueCreate,
  queueStatus,
} from "./handlers/care";
import {
  clinicalCreate,
  clinicalList,
  clinicalUpdate,
  dispense,
  inventoryList,
  medicineCreate,
  medicineUpdate,
  nurseCreate,
  nurseList,
  prescriptionList,
  psychologyCreate,
  psychologyList,
  psychologyUpdate,
  stockAdjust,
  stockHistory,
  stockReceive,
} from "./handlers/clinical";
import {
  clearDemo,
  dashboard,
  expenseCreate,
  expenseList,
  expenseVoid,
  financeSummary,
  importCommit,
  importPreview,
  invoiceCreate,
  invoiceList,
  invoiceUpdate,
  invoiceVoid,
  paymentCreate,
  paymentReverse,
  receiptGet,
  receiptList,
  report,
} from "./handlers/finance";
import {
  auditGet,
  changePassword,
  createOverride,
  listNotifications,
  login,
  logout,
  me,
  options,
  quality,
  readNotifications,
  referenceSave,
  resetPassword,
  rolesPerms,
  rolesPost,
  saveLogo,
  search,
  settingsGet,
  settingsPut,
  updateProfile,
  usersGet,
  usersPost,
  usersPut,
} from "./handlers/platform";

function num(value: string | undefined) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "That record identifier is not valid.");
  return id;
}

export async function handleApi(req: Request, parts: string[]) {
  try {
    await ensureSeeded();
    assertSameOrigin(req);
    const method = req.method;
    const [a, b, c] = parts;
    if (a === "auth" && b === "login" && method === "POST") return login(req);
    if (a === "auth" && b === "logout" && method === "POST") return logout(req);
    const user = await requireUser();
    if (a === "auth" && b === "me" && method === "GET") return me();
    if (a === "auth" && b === "password" && method === "POST") return changePassword(req, user);
    if (a === "profile" && method === "PUT") return updateProfile(req, user);
    if (a === "options" && method === "GET") return options(user);
    if (a === "dashboard" && method === "GET") return dashboard(user);
    if (a === "search" && method === "GET") return search(req, user);
    if (a === "notifications" && method === "GET") return listNotifications(req, user);
    if (a === "notifications" && b === "read" && method === "POST") return readNotifications(req, user);
    if (a === "patients" && method === "GET" && !b) return patientsCollection(req, user);
    if (a === "patients" && method === "POST" && !b) return patientsCreate(req, user);
    if (a === "patients" && b === "check" && method === "POST") return patientsCheck(req, user);
    if (a === "patients" && b && c === "qr" && method === "GET") return patientsQr(req, user, b);
    if (a === "patients" && b && c === "archive" && method === "POST") return patientsArchive(req, user, b);
    if (a === "patients" && b && method === "GET") return patientsGet(req, user, b);
    if (a === "patients" && b && method === "PUT") return patientsUpdate(req, user, b);
    if (a === "appointments" && method === "GET") return appointmentsCollection(req, user);
    if (a === "appointments" && method === "POST") return appointmentsCreate(req, user);
    if (a === "appointments" && b && method === "PUT") return appointmentsUpdate(req, user, num(b));
    if (a === "queue" && method === "GET") return queueCollection(req, user);
    if (a === "queue" && method === "POST") return queueCreate(req, user);
    if (a === "queue" && b && c === "status" && method === "POST") return queueStatus(req, user, num(b));
    if (a === "nurse" && method === "GET") return nurseList(req, user);
    if (a === "nurse" && method === "POST") return nurseCreate(req, user);
    if (a === "clinical" && method === "GET") return clinicalList(req, user);
    if (a === "clinical" && method === "POST") return clinicalCreate(req, user);
    if (a === "clinical" && b && method === "PUT") return clinicalUpdate(req, user, num(b));
    if (a === "psychology" && method === "GET") return psychologyList(req, user);
    if (a === "psychology" && method === "POST") return psychologyCreate(req, user);
    if (a === "psychology" && b && method === "PUT") return psychologyUpdate(req, user, num(b));
    if (a === "prescriptions" && method === "GET") return prescriptionList(req, user);
    if (a === "prescriptions" && b && c === "dispense" && method === "POST") return dispense(req, user, num(b));
    if (a === "inventory" && b === "medicines" && method === "GET") return inventoryList(user);
    if (a === "inventory" && b === "medicines" && method === "POST") return medicineCreate(req, user);
    if (a === "inventory" && b === "medicines" && c && method === "PUT") return medicineUpdate(req, user, num(c));
    if (a === "inventory" && b === "receive" && method === "POST") return stockReceive(req, user);
    if (a === "inventory" && b === "adjust" && method === "POST") return stockAdjust(req, user);
    if (a === "inventory" && b === "transactions" && method === "GET") return stockHistory(req, user);
    if (a === "invoices" && method === "GET") return invoiceList(req, user);
    if (a === "invoices" && method === "POST") return invoiceCreate(req, user);
    if (a === "invoices" && b && c === "void" && method === "POST") return invoiceVoid(req, user, num(b));
    if (a === "invoices" && b && method === "PUT") return invoiceUpdate(req, user, num(b));
    if (a === "payments" && method === "POST") return paymentCreate(req, user);
    if (a === "payments" && b && c === "reverse" && method === "POST") return paymentReverse(req, user, num(b));
    if (a === "receipts" && method === "GET" && !b) return receiptList(req, user);
    if (a === "receipts" && b && method === "GET") return receiptGet(user, num(b));
    if (a === "expenses" && method === "GET") return expenseList(req, user);
    if (a === "expenses" && method === "POST") return expenseCreate(req, user);
    if (a === "expenses" && b && c === "void" && method === "POST") return expenseVoid(req, user, num(b));
    if (a === "finance" && method === "GET") return financeSummary(req, user);
    if (a === "reports" && b && method === "GET") return report(req, user, b);
    if (a === "documents" && method === "GET" && !b) return documentsCollection(req, user);
    if (a === "documents" && method === "POST") return documentsCreate(req, user);
    if (a === "documents" && b && c === "file" && method === "GET") return documentsFile(req, user, num(b));
    if (a === "documents" && b && c === "archive" && method === "POST") return documentsArchive(req, user, num(b));
    if (a === "settings" && method === "GET") return settingsGet(user);
    if (a === "settings" && method === "PUT") return settingsPut(req, user);
    if (a === "settings" && b === "logo" && method === "POST") return saveLogo(req, user);
    if (a === "settings" && b === "reference" && method === "POST") return referenceSave(req, user);
    if (a === "settings" && b === "quality" && method === "GET") return quality(user);
    if (a === "settings" && b === "clear-demo" && method === "POST") return clearDemo(req, user);
    if (a === "users" && method === "GET") return usersGet(user);
    if (a === "users" && method === "POST") return usersPost(req, user);
    if (a === "users" && b && c === "password" && method === "POST") return resetPassword(req, user, num(b));
    if (a === "users" && b && method === "PUT") return usersPut(req, user, num(b));
    if (a === "roles" && method === "POST") return rolesPost(req, user);
    if (a === "roles" && b && c === "permissions" && method === "PUT") return rolesPerms(req, user, num(b));
    if (a === "audit" && method === "GET") return auditGet(req, user);
    if (a === "override" && method === "POST") return createOverride(req, user);
    if (a === "import" && b === "preview" && method === "POST") return importPreview(req, user);
    if (a === "import" && b === "commit" && method === "POST") return importCommit(req, user);
    throw new ApiError(404, "That action was not found.");
  } catch (error) {
    return errorResponse(error);
  }
}
