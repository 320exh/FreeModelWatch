import { NextResponse } from "next/server";
import { queryModels, getAllProviders, getAllHarnesses, type ModelFilters, type ModelView } from "@/lib/queries";
import { serializeModelView } from "@/lib/api";
import type { AccessType, VerificationConfidence, FreshnessTier } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_ACCESS: AccessType[] = [
  "completely_free", "free_tier", "free_credits", "free_with_limits",
  "free_through_aggregator", "free_through_harness", "free_local", "temporarily_free", "community_unofficial", "direct_api",
];
const KNOWN_CONF: VerificationConfidence[] = ["verified", "likely", "unverified", "stale"];

function csv<T extends string>(v: string | null, allowed: T[]): T[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean) as T[];
  const filtered = parts.filter((p) => allowed.includes(p));
  return filtered.length ? filtered : undefined;
}

function toNum(v: string | null): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function boolParam(v: string | null): boolean | undefined {
  if (v == null) return undefined;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

export function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const p = url.searchParams;

    const limit = Math.min(Math.max(toNum(p.get("limit")) ?? 50, 1), 200);
    const offset = Math.max(toNum(p.get("offset")) ?? 0, 0);

    const filters: ModelFilters = {
      q: p.get("q")?.trim() || undefined,
      access: csv<AccessType>(p.get("access"), KNOWN_ACCESS),
      verified: csv<VerificationConfidence>(p.get("verified"), KNOWN_CONF),
      coding: boolParam(p.get("coding")) ?? false,
      reasoning: boolParam(p.get("reasoning")) ?? false,
      vision: boolParam(p.get("vision")) ?? false,
      toolCalling: boolParam(p.get("toolCalling")) ?? false,
      structuredOutput: boolParam(p.get("structuredOutput")) ?? false,
      longContext: boolParam(p.get("longContext")) ?? false,
      openSource: boolParam(p.get("openSource")) ?? false,
      provider: p.get("provider")?.split(",").map((s) => s.trim()).filter(Boolean) || undefined,
      harness: p.get("harness")?.trim() || undefined,
      noPayment: boolParam(p.get("noPayment")) ?? boolParam(p.get("noCard")) ?? false,
      noSignup: boolParam(p.get("noSignup")) ?? false,
      apiKeyRequired: p.get("apiKeyRequired") ? (boolParam(p.get("apiKeyRequired")) ?? null) : null,
      minContext: toNum(p.get("minContext")),
      sort: (p.get("sort") as ModelFilters["sort"]) || "relevance",
    };

    const all = queryModels(filters);
    const page = all.slice(offset, offset + limit);

    const freshnessBuckets: Record<FreshnessTier, number> = {
      live_verified: 0, likely: 0, unverified: 0, seed_demo: 0, stale: 0, expired: 0, unavailable: 0,
    };
    for (const m of all) freshnessBuckets[m.bestFreshness]++;

    const activeFilters = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined && v !== false && v !== "" && !(Array.isArray(v) && v.length === 0))
    );

    return NextResponse.json({
      count: all.length,
      limit,
      offset,
      filters: activeFilters,
      freshness: freshnessBuckets,
      note: "Routes with dataOrigin 'seed' are demo data and are NOT live-verified. Check the `freshness` field per route.",
      models: page.map(serializeModelView),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to query models", detail: String(err) }, { status: 500 });
  }
}
