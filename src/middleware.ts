import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PAGES = new Set(["/login"]);
const PUBLIC_API = new Set(["/api/health", "/api/auth/login", "/api/branding/logo"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/branding") || pathname.startsWith("/images") || pathname === "/manifest.webmanifest" || pathname === "/sw.js" || pathname === "/favicon.ico") {
    return NextResponse.next();
  }
  const token = request.cookies.get("sapa_session")?.value;
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.has(pathname)) return NextResponse.next();
    if (!token) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    return NextResponse.next();
  }
  if (!token && !PUBLIC_PAGES.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (token && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
