import { NextResponse } from "next/server";
import { getChanges } from "@/lib/queries";
import { getCategorizedChanges, CHANGE_CATEGORY_META } from "@/lib/intelligence";
import type { ChangeCategory } from "@/lib/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500);
    const category = url.searchParams.get("category") as ChangeCategory | null;
    const provider = url.searchParams.get("provider")?.trim() || null;
    const model = url.searchParams.get("model")?.trim() || null;

    const changes = getChanges(limit);
    const categorized = getCategorizedChanges(changes);

    const filtered = categorized.filter((c) => {
      if (category && c.category !== category) return false;
      if (provider && c.providerId && c.providerId !== provider) return false;
      if (model && c.modelId && c.modelId !== model) return false;
      return true;
    });

    const counts = categorized.reduce<Record<string, number>>((acc, c) => {
      acc[c.category] = (acc[c.category] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      count: filtered.length,
      limit,
      filters: { category, provider, model },
      categories: Object.keys(CHANGE_CATEGORY_META),
      categoryCounts: counts,
      changes: filtered.map((c) => ({
        id: c.id,
        category: c.category,
        entityId: c.entityId,
        entityName: c.entityName,
        fieldChanged: c.fieldChanged,
        oldValue: c.oldValue,
        newValue: c.newValue,
        detectedAt: c.detectedAt,
        verifiedAt: c.verifiedAt,
        notes: c.notes,
        sourceUrl: c.sourceUrl,
        scope: c.scope,
        providerId: c.providerId,
        modelId: c.modelId,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load changes", detail: String(err) }, { status: 500 });
  }
}
