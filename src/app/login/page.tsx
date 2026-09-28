import { Suspense } from "react";
import { ensureSeeded } from "@/server/seed";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await ensureSeeded();
  return (
    <Suspense fallback={<main className="page">Loading sign in…</main>}>
      <LoginForm />
    </Suspense>
  );
}
