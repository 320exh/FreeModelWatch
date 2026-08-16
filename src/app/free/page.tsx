import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { AccessBadge, FreshnessBadge, ConfidenceBadge, StatusIcon } from "@/components/ui";
import { getAllProviders, getAllHarnesses } from "@/lib/queries";
import { buildFreeAccessRoutes, filterFreeAccessRoutes, type RouteFilters } from "@/lib/intelligence";
import { ACCESS_SHORT, FRESHNESS_EMOJI_LABEL, PAYMENT_LABELS, daysAgo } from "@/lib/format";
import type { AccessType, VerificationConfidence, FreshnessTier } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Free Right Now — All Free AI Access Routes",
  description: "Every currently-free way to use AI models: direct APIs, aggregators, harnesses, and local runtimes. Filter by access type, capability, no-card requirement, and freshness.",
};

const KNOWN_ACCESS: AccessType[] = [
  "completely_free", "free_tier", "free_credits", "free_with_limits",
  "free_through_aggregator", "free_local", "temporarily_free", "community_unofficial", "direct_api", "free_through_harness",
];
const KNOWN_CONF: VerificationConfidence[] = ["verified", "likely", "unverified", "stale"];
const KNOWN_FRESH: FreshnessTier[] = ["live_verified", "likely", "unverified", "seed_demo", "stale", "expired", "unavailable"];

function csv<T extends string>(v: string | null, allowed: T[]): T[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean) as T[];
  const f = parts.filter((p) => allowed.includes(p));
  return f.length ? f : undefined;
}
function booly(v: string | null): boolean | undefined {
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}
function num(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default async function FreePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) ?? null;

  const filters: RouteFilters = {
    q: get("q")?.trim() || undefined,
    access: csv<AccessType>(get("access"), KNOWN_ACCESS),
    verified: csv<VerificationConfidence>(get("verified"), KNOWN_CONF),
    freshness: csv<FreshnessTier>(get("freshness"), KNOWN_FRESH),
    provider: get("provider") ? get("provider")!.split(",").filter(Boolean) : undefined,
    harness: get("harness")?.trim() || undefined,
    coding: booly(get("coding")) ?? false,
    reasoning: booly(get("reasoning")) ?? false,
    vision: booly(get("vision")) ?? false,
    toolCalling: booly(get("toolCalling")) ?? false,
    longContext: booly(get("longContext")) ?? false,
    openSource: booly(get("openSource")) ?? false,
    noCard: booly(get("nopay")) ?? false,
    noSignup: booly(get("nosignup")) ?? false,
    apiKeyRequired: get("apikey") ? (booly(get("apikey")) ?? null) : null,
    minContext: num(get("minctx")),
  };

  const allRoutes = buildFreeAccessRoutes();
  let routes = filterFreeAccessRoutes(allRoutes, filters);
  routes = routes.sort((a, b) => b.qualityScore.total - a.qualityScore.total);

  const providers = getAllProviders();
  const harnesses = getAllHarnesses();
  const totalFree = allRoutes.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Free Right Now</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px] max-w-3xl">
          Every currently-free route to use an AI model — across direct APIs, aggregators, coding harnesses, and local runtimes.
          <span className="text-[var(--fg)]"> {routes.length}</span> of {totalFree} free routes match your filters.
          Each route shows how it is free, its limits, freshness, and the evidence behind it.
        </p>
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
        <FilterBar providers={providers} harnesses={harnesses} />

        <div className="flex flex-col gap-3">
          {routes.length === 0 ? (
            <div className="card p-10 text-center text-[var(--fg-dim)]">No free routes match these filters.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {routes.map((r) => (
                <div key={r.routeId} className="card p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <StatusIcon status={r.status} />
                      <Link href={`/models/${r.modelId}`} className="font-semibold hover:text-[var(--accent)]">{r.modelName}</Link>
                      <span className="text-[12px] text-[var(--fg-mute)]">via</span>
                      <Link href={`/providers/${r.providerId}`} className="text-[13px] hover:text-[var(--accent)]">{r.providerName}</Link>
                      <AccessBadge type={r.accessType} short />
                      <FreshnessBadge tier={r.freshness} />
                      <ConfidenceBadge conf={r.verificationConfidence} />
                      <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }} title="Access Quality Score">
                        Q {r.qualityScore.total}
                      </span>
                    </div>
                    <span className="text-[12px] text-[var(--fg-mute)]">{FRESHNESS_EMOJI_LABEL[r.freshness]}</span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12.5px]">
                    <Field label="Free allowance" value={r.freeQuotaText} />
                    <Field label="Payment" value={PAYMENT_LABELS[r.paymentRequirement]} warn={r.paymentRequirement === "unknown"} />
                    <Field label="Access" value={[r.requiresApiKey ? "API key" : "No key", r.requiresSignup ? "Signup" : "No signup"].join(" · ")} />
                    <Field label="Context" value={r.tokenLimit ? r.tokenLimit.toLocaleString() : "Unknown"} />
                    <Field label="Capabilities" value={capabilitiesLabel(r)} />
                    <Field label="Harnesses" value={r.harnessCompatible.length ? r.harnessCompatible.join(", ") : "Unknown"} />
                    <Field label="API format" value={apiFormatLabel(r.accessType)} />
                    <Field label="Last checked" value={daysAgo(r.lastVerifiedAt)} />
                  </div>

                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-[var(--fg-dim)] select-none">Why is this free? & evidence</summary>
                    <div className="mt-2 text-[var(--fg-dim)] leading-relaxed">{r.explanation}</div>
                    <div className="mt-1 text-[11px] text-[var(--fg-mute)]">
                      Provenance: {r.provenance.collectorId ? `live collector (${r.provenance.collectorId})` : r.provenance.sourceUrl ? "linked source" : "no linked source"} · verified by {r.provenance.verifiedBy ?? "—"} · {r.sourceCount} source(s)
                    </div>
                    {r.provenance.sourceUrl && (
                      <a href={r.provenance.sourceUrl} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--accent)] hover:underline">
                        {r.provenance.sourceTitle ?? r.provenance.sourceUrl} ↗
                      </a>
                    )}
                    {r.qualityScore.unknownFlags.length > 0 && (
                      <div className="mt-1 text-[11px] text-[#fb923c]">Uncertainty: {r.qualityScore.unknownFlags.join(", ")}</div>
                    )}
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function capabilitiesLabel(r: { codingCapability: number | null; visionSupport: boolean; reasoningSupport: boolean; toolCalling: boolean }): string {
  const chips: string[] = [];
  if (r.codingCapability) chips.push(`C${r.codingCapability}`);
  if (r.visionSupport) chips.push("Vision");
  if (r.reasoningSupport) chips.push("Reasoning");
  if (r.toolCalling) chips.push("Tools");
  return chips.length ? chips.join(" · ") : "—";
}

function apiFormatLabel(a: AccessType): string {
  if (a === "direct_api") return "Direct";
  if (a === "free_through_aggregator") return "Aggregator";
  if (a === "free_local") return "Local";
  if (a === "free_through_harness") return "Harness";
  return "—";
}

function Field({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-mute)]">{label}</span>
      <span className="mono text-[var(--fg)]" style={warn ? { color: "#fbbf24" } : undefined}>{value}</span>
    </div>
  );
}
