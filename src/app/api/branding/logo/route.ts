import { ensureSeeded } from "@/server/seed";
import { getSetting } from "@/server/core";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    const value = await getSetting("logo_data", "");
    if (value.startsWith("data:image/")) {
      const [meta, data] = value.split(",");
      const mime = meta.match(/data:(.*);base64/)?.[1] || "image/png";
      return new Response(Buffer.from(data, "base64"), {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=300" },
      });
    }
  } catch {
    // Fall through to the bundled mark if the database is not ready.
  }
  return new Response(null, { status: 302, headers: { Location: "/branding/logo.svg" } });
}
