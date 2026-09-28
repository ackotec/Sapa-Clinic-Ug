export class ClientError extends Error {
  status: number;
  fields?: Record<string, string>;
  duplicates?: { id: number; patientNumber: string; fullName: string; phone?: string; dateOfBirth?: string | null; gender?: string | null; status?: string }[];
  constructor(message: string, status: number, extra?: { fields?: Record<string, string>; duplicates?: ClientError["duplicates"] }) {
    super(message);
    this.status = status;
    this.fields = extra?.fields;
    this.duplicates = extra?.duplicates;
  }
}

export async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new ClientError(data.error || "The request could not be completed.", response.status, data);
  return data as T;
}

export function money(amount: number | null | undefined, currency = "UGX") {
  return `${currency} ${new Intl.NumberFormat("en-UG").format(Number(amount || 0))}`;
}

export function ageLabel(age: number | null | undefined) {
  if (age == null) return "Age not recorded";
  return `${age} years`;
}
