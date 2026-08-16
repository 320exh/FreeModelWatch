import { NextRequest, NextResponse } from "next/server";
import { runOpenRouterCollector } from "@/lib/collectors/run";
import { getLastCollectorRuns } from "@/lib/queries";

// NOTE: Administrative mutation endpoint. No auth is implemented yet (see
// CONTRIBUTING.md). Gate this behind real admin auth before production.
// POST  -> run the OpenRouter collector (live unless ?dryRun=1)
// GET   -> last collector runs (read-only status)

export async function POST(req: NextRequest) {
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const report = await runOpenRouterCollector({ dryRun });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ runs: getLastCollectorRuns(20) });
}
