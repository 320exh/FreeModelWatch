import {
  loadGraph,
  classifyFreshness,
  getAllHarnesses,
  getChanges,
  getHarnessCompat,
  getLastCollectorRuns,
  detectContradictions,
  type Graph,
  type ModelView,
} from "./queries";
import type {
  Availability,
  Model,
  Source,
  AccessType,
  AvailabilityStatus,
  VerificationConfidence,
  FreshnessTier,
  DataOrigin,
  PaymentRequirement,
  ChangeHistory,
  ProviderCategory,
} from "./types";
import { ACCESS_WHY } from "./format";

// ===========================================================================
// Unified Free Access Route — the single representation used by /free, the
// provider-comparison table, the recommendation engine, and the public API.
//
// It deliberately distinguishes *forms* of free access (req 1) and NEVER
// collapses an unknown value into a concrete one (req 18).
// ===========================================================================

export interface RouteQualityScore {
  total: number;
  freeCostQuality: number;
  quotaQuality: number;
  capability: number;
  freshness: number;
  sourceReliability: number;
  availability: number;
  paymentRequirement: number;
  accessConvenience: number;
  /** Which components were penalized because the underlying data is unknown. */
  unknownFlags: string[];
}

export interface FreeAccessRoute {
  routeId: string;
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  providerCategory: ProviderCategory;
  accessType: AccessType;
  status: AvailabilityStatus;
  isFree: boolean;

  freePricing: string;
  freeQuotaText: string;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  tokenLimit: number | null;

  codingCapability: number | null;
  visionSupport: boolean;
  reasoningSupport: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  isOpenSource: boolean;

  requiresApiKey: boolean;
  paymentRequirement: PaymentRequirement;
  requiresSignup: boolean;
  geographicRestrictions: string[];
  geoRestrictionsKnown: boolean;

  harnessCompatible: string[];

  freshness: FreshnessTier;
  dataOrigin: DataOrigin;
  verificationConfidence: VerificationConfidence;
  sourceQuality: VerificationConfidence;
  sourceCount: number;
  lastVerifiedAt: string | null;
  expiresAt: string | null;

  qualityScore: RouteQualityScore;
  explanation: string;

  provenance: {
    sourceUrl: string | null;
    sourceTitle: string | null;
    collectorId: string | null;
    verifiedBy: string | null;
    lastVerifiedAt: string | null;
  };
}

function paymentRequirementOf(a: Availability): PaymentRequirement {
  if (!a.paymentRequirementKnown) return "unknown";
  return a.requiresPaymentMethod ? "required" : "not_required";
}

const REL_RANK: Record<VerificationConfidence, number> = {
  verified: 3,
  likely: 2,
  unverified: 0,
  stale: 0,
};

// ---------------------------------------------------------------------------
// Build the full set of currently-free access routes from the graph.
// ---------------------------------------------------------------------------

let _routeCache: FreeAccessRoute[] | null = null;
let _modelCache: Map<string, Model> | null = null;

export function buildFreeAccessRoutes(force = false): FreeAccessRoute[] {
  if (_routeCache && !force) return _routeCache;
  const g = loadGraph();
  _modelCache = g.modelMap;
  const harnesses = getAllHarnesses();
  const harnessById = new Map(harnesses.map((h) => [h.id, h]));
  const hc = getHarnessCompat();

  const hcByModel = new Map<string, typeof hc>();
  for (const c of hc) {
    if (!hcByModel.has(c.modelId)) hcByModel.set(c.modelId, []);
    hcByModel.get(c.modelId)!.push(c);
  }

  const out: FreeAccessRoute[] = [];
  for (const [modelId, avails] of g.availByModel) {
    const m = g.modelMap.get(modelId);
    if (!m) continue;
    for (const a of avails) {
      if (!isFreeAccessLocal(a)) continue;
      const p = g.providerMap.get(a.providerId);
      if (!p) continue;
      const sources = g.sourcesByAvail.get(a.id) ?? [];
      const fresh = classifyFreshness(a);
      const harnessCompatible = (hcByModel.get(modelId) ?? [])
        .filter((c) => (c.providerId === null || c.providerId === a.providerId) && c.freeStatus === "free")
        .map((c) => harnessById.get(c.harnessId)?.name ?? c.harnessId);
      const dedupHarness = Array.from(new Set(harnessCompatible));
      const route: FreeAccessRoute = {
        routeId: a.id,
        modelId,
        modelName: m.name,
        providerId: a.providerId,
        providerName: p.name,
        providerCategory: p.category,
        accessType: a.accessType,
        status: a.status,
        isFree: true,
        freePricing: freePricingText(a),
        freeQuotaText: freeQuotaText(a),
        rateLimitRpm: a.rateLimitRpm,
        rateLimitTpm: a.rateLimitTpm,
        dailyLimit: a.dailyLimit,
        monthlyLimit: a.monthlyLimit,
        tokenLimit: m.contextWindow,
        codingCapability: m.codingCapability,
        visionSupport: m.visionSupport,
        reasoningSupport: m.reasoningSupport,
        toolCalling: m.toolCalling,
        structuredOutput: m.structuredOutput,
        isOpenSource: m.isOpenSource,
        requiresApiKey: a.requiresApiKey,
        paymentRequirement: paymentRequirementOf(a),
        requiresSignup: a.requiresSignup,
        geographicRestrictions: a.geographicRestrictions,
        geoRestrictionsKnown: a.geographicRestrictions.length > 0 || a.accessType === "free_local",
        harnessCompatible: dedupHarness,
        freshness: fresh,
        dataOrigin: a.dataOrigin ?? "seed",
        verificationConfidence: a.verificationConfidence,
        sourceQuality: bestSourceReliability(sources),
        sourceCount: sources.length + (a.sourceUrl ? 1 : 0),
        lastVerifiedAt: a.lastVerifiedAt,
        expiresAt: a.expiresAt ?? null,
        qualityScore: scoreRouteQuality(a, m, fresh, sources),
        explanation: "",
        provenance: {
          sourceUrl: a.sourceUrl,
          sourceTitle: a.sourceTitle,
          collectorId: a.dataOrigin === "live_collector" ? a.providerId : null,
          verifiedBy: a.verifiedBy ?? null,
          lastVerifiedAt: a.lastVerifiedAt,
        },
      };
      route.explanation = explainRoute(route, m, sources);
      out.push(route);
    }
  }
  _routeCache = out;
  return out;
}

export function invalidateRouteCache(): void {
  _routeCache = null;
  _modelCache = null;
}

function isFreeAccessLocal(a: Availability): boolean {
  if (!a.isActive) return false;
  return ["available", "limited", "degraded", "temporarily_free"].includes(a.status);
}

function bestSourceReliability(sources: Source[]): VerificationConfidence {
  const known = sources.filter((s) => (s.reliability ?? "unknown") !== "unknown");
  if (known.length === 0) return "unverified";
  let best = "unverified" as VerificationConfidence;
  for (const s of known) {
    if (REL_RANK[s.reliability as VerificationConfidence] > REL_RANK[best]) best = s.reliability as VerificationConfidence;
  }
  return best;
}

function freePricingText(a: Availability): string {
  const free =
    a.accessType === "free_local" ||
    a.accessType === "completely_free" ||
    (a.inputPricePerMillion === 0 && a.outputPricePerMillion === 0) ||
    ["free_tier", "free_credits", "free_with_limits", "free_through_aggregator", "free_through_harness", "temporarily_free"].includes(a.accessType);
  return free ? "Free ($0)" : "Paid";
}

function freeQuotaText(a: Availability): string {
  const parts: string[] = [];
  if (a.accessType === "free_local") {
    return "No hosted provider quota (runs locally)";
  }
  if (a.dailyLimit) parts.push(`${a.dailyLimit.toLocaleString()} req/day`);
  if (a.monthlyLimit) parts.push(`${a.monthlyLimit.toLocaleString()} tok/month`);
  if (a.freeQuotaValue != null && a.freeQuotaUnit) {
    const unit = a.freeQuotaUnit;
    const period = a.freeQuotaPeriod ? `/${a.freeQuotaPeriod}` : "";
    parts.push(`${a.freeQuotaValue.toLocaleString()} ${unit}${period}`);
  }
  if (a.rateLimitTpm) parts.push(`${a.rateLimitTpm.toLocaleString()} TPM`);
  if (a.rateLimitRpm) parts.push(`${a.rateLimitRpm}/min`);
  return parts.length ? parts.join(" · ") : "Unknown";
}

function modelCapabilityCache(modelId: string): Model | undefined {
  if (!_modelCache) _modelCache = loadGraph().modelMap;
  return _modelCache?.get(modelId);
}

// ---------------------------------------------------------------------------
// Transparent Access Quality Score (req 5). Unknown data is penalized, never
// treated as zero OR as unlimited. The raw number of providers/routes does NOT
// feed this score (it is per-route).
// ---------------------------------------------------------------------------

const QUALITY_ACCESS: Record<AccessType, number> = {
  completely_free: 18,
  free_local: 18,
  free_tier: 15,
  direct_api: 15,
  free_through_harness: 12,
  free_through_aggregator: 12,
  free_credits: 12,
  free_with_limits: 8,
  temporarily_free: 6,
  community_unofficial: 4,
};

export function scoreRouteQuality(
  a: Availability,
  m: Model,
  fresh: FreshnessTier,
  sources: Source[]
): RouteQualityScore {
  const unknownFlags: string[] = [];
  let freeCostQuality = QUALITY_ACCESS[a.accessType] ?? 8;

  // Quota quality. Unknown quota => low (NOT unlimited).
  let quotaQuality = 4;
  const hasQuota =
    a.dailyLimit != null || a.monthlyLimit != null || (a.freeQuotaValue != null && a.freeQuotaUnit) || a.rateLimitTpm != null || a.rateLimitRpm != null;
  if (hasQuota) {
    let maxN = 0;
    if (a.dailyLimit) maxN = Math.max(maxN, a.dailyLimit);
    else if (a.monthlyLimit) maxN = Math.max(maxN, a.monthlyLimit / 30);
    else if (a.freeQuotaValue && a.freeQuotaUnit === "requests") {
      const mult = a.freeQuotaPeriod === "day" ? 1 : a.freeQuotaPeriod === "minute" ? 1440 : 1;
      maxN = Math.max(maxN, (a.freeQuotaValue ?? 0) * mult);
    } else if (a.freeQuotaValue && a.freeQuotaUnit === "dollars") {
      maxN = Math.max(maxN, 500);
    } else if (a.rateLimitTpm) maxN = Math.max(maxN, a.rateLimitTpm / 30);
    else if (a.rateLimitRpm) maxN = Math.max(maxN, a.rateLimitRpm * 1440);
    quotaQuality = Math.min(16, 4 + Math.log10(Math.max(10, maxN)) * 3.2);
  } else if (a.accessType === "free_local") {
    quotaQuality = 12; // local = effectively unbounded by a provider quota
  } else {
    unknownFlags.push("quota_unknown");
    quotaQuality = 4; // unknown, not unlimited
  }

  const capability =
    Math.min(16, ((m.codingCapability ?? 0) * 1.4) + (m.reasoningSupport ? 3 : 0) + (m.visionSupport ? 2 : 0) + (m.toolCalling ? 1 : 0));

  const freshRank: Record<FreshnessTier, number> = {
    live_verified: 16,
    likely: 11,
    unverified: 3,
    seed_demo: 4,
    stale: 0,
    expired: 0,
    unavailable: 0,
  };
  let freshness = freshRank[fresh] ?? 0;
  if (fresh === "stale" || fresh === "seed_demo" || fresh === "unverified") unknownFlags.push("freshness_weak");

  const srcRel = sources.length === 0 && !a.sourceUrl ? "unverified" : bestSourceReliability(sources);
  const sourceReliability = srcRel === "verified" ? 12 : srcRel === "likely" ? 8 : 2;
  if (sources.length === 0 && !a.sourceUrl) unknownFlags.push("no_source");

  const statusRank: Record<string, number> = {
    available: 12,
    limited: 8,
    degraded: 4,
    temporarily_free: 8,
    unknown: 4,
    unavailable: 0,
  };
  const availability = statusRank[a.status] ?? 4;

  // Payment: known + not required is good; known + required is bad; unknown is
  // neutral (we do not reward "we don't know if there's a card wall").
  let paymentRequirement = 0;
  if (a.paymentRequirementKnown && !a.requiresPaymentMethod) paymentRequirement = 10;
  else if (a.paymentRequirementKnown && a.requiresPaymentMethod) paymentRequirement = -6;
  else unknownFlags.push("payment_unknown");

  // Access convenience: no API key and no signup is most convenient.
  let accessConvenience = 4;
  if (!a.requiresApiKey) accessConvenience += 4;
  if (!a.requiresSignup) accessConvenience += 4;
  if (a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()) accessConvenience -= 6;

  const total = Math.round(
    Math.max(0, freeCostQuality + quotaQuality + capability + freshness + sourceReliability + availability + paymentRequirement + accessConvenience)
  );
  return {
    total: Math.min(100, total),
    freeCostQuality: Math.round(freeCostQuality),
    quotaQuality: Math.round(quotaQuality),
    capability: Math.round(capability),
    freshness: Math.round(freshness),
    sourceReliability: Math.round(sourceReliability),
    availability: Math.round(availability),
    paymentRequirement: Math.round(paymentRequirement),
    accessConvenience: Math.round(accessConvenience),
    unknownFlags,
  };
}

// ---------------------------------------------------------------------------
// Human-readable route explanation (req 10). Always states unknowns.
// ---------------------------------------------------------------------------

export function explainRoute(route: FreeAccessRoute, m: Model, sources: Source[]): string {
  const bits: string[] = [];
  bits.push(ACCESS_WHY[route.accessType]);

  if (route.freeQuotaText === "Unknown" && route.accessType !== "free_local") {
    bits.push("Provider-specific usage limits (rate / request / token caps) were not specified by the source and are therefore displayed as unknown, not unlimited.");
  } else if (route.freeQuotaText !== "Unknown") {
    bits.push(`Free allowance: ${route.freeQuotaText}.`);
  }

  if (route.paymentRequirement === "not_required") {
    bits.push("No payment method / credit card is required (confirmed by the source).");
  } else if (route.paymentRequirement === "required") {
    bits.push("A payment method is required.");
  } else {
    bits.push("Whether a credit card or payment method is required is unknown — the source does not state it.");
  }

  if (!route.requiresApiKey && !route.requiresSignup) bits.push("No API key and no signup needed.");
  else if (!route.requiresApiKey) bits.push("No API key needed.");
  else if (!route.requiresSignup) bits.push("No signup needed (API key required).");

  if (route.geoRestrictionsKnown && route.geographicRestrictions.length === 0) bits.push("No geographic restriction recorded.");
  else if (route.geoRestrictionsKnown && route.geographicRestrictions.length) bits.push(`Geographic restrictions: ${route.geographicRestrictions.join(", ")}.`);
  else if (route.accessType !== "free_local") bits.push("Geographic availability is unknown.");

  if (route.dataOrigin === "seed") bits.push("This is demo/seed data, not a live-verified claim.");
  else if (route.dataOrigin === "live_collector") bits.push(`Imported by the ${route.providerName} live collector; last checked ${route.lastVerifiedAt ?? "unknown"}.`);
  if (route.sourceCount === 0 && !route.provenance.sourceUrl) bits.push("No linked source — treat as unverified.");

  return bits.join(" ");
}

// ---------------------------------------------------------------------------
// Filtering for /free and the API (req 7, 8, 17).
// ---------------------------------------------------------------------------

export interface RouteFilters {
  q?: string;
  access?: AccessType[];
  provider?: string[];
  harness?: string;
  coding?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  toolCalling?: boolean;
  longContext?: boolean;
  openSource?: boolean;
  noCard?: boolean;
  noSignup?: boolean;
  apiKeyRequired?: boolean | null;
  minContext?: number;
  verified?: VerificationConfidence[];
  freshness?: FreshnessTier[];
  freeOnly?: boolean;
}

export function filterFreeAccessRoutes(routes: FreeAccessRoute[], f: RouteFilters): FreeAccessRoute[] {
  let out = routes;
  if (f.freeOnly !== false) out = out.filter((r) => r.isFree);
  if (f.q) {
    const q = f.q.toLowerCase();
    out = out.filter(
      (r) =>
        r.modelName.toLowerCase().includes(q) ||
        r.providerName.toLowerCase().includes(q) ||
        r.modelId.toLowerCase().includes(q) ||
        r.accessType.toLowerCase().includes(q)
    );
  }
  if (f.access?.length) out = out.filter((r) => f.access!.includes(r.accessType));
  if (f.provider?.length) out = out.filter((r) => f.provider!.includes(r.providerId));
  if (f.verified?.length) out = out.filter((r) => f.verified!.includes(r.verificationConfidence));
  if (f.freshness?.length) out = out.filter((r) => f.freshness!.includes(r.freshness));
  if (f.coding) out = out.filter((r) => (modelCapabilityCache(r.modelId)?.codingCapability ?? 0) >= 4);
  if (f.reasoning) out = out.filter((r) => modelCapabilityCache(r.modelId)?.reasoningSupport);
  if (f.vision) out = out.filter((r) => modelCapabilityCache(r.modelId)?.visionSupport);
  if (f.toolCalling) out = out.filter((r) => modelCapabilityCache(r.modelId)?.toolCalling);
  if (f.longContext) out = out.filter((r) => (r.tokenLimit ?? 0) >= 100000);
  if (f.openSource) out = out.filter((r) => modelCapabilityCache(r.modelId)?.isOpenSource);
  if (f.minContext) out = out.filter((r) => (r.tokenLimit ?? 0) >= f.minContext!);
  if (f.noCard) out = out.filter((r) => r.paymentRequirement === "not_required");
  if (f.noSignup) out = out.filter((r) => !r.requiresSignup);
  if (f.apiKeyRequired === true) out = out.filter((r) => r.requiresApiKey);
  if (f.apiKeyRequired === false) out = out.filter((r) => !r.requiresApiKey);
  if (f.harness) out = out.filter((r) => r.harnessCompatible.some((h) => h.toLowerCase().includes(f.harness!.toLowerCase())));
  return out;
}

// ---------------------------------------------------------------------------
// Recommendation engine (req 4) — transparent: returns why each route matched
// and why it ranked where it did.
// ---------------------------------------------------------------------------

export type Priority = "coding" | "reasoning" | "vision" | "longContext" | "general";

export interface RecommendRequirements {
  priority: Priority;
  prioritizeNoCard?: boolean;
  prioritizeNoSignup?: boolean;
  prioritizeNoApiKey?: boolean;
  openSourceOnly?: boolean;
  contextMin?: number;
  harness?: string;
  q?: string;
  limit?: number;
}

export interface RecommendedRoute {
  routeId: string;
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  accessType: AccessType;
  status: AvailabilityStatus;
  matchScore: number;
  matchReasons: string[];
  rankReasons: string[];
}

export function recommendFreeAccess(req: RecommendRequirements): RecommendedRoute[] {
  const routes = buildFreeAccessRoutes().filter((r) => r.isFree);
  const harnesses = getAllHarnesses();
  const harnessName = req.harness ? (harnesses.find((h) => h.id === req.harness)?.name ?? req.harness) : null;
  const results: RecommendedRoute[] = [];

  for (const r of routes) {
    const matchReasons: string[] = [];
    const rankReasons: string[] = [];
    let score = 0;
    let matched = true;

    if (req.q) {
      const q = req.q.toLowerCase();
      if (r.modelName.toLowerCase().includes(q) || r.providerName.toLowerCase().includes(q)) matchReasons.push(`Name/model matches "${req.q}".`);
      else matched = false;
    }

    // Hard requirement filters (a non-match excludes the route).
    if (req.prioritizeNoCard && r.paymentRequirement === "required") { matched = false; matchReasons.push("Requires a card — excluded by your no-card filter."); }
    if (req.prioritizeNoSignup && r.requiresSignup) { matched = false; matchReasons.push("Requires signup — excluded by your no-signup filter."); }
    if (req.prioritizeNoApiKey && r.requiresApiKey) { matched = false; matchReasons.push("Requires an API key — excluded by your no-key filter."); }
    if (req.openSourceOnly && !r.isOpenSource) { matched = false; matchReasons.push("Not open source — excluded by your open-source filter."); }
    if (req.contextMin && (r.tokenLimit ?? 0) < req.contextMin) { matched = false; matchReasons.push(`Context ${r.tokenLimit?.toLocaleString() ?? "?"} < ${req.contextMin.toLocaleString()} — excluded.`); }
    if (req.harness) {
      const ok = r.harnessCompatible.some((h) => h === req.harness || (harnessName && h === harnessName));
      if (!ok) { matched = false; matchReasons.push(`Not confirmed for harness ${harnessName ?? req.harness}.`); }
    }

    // Priority-based scoring boosts.
    const cap = modelCapabilityCache(r.modelId);
    if (req.priority === "coding") {
      if ((cap?.codingCapability ?? 0) >= 4) { score += 24; matchReasons.push(`Coding-capable (${cap?.codingCapability}/5).`); }
      else score -= 6;
    }
    if (req.priority === "reasoning") {
      if (cap?.reasoningSupport) { score += 18; matchReasons.push("Reasoning supported."); }
      else score -= 4;
    }
    if (req.priority === "vision") {
      if (r.visionSupport) { score += 16; matchReasons.push("Vision/multimodal supported."); }
      else score -= 4;
    }
    if (req.priority === "longContext") {
      if ((r.tokenLimit ?? 0) >= 100000) { score += 14; matchReasons.push(`Long context (${r.tokenLimit?.toLocaleString()} tokens).`); }
      else score -= 4;
    }
    if (req.priority === "general" && (cap?.codingCapability ?? 0) >= 4) {
      score += 6; matchReasons.push(`Capable model (coding ${cap?.codingCapability}/5).`);
    }

    if (!matched) continue;

    const q = r.qualityScore;
    score += q.total * 0.5;
    if (q.freeCostQuality >= 15) rankReasons.push("High free-cost quality.");
    if (q.quotaQuality >= 12) rankReasons.push("Generous/known quota.");
    else if (q.unknownFlags.includes("quota_unknown")) rankReasons.push("Quota unknown — ranked conservatively.");
    if (r.freshness === "live_verified") rankReasons.push("Recently verified.");
    else if (r.freshness === "stale" || r.freshness === "seed_demo") rankReasons.push("Data is seed/stale — lower trust.");
    if (r.paymentRequirement === "not_required") rankReasons.push("No card required.");
    else if (r.paymentRequirement === "unknown") rankReasons.push("Card requirement unknown.");
    if (q.unknownFlags.includes("no_source")) rankReasons.push("No linked source.");
    if (r.harnessCompatible.length) rankReasons.push(`Harness-compatible: ${r.harnessCompatible.join(", ")}.`);

    results.push({
      routeId: r.routeId,
      modelId: r.modelId,
      modelName: r.modelName,
      providerId: r.providerId,
      providerName: r.providerName,
      accessType: r.accessType,
      status: r.status,
      matchScore: Math.round(score),
      matchReasons,
      rankReasons,
    });
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  if (req.limit) return results.slice(0, req.limit);
  return results;
}

// ---------------------------------------------------------------------------
// Change categories for the changes feed (req 13) and historical free access.
// ---------------------------------------------------------------------------

export type ChangeCategory =
  | "became_free"
  | "became_paid"
  | "limit_decreased"
  | "limit_increased"
  | "removed"
  | "restored"
  | "provider_changed";

export const CHANGE_CATEGORY_META: Record<ChangeCategory, { icon: string; label: string; color: string }> = {
  became_free: { icon: "🆕", label: "Became free", color: "#34d399" },
  became_paid: { icon: "💰", label: "Became paid", color: "#fbbf24" },
  limit_decreased: { icon: "📉", label: "Free limit decreased", color: "#fb923c" },
  limit_increased: { icon: "📈", label: "Free limit increased", color: "#34d399" },
  removed: { icon: "🔴", label: "Removed", color: "#f87171" },
  restored: { icon: "🟢", label: "Restored", color: "#34d399" },
  provider_changed: { icon: "🔄", label: "Provider changed", color: "#60a5fa" },
};

export function categorizeChange(c: ChangeHistory): ChangeCategory | null {
  const fc = c.fieldChanged ?? "";
  const nv = (c.newValue ?? "").toLowerCase();
  const ov = (c.oldValue ?? "").toLowerCase();
  if (fc === "added") return "became_free";
  if (fc === "removed") return "removed";
  if (fc === "status_change") {
    if (/unavailable/.test(nv) && !/unavailable/.test(ov)) return "removed";
    if (!/unavailable/.test(nv) && /unavailable/.test(ov)) return "restored";
    if (/free|available|tier|limited/.test(nv) && /paid|unavailable/.test(ov)) return "became_free";
    if (/paid|unavailable/.test(nv) && /free|available|tier/.test(ov)) return "became_paid";
    return "provider_changed";
  }
  if (fc === "quota_change") {
    return /decreas|reduced|cut|lower|down/.test(nv + ov) ? "limit_decreased" : "limit_increased";
  }
  if (fc === "rate_limit_change") {
    return /decreas|reduced|cut|lower|down/.test(nv + ov) ? "limit_decreased" : "limit_increased";
  }
  if (fc === "pricing_change") {
    if (/paid|price|cost/.test(nv) && /free/.test(ov)) return "became_paid";
    if (/free/.test(nv) && /paid|price|cost/.test(ov)) return "became_free";
    return "provider_changed";
  }
  if (fc === "provider_change") return "provider_changed";
  return null;
}

export interface CategorizedChange {
  id: string;
  category: ChangeCategory;
  entityId: string;
  entityName: string;
  modelId: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
  verifiedAt: string | null;
  notes: string | null;
  sourceUrl: string | null;
  scope: "model" | "provider" | "global";
  providerId: string | null;
}

export function getCategorizedChanges(changes: ChangeHistory[]): CategorizedChange[] {
  const g = loadGraph();
  const named = new Map<string, string>();
  for (const m of g.models) named.set(m.id, m.name);
  const out: CategorizedChange[] = [];
  for (const c of changes) {
    const cat = categorizeChange(c);
    if (!cat) continue;
    const entityId = c.entityId;
    const name = named.get(entityId.split("__")[0]) ?? entityId;
    const parts = entityId.split("__");
    const providerId = parts.length > 1 ? parts[1] : null;
    const scope: CategorizedChange["scope"] = c.fieldChanged === "provider_change" ? "provider" : "model";
    out.push({
      id: c.id,
      category: cat,
      entityId,
      entityName: name,
      modelId: entityId.split("__")[0],
      fieldChanged: c.fieldChanged ?? "",
      oldValue: c.oldValue,
      newValue: c.newValue,
      detectedAt: c.detectedAt,
      verifiedAt: c.verifiedAt,
      notes: c.notes,
      sourceUrl: c.sourceUrl,
      scope,
      providerId,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Newly-free / recently-removed detection based on HISTORICAL transitions,
// not the model's release date (req 14, 15).
// ---------------------------------------------------------------------------

export interface FreeTransition {
  id: string;
  modelId: string;
  entityId: string;
  entityName: string;
  detectedAt: string;
  category: ChangeCategory;
  previousAccessType: string | null;
  previousFreeTerms: string | null;
  sourceUrl: string | null;
  notes: string | null;
}

function accessTypeFromValue(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/completely_free|free_tier|free_credits|free_with_limits|free_through_aggregator|free_through_harness|free_local|temporarily_free|community_unofficial|direct_api/);
  return m ? m[0] : null;
}

export function getNewlyFree(days = 120): FreeTransition[] {
  const cats = getCategorizedChanges(getChanges(500)).filter((c) => c.category === "became_free" || c.category === "restored");
  const out: FreeTransition[] = [];
  for (const c of cats) {
    if (Date.now() - new Date(c.detectedAt).getTime() > days * 86400000) continue;
    out.push({
      id: c.id,
      modelId: c.entityId.split("__")[0],
      entityId: c.entityId,
      entityName: c.entityName,
      detectedAt: c.detectedAt,
      category: c.category,
      previousAccessType: accessTypeFromValue(c.oldValue),
      previousFreeTerms: c.oldValue,
      sourceUrl: c.sourceUrl,
      notes: c.notes,
    });
  }
  return out.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

export function getRecentlyRemoved(days = 120): FreeTransition[] {
  const cats = getCategorizedChanges(getChanges(500)).filter((c) => c.category === "removed" || c.category === "became_paid");
  const out: FreeTransition[] = [];
  for (const c of cats) {
    if (Date.now() - new Date(c.detectedAt).getTime() > days * 86400000) continue;
    out.push({
      id: c.id,
      modelId: c.entityId.split("__")[0],
      entityId: c.entityId,
      entityName: c.entityName,
      detectedAt: c.detectedAt,
      category: c.category,
      previousAccessType: accessTypeFromValue(c.oldValue),
      previousFreeTerms: c.oldValue,
      sourceUrl: c.sourceUrl,
      notes: c.notes,
    });
  }
  return out.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

// ---------------------------------------------------------------------------
// Data-quality overview (req 16).
// ---------------------------------------------------------------------------

export interface DataQualityStats {
  totalFreeRoutes: number;
  paymentRequirementKnown: number;
  paymentRequirementUnknown: number;
  coveragePct: number;
  byFreshness: { tier: FreshnessTier; label: string; count: number }[];
  unknownByProvider: { providerId: string; providerName: string; unknownCount: number }[];
}

const FRESH_LABEL: Record<FreshnessTier, string> = {
  live_verified: "Live & verified",
  likely: "Likely",
  unverified: "Unverified",
  seed_demo: "Seed / demo",
  stale: "Stale",
  expired: "Expired",
  unavailable: "Unavailable",
};

export function getDataQualityStats(): DataQualityStats {
  const routes = buildFreeAccessRoutes(true);
  let paymentRequirementKnown = 0;
  let paymentRequirementUnknown = 0;
  const freshnessBuckets: Record<FreshnessTier, number> = {
    live_verified: 0, likely: 0, unverified: 0, seed_demo: 0, stale: 0, expired: 0, unavailable: 0,
  };
  const unknownByProvider = new Map<string, { providerId: string; providerName: string; unknownCount: number }>();
  for (const r of routes) {
    freshnessBuckets[r.freshness]++;
    if (r.paymentRequirement === "unknown") {
      paymentRequirementUnknown++;
      const entry = unknownByProvider.get(r.providerId) ?? { providerId: r.providerId, providerName: r.providerName, unknownCount: 0 };
      entry.unknownCount++;
      unknownByProvider.set(r.providerId, entry);
    } else {
      paymentRequirementKnown++;
    }
  }
  const total = routes.length;
  const coveragePct = total ? Math.round((paymentRequirementKnown / total) * 100) : 0;
  const byFreshness = (Object.keys(freshnessBuckets) as FreshnessTier[]).map((tier) => ({
    tier,
    label: FRESH_LABEL[tier],
    count: freshnessBuckets[tier],
  }));
  const unknownByProviderArr = [...unknownByProvider.values()].sort((a, b) => b.unknownCount - a.unknownCount);
  return {
    totalFreeRoutes: total,
    paymentRequirementKnown,
    paymentRequirementUnknown,
    coveragePct,
    byFreshness,
    unknownByProvider: unknownByProviderArr,
  };
}

export type { ModelView };
