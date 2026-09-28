import { errorResponse } from "@/server/core";
import { handleApi } from "@/server/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  try {
    const { path } = await ctx.params;
    return await handleApi(req, path);
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
