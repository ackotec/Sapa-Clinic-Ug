export type SessionUser = {
  id: number;
  name: string;
  username: string;
  staffCode: string;
  email: string | null;
  phone: string | null;
  role: string;
  roleName: string;
  department: string | null;
  specialty: string | null;
  permissions: string[];
  lastLogin: string | null;
};

export type PatientBrief = {
  id: number;
  patientNumber: string;
  fullName: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
  phone: string | null;
  status: string;
  caseType: string | null;
  isDemo?: boolean;
};
