import { NextResponse } from "next/server";
import { getVerificationQueue, detectContradictions, type QueueSeverity } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const p = url.searchParams;
    const severity = (p.get("severity") as QueueSeverity) || "all";
    const provider = p.get("provider")?.trim() || undefined;
    const model = p.get("model")?.trim() || undefined;
    const queue = getVerificationQueue({ provider, model, severity });
    const issues = detectContradictions();
    return NextResponse.json({
      count: queue.length,
      needsVerification: queue.length,
      contradictionCount: issues.length,
      queue,
      contradictions: issues,
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load verification queue", detail: String(err) }, { status: 500 });
  }
}
