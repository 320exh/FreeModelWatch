import { NextResponse } from "next/server";
import { getChanges } from "@/lib/queries";
import { serializeChange } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500);
    const changes = getChanges(limit);
    return NextResponse.json({ count: changes.length, limit, changes: changes.map(serializeChange) });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load changes", detail: String(err) }, { status: 500 });
  }
}
