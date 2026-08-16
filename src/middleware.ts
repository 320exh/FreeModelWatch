import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyBasicAuth, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";

export const config = {
  matcher: ["/admin/:path*"],
};

export async function middleware(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const username = await verifyBasicAuth(authHeader);
  if (!username) {
    return unauthorizedResponse();
  }
  const response = NextResponse.next();
  response.headers.set("x-verified-by", username);
  return response;
}