import { NextRequest, NextResponse } from "next/server";
import { runOpenRouterCollector } from "@/lib/collectors/run";
import { getLastCollectorRuns } from "@/lib/queries";
import { verifyBasicAuth, unauthorizedResponse } from "@/lib/auth";

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function validateSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");

  if (!host) return false;

  const expectedOrigin = `https://${host}`;

  return (
    originOf(req.headers.get("origin")) === expectedOrigin ||
    originOf(req.headers.get("referer")) === expectedOrigin
  );
}

export async function POST(req: NextRequest) {
  const username = await verifyBasicAuth(req.headers.get("authorization"));
  if (!username) {
    return unauthorizedResponse();
  }

  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "CSRF validation failed: invalid origin" },
      { status: 403 }
    );
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const report = await runOpenRouterCollector({ dryRun });
    return NextResponse.json({ ok: report.status !== "failed", report });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const username = await verifyBasicAuth(req.headers.get("authorization"));
  if (!username) {
    return unauthorizedResponse();
  }
  return NextResponse.json({ runs: getLastCollectorRuns(20) });
}