import { NextResponse } from "next/server";
import { getVerificationQueue, detectContradictions, type QueueSeverity } from "@/lib/queries";
import { verifyBasicAuth, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const username = await verifyBasicAuth(req.headers.get("authorization"));
  if (!username) {
    return unauthorizedResponse();
  }
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
