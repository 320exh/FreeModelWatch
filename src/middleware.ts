import { NextResponse, type NextRequest } from "next/server";
import { verifyBasicAuth, unauthorizedResponse } from "@/lib/auth";
import { RateLimiter, RATE_LIMIT_OPTIONS, extractClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Explicit matcher: only the admin pages and the six verified public read API
// routes. Deliberately NOT a broad "/api/*" matcher so the excluded admin API
// endpoints (/api/verification-queue, /api/admin/*) are never touched.
export const config = {
  matcher: [
    "/admin/:path*",
    "/api/changes",
    "/api/providers",
    "/api/providers/:id/free-models",
    "/api/models/free",
    "/api/models/:id",
    "/api/harnesses/:id/free-models",
  ],
};

// Module-level singleton limiter (single Next.js process).
const limiter = new RateLimiter(RATE_LIMIT_OPTIONS);
limiter.startSweep();

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Existing admin page authentication — preserved exactly. Covers both the
  // exact "/admin" path and any "/admin/..." subpath (matcher is /admin/:path*).
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const authHeader = request.headers.get("authorization");
    const username = await verifyBasicAuth(authHeader);
    if (!username) {
      // Only challenge real document navigations (address bar, clicked links,
      // curl). Next.js strips its internal prefetch headers (next-router-
      // prefetch/rsc) before middleware runs, so prefetch state is not visible
      // here; however every fetch-style request — including Next.js router
      // prefetches — carries Sec-Fetch-Mode != "navigate". A same-origin fetch
      // receiving a Basic challenge makes the browser pop its native sign-in
      // dialog while the visitor is merely viewing a public page, so those
      // requests get a silent 401 instead. Non-browser clients (curl, smoke
      // tests) send no Sec-Fetch headers and are still challenged.
      const secFetchMode = request.headers.get("sec-fetch-mode");
      const isNavigation = !secFetchMode || secFetchMode === "navigate";
      return unauthorizedResponse(!isNavigation);
    }
    const response = NextResponse.next();
    response.headers.set("x-verified-by", username);
    return response;
  }

  // Defense-in-depth: never rate-limit the excluded admin/verification API
  // endpoints, even if the matcher above were ever expanded.
  if (pathname.startsWith("/api/admin") || pathname === "/api/verification-queue") {
    return NextResponse.next();
  }

  // Public API rate limiting (the six verified GET endpoints).
  const ip = extractClientIp(request.headers);
  if (ip) {
    const result = limiter.limit(ip);
    if (result.limited) {
      return new NextResponse(
        JSON.stringify({ error: "rate limit exceeded", retryAfter: result.retryAfterSec }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(result.retryAfterSec),
          },
        }
      );
    }
  } else {
    // Fail open: the origin is Cloudflare-fronted, so CF-Connecting-IP should
    // always be present. Log once per process start would be ideal; here we log
    // on each such request (exceptional condition, should not occur in prod).
    console.warn(
      "[rate-limit] CF-Connecting-IP header missing; failing open (request not " +
        "rate-limited). Verify the origin is still reachable only through Cloudflare."
    );
  }

  return NextResponse.next();
}
