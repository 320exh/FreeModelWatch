import { NextRequest, NextResponse } from "next/server";
import { runGeminiCollector } from "@/lib/collectors/run";
import { getLastCollectorRuns } from "@/lib/queries";
import { verifyBasicAuth, unauthorizedResponse } from "@/lib/auth";

function validateSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");

  if (!host) return false;

  const expectedOrigin = `https://${host}`;

  if (origin && origin === expectedOrigin) return true;
  if (referer && referer.startsWith(expectedOrigin)) return true;

  return false;
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
    const report = await runGeminiCollector({ dryRun });
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