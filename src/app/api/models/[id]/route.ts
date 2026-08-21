import { NextResponse } from "next/server";
import { getModelView, scoreModel } from "@/lib/queries";
import { serializeModelView } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const m = getModelView(id);
    if (!m) return NextResponse.json({ error: "Model not found" }, { status: 404 });
    const { harnessCompat, sources, changes, ...view } = m;
    return NextResponse.json({
      ...serializeModelView(view),
      score: scoreModel(view),
      harnessCompat,
      sources,
      changes,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  }
}
