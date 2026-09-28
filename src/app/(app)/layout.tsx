import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { getSessionUser, getSetting } from "@/server/core";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await ensureSeeded();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const clinic = await getSetting("clinic_name", "SAPA Clinic");
  return <Shell user={user} clinic={clinic}>{children}</Shell>;
}
