import { NextResponse } from "next/server";
import { getAllProviders } from "@/lib/queries";
import { serializeProvider } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const all = getAllProviders();
    return NextResponse.json({
      count: all.length,
      limit,
      offset,
      providers: all.slice(offset, offset + limit).map(serializeProvider),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load providers", detail: String(err) }, { status: 500 });
  }
}
