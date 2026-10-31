import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decide } from "./lib/auth";

/**
 * Auth gate (Next.js 16 "proxy", formerly middleware). When NEXUS_ACCESS_TOKEN
 * is set, every page and Server Action POST needs a valid session cookie;
 * pages redirect to /login, other requests get 401. Server Actions also check
 * on their own (lib/authServer.ts), so this is defence in depth.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  // The public API and the MCP endpoint authenticate with scoped API keys
  // (lib/apiAuth.ts), not the UI session cookie; their handlers enforce that.
  if (pathname.startsWith("/api/v1/") || pathname === "/api/mcp") return NextResponse.next();
  const decision = await decide(process.env, request.cookies.get(SESSION_COOKIE)?.value);
  if (decision !== "login_required") return NextResponse.next();
  if (request.method === "GET" || request.method === "HEAD") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return new NextResponse("Unauthorized", { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
