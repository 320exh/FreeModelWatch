import { getDb, isSeeded } from "./db";
import { seedDatabase } from "./seed";
import type {
  Model,
  Provider,
  Harness,
  Availability,
  Source,
  ChangeHistory,
  HarnessCompat,
  AccessType,
  AvailabilityStatus,
  VerificationConfidence,
  DataOrigin,
  FreshnessTier,
} from "./types";

export function ensureSeeded(): void {
  if (!isSeeded()) {
    seedDatabase();
  }
}

const FREE_STATUSES: AvailabilityStatus[] = ["available", "limited", "degraded", "temporarily_free"];

function parseArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  try {
    const p = JSON.parse(v as string);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function rowToModel(r: any): Model {
  return {
    id: r.id,
    name: r.name,
    providerId: r.provider_id,
    family: r.family,
    version: r.version,
    releaseDate: r.release_date,
    contextWindow: r.context_window,
    maxOutputTokens: r.max_output_tokens,
    inputModalities: parseArr(r.input_modalities),
    outputModalities: parseArr(r.output_modalities),
    visionSupport: !!r.vision_support,
    toolCalling: !!r.tool_calling,
    structuredOutput: !!r.structured_output,
    reasoningSupport: !!r.reasoning_support,
    codingCapability: r.coding_capability,
    isOpenSource: !!r.is_open_source,
    license: r.license,
    officialPageUrl: r.official_page_url,
    documentationUrl: r.documentation_url,
    description: r.description,
  };
}

function rowToProvider(r: any): Provider {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    websiteUrl: r.website_url,
    apiDocsUrl: r.api_docs_url,
    pricingUrl: r.pricing_url,
    hasFreeTier: !!r.has_free_tier,
    freeCreditsAmount: r.free_credits_amount,
    freeCreditsCurrency: r.free_credits_currency,
    rateLimitRpm: r.rate_limit_rpm,
    rateLimitTpm: r.rate_limit_tpm,
    dailyRequestLimit: r.daily_request_limit,
    monthlyTokenLimit: r.monthly_token_limit,
    requiresPaymentMethod: !!r.requires_payment_method,
    requiresSignup: !!r.requires_signup,
    geographicRestrictions: parseArr(r.geographic_restrictions),
    termsRestrictions: r.terms_restrictions,
    status: r.status,
    lastVerifiedAt: r.last_verified_at,
    verificationConfidence: r.verification_confidence,
    dataOrigin: (r.data_origin ?? "seed") as DataOrigin,
  };
}

function rowToAvailability(r: any): Availability {
  return {
    id: r.id,
    modelId: r.model_id,
    providerId: r.provider_id,
    harnessId: r.harness_id,
    accessType: r.access_type,
    freeQuotaValue: r.free_quota_value,
    freeQuotaUnit: r.free_quota_unit,
    freeQuotaPeriod: r.free_quota_period,
    rateLimitRpm: r.rate_limit_rpm,
    rateLimitTpm: r.rate_limit_tpm,
    dailyLimit: r.daily_limit,
    monthlyLimit: r.monthly_limit,
    inputPricePerMillion: r.input_price_per_million,
    outputPricePerMillion: r.output_price_per_million,
    currency: r.currency,
    requiresApiKey: !!r.requires_api_key,
    requiresPaymentMethod: !!r.requires_payment_method,
    requiresSignup: !!r.requires_signup,
    geographicRestrictions: parseArr(r.geographic_restrictions),
    apiFormat: r.api_format,
    customEndpointUrl: r.custom_endpoint_url,
    status: r.status,
    isActive: !!r.is_active,
    sourceUrl: r.source_url,
    sourceTitle: r.source_title,
    sourceType: r.source_type,
    lastVerifiedAt: r.last_verified_at,
    verificationMethod: r.verification_method,
    verificationConfidence: r.verification_confidence,
    verificationNotes: r.verification_notes,
    dataOrigin: (r.data_origin ?? "seed") as DataOrigin,
    expiresAt: r.expires_at ?? null,
    verifiedBy: r.verified_by ?? null,
  };
}

function rowToHarness(r: any): Harness {
  return {
    id: r.id,
    name: r.name,
    websiteUrl: r.website_url,
    documentationUrl: r.documentation_url,
    supportsCustomOpenaiEndpoint: !!r.supports_custom_openai_endpoint,
    supportsAnthropicEndpoint: !!r.supports_anthropic_endpoint,
    supportsOpenrouterRouting: !!r.supports_openrouter_routing,
    authMethods: parseArr(r.auth_methods),
    description: r.description,
  };
}

function rowToChange(r: any): ChangeHistory {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    fieldChanged: r.field_changed,
    oldValue: r.old_value,
    newValue: r.new_value,
    changeSource: r.change_source,
    sourceUrl: r.source_url,
    detectedAt: r.detected_at,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by ?? null,
    notes: r.notes,
  };
}

function rowToSource(r: any): Source {
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    sourceType: r.source_type,
    providerId: r.provider_id,
    modelId: r.model_id,
    availabilityId: r.availability_id,
    claimSupported: r.claim_supported,
    dateDiscovered: r.date_discovered,
    dateLastChecked: r.date_last_checked,
    isVerified: !!r.is_verified,
    reliability: (r.reliability ?? "unknown") as VerificationConfidence,
    lastCheckedAt: r.last_checked_at ?? null,
    lastChangedAt: r.last_changed_at ?? null,
    notes: r.notes ?? null,
  };
}

function rowToHc(r: any): HarnessCompat {
  return {
    id: r.id,
    modelId: r.model_id,
    harnessId: r.harness_id,
    providerId: r.provider_id,
    authMethod: r.auth_method,
    requiresApiKey: !!r.requires_api_key,
    supportsDirectly: !!r.supports_directly,
    worksWithCustomEndpoint: !!r.works_with_custom_endpoint,
    worksWithOpenrouter: !!r.works_with_openrouter,
    setupDifficulty: r.setup_difficulty,
    knownLimitations: r.known_limitations,
    freeStatus: r.free_status,
    lastVerifiedAt: r.last_verified_at,
    verificationConfidence: r.verification_confidence,
    sourceUrl: r.source_url,
    dataOrigin: (r.data_origin ?? "seed") as DataOrigin,
  };
}

function rowToVerificationHistory(r: any) {
  return {
    id: r.id,
    availabilityId: r.availability_id,
    modelId: r.model_id ?? null,
    providerId: r.provider_id ?? null,
    verifiedBy: r.verified_by ?? null,
    verifiedAt: r.verified_at,
    previousConfidence: r.previous_confidence ?? null,
    previousStatus: r.previous_status ?? null,
    newConfidence: r.new_confidence ?? null,
    newStatus: r.new_status ?? null,
    sourceIds: r.source_ids ?? null,
    notes: r.notes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getAllModels(): Model[] {
  ensureSeeded();
  const db = getDb();
  return (db.prepare("SELECT * FROM models ORDER BY name").all() as any[]).map(rowToModel);
}

export function getModel(id: string): Model | null {
  ensureSeeded();
  const db = getDb();
  const r = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as any;
  return r ? rowToModel(r) : null;
}

export function getAllProviders(): Provider[] {
  ensureSeeded();
  const db = getDb();
  return (db.prepare("SELECT * FROM providers ORDER BY name").all() as any[]).map(rowToProvider);
}

export function getProvider(id: string): Provider | null {
  ensureSeeded();
  const db = getDb();
  const r = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as any;
  return r ? rowToProvider(r) : null;
}

export function getAllHarnesses(): Harness[] {
  ensureSeeded();
  const db = getDb();
  return (db.prepare("SELECT * FROM harnesses ORDER BY name").all() as any[]).map(rowToHarness);
}

export function getHarness(id: string): Harness | null {
  ensureSeeded();
  const db = getDb();
  const r = db.prepare("SELECT * FROM harnesses WHERE id = ?").get(id) as any;
  return r ? rowToHarness(r) : null;
}

export function getAvailability(filters: { modelId?: string; providerId?: string; harnessId?: string; activeOnly?: boolean; status?: string } = {}): Availability[] {
  ensureSeeded();
  const db = getDb();
  let sql = "SELECT * FROM availability WHERE 1=1";
  const args: any[] = [];
  if (filters.modelId) { sql += " AND model_id = ?"; args.push(filters.modelId); }
  if (filters.providerId) { sql += " AND provider_id = ?"; args.push(filters.providerId); }
  if (filters.harnessId) { sql += " AND harness_id = ?"; args.push(filters.harnessId); }
  if (filters.status) { sql += " AND status = ?"; args.push(filters.status); }
  if (filters.activeOnly) { sql += " AND is_active = 1"; }
  sql += " ORDER BY status, provider_id";
  return (db.prepare(sql).all(...args) as any[]).map(rowToAvailability);
}

export function getHarnessCompat(filters: { modelId?: string; harnessId?: string; providerId?: string } = {}): HarnessCompat[] {
  ensureSeeded();
  const db = getDb();
  let sql = "SELECT * FROM model_harness_compatibility WHERE 1=1";
  const args: any[] = [];
  if (filters.modelId) { sql += " AND model_id = ?"; args.push(filters.modelId); }
  if (filters.harnessId) { sql += " AND harness_id = ?"; args.push(filters.harnessId); }
  if (filters.providerId) { sql += " AND provider_id = ?"; args.push(filters.providerId); }
  return (db.prepare(sql).all(...args) as any[]).map(rowToHc);
}

export function getSources(filters: { providerId?: string; modelId?: string; availabilityId?: string } = {}): Source[] {
  ensureSeeded();
  const db = getDb();
  let sql = "SELECT s.* FROM sources s";
  const args: any[] = [];
  const where: string[] = [];
  if (filters.availabilityId) {
    sql += " JOIN availability_sources aus ON aus.source_id = s.id";
    where.push("aus.availability_id = ?");
    args.push(filters.availabilityId);
  }
  if (filters.providerId) { where.push("s.provider_id = ?"); args.push(filters.providerId); }
  if (filters.modelId) { where.push("s.model_id = ?"); args.push(filters.modelId); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY s.reliability DESC, s.title";
  return (db.prepare(sql).all(...args) as any[]).map(rowToSource);
}

export function getAvailabilitySources(availabilityId: string): Source[] {
  return getSources({ availabilityId });
}

export function getVerificationHistory(availabilityId: string): any[] {
  ensureSeeded();
  const db = getDb();
  return (db.prepare("SELECT * FROM verification_history WHERE availability_id = ? ORDER BY verified_at DESC").all(availabilityId) as any[]).map(rowToVerificationHistory);
}

export function getChanges(limit = 50): ChangeHistory[] {
  ensureSeeded();
  const db = getDb();
  return (db.prepare("SELECT * FROM change_history ORDER BY detected_at DESC LIMIT ?").all(limit) as any[]).map(rowToChange);
}

// ---------------------------------------------------------------------------
// Freshness classification — the heart of "data freshness as a first-class system"
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_DAYS = 30;

export function classifyFreshness(a: Availability, thresholdDays = STALE_THRESHOLD_DAYS): FreshnessTier {
  if (a.status === "unavailable") return "unavailable";
  // Seed/demo rows are explicitly NOT live-verified data, no matter their confidence.
  if (a.dataOrigin === "seed") return "seed_demo";
  if (a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()) return "expired";
  if (a.verificationConfidence === "stale") return "stale";
  if (a.verificationConfidence === "verified") {
    const ageDays = a.lastVerifiedAt ? (Date.now() - new Date(a.lastVerifiedAt).getTime()) / 86400000 : Infinity;
    return ageDays > thresholdDays ? "stale" : "live_verified";
  }
  if (a.verificationConfidence === "likely") return "likely";
  return "unverified";
}

export function isFreeAccess(a: Availability): boolean {
  return a.isActive && FREE_STATUSES.includes(a.status);
}

// ---------------------------------------------------------------------------
// Enriched model view (model + its free routes) — loads the whole graph once
// to avoid N+1 queries as the dataset grows.
// ---------------------------------------------------------------------------

export interface ModelFreeRoute {
  availability: Availability;
  provider: Provider;
  freshness: FreshnessTier;
  sources: Source[];
}

export interface ModelView extends Model {
  routes: ModelFreeRoute[];
  freeRouteCount: number;
  bestAccessType: AccessType | null;
  bestStatus: AvailabilityStatus | null;
  bestConfidence: VerificationConfidence;
  bestFreshness: FreshnessTier;
  noPaymentMethod: boolean;
  noCreditCard: boolean;
  lowFriction: boolean;
  harnessCount: number;
  // transparent: is the ranking for this model built on stale/seed data?
  dataQuality: "live" | "mixed" | "seed" | "stale";
}

export interface Graph {
  models: Model[];
  modelMap: Map<string, Model>;
  providerMap: Map<string, Provider>;
  availByModel: Map<string, Availability[]>;
  hcByModel: Map<string, HarnessCompat[]>;
  sourcesByAvail: Map<string, Source[]>;
}

function loadGraph(): Graph {
  const db = getDb();
  const models = (db.prepare("SELECT * FROM models").all() as any[]).map(rowToModel);
  const providers = (db.prepare("SELECT * FROM providers").all() as any[]).map(rowToProvider);
  const avail = (db.prepare("SELECT * FROM availability WHERE is_active = 1").all() as any[]).map(rowToAvailability);
  const hc = (db.prepare("SELECT * FROM model_harness_compatibility").all() as any[]).map(rowToHc);
  const links = (db.prepare(`
    SELECT aus.availability_id, s.* FROM availability_sources aus
    JOIN sources s ON s.id = aus.source_id
  `).all() as any[]);

  const modelMap = new Map(models.map((m) => [m.id, m]));
  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const availByModel = new Map<string, Availability[]>();
  for (const a of avail) {
    if (!availByModel.has(a.modelId)) availByModel.set(a.modelId, []);
    availByModel.get(a.modelId)!.push(a);
  }
  const hcByModel = new Map<string, HarnessCompat[]>();
  for (const c of hc) {
    if (!hcByModel.has(c.modelId)) hcByModel.set(c.modelId, []);
    hcByModel.get(c.modelId)!.push(c);
  }
  const sourcesByAvail = new Map<string, Source[]>();
  for (const r of links) {
    const s = rowToSource(r);
    if (!sourcesByAvail.has(r.availability_id)) sourcesByAvail.set(r.availability_id, []);
    sourcesByAvail.get(r.availability_id)!.push(s);
  }
  return { models, modelMap, providerMap, availByModel, hcByModel, sourcesByAvail };
}

function enrichModel(m: Model, g: Graph): ModelView {
  const availList = (g.availByModel.get(m.id) ?? []).filter((a) => isFreeAccess(a));
  const routes: ModelFreeRoute[] = availList
    .map((a) => {
      const provider = g.providerMap.get(a.providerId);
      if (!provider) return null;
      return {
        availability: a,
        provider,
        freshness: classifyFreshness(a),
        sources: g.sourcesByAvail.get(a.id) ?? [],
      } as ModelFreeRoute;
    })
    .filter((r): r is ModelFreeRoute => r !== null);

  const hc = g.hcByModel.get(m.id) ?? [];
  const confRank: Record<VerificationConfidence, number> = { verified: 3, likely: 2, unverified: 1, stale: 0 };
  const freshRank: Record<FreshnessTier, number> = {
    live_verified: 3, likely: 2, seed_demo: 1, unverified: 1, stale: 0, expired: 0, unavailable: 0,
  };
  const statusRank: Record<string, number> = { available: 3, limited: 2, degraded: 1, temporarily_free: 2, unavailable: 0, unknown: 1 };

  let best: ModelFreeRoute | null = null;
  for (const r of routes) {
    if (!best) { best = r; continue; }
    const score = (x: ModelFreeRoute) =>
      (confRank[x.availability.verificationConfidence] * 10) +
      (freshRank[x.freshness] * 10) +
      (statusRank[x.availability.status] || 0) * 3 +
      (x.availability.requiresPaymentMethod ? 0 : 5) +
      (x.availability.requiresApiKey ? 0 : 2);
    if (score(r) > score(best)) best = r;
  }

  const noPaymentMethod = routes.length > 0 && routes.every((r) => !r.availability.requiresPaymentMethod);
  const noCreditCard = noPaymentMethod;
  const lowFriction = routes.length > 0 && routes.some((r) => !r.availability.requiresPaymentMethod && !r.availability.requiresSignup);

  const tiers = routes.map((r) => r.freshness);
  let dataQuality: ModelView["dataQuality"] = "live";
  if (tiers.length === 0) dataQuality = "seed";
  else if (tiers.every((t) => t === "seed_demo")) dataQuality = "seed";
  else if (tiers.some((t) => t === "seed_demo" || t === "stale" || t === "expired" || t === "unverified")) dataQuality = "mixed";
  else if (tiers.some((t) => t === "stale" || t === "expired")) dataQuality = "stale";
  else dataQuality = "live";

  return {
    ...m,
    routes,
    freeRouteCount: routes.length,
    bestAccessType: best?.availability.accessType ?? null,
    bestStatus: best?.availability.status ?? null,
    bestConfidence: best?.availability.verificationConfidence ?? "unverified",
    bestFreshness: best?.freshness ?? "seed_demo",
    noPaymentMethod,
    noCreditCard,
    lowFriction,
    harnessCount: hc.length,
    dataQuality,
  };
}

export function getModelViews(): ModelView[] {
  ensureSeeded();
  const g = loadGraph();
  return g.models.map((m) => enrichModel(m, g));
}

/** Models that currently have at least one free access route. */
export function getFreeModels(): ModelView[] {
  return getModelViews().filter((m) => m.freeRouteCount > 0);
}

export function getModelView(id: string): (ModelView & { harnessCompat: HarnessCompat[]; sources: Source[]; changes: ChangeHistory[] }) | null {
  const m = getModel(id);
  if (!m) return null;
  const g = loadGraph();
  const mv = enrichModel(m, g);
  return {
    ...mv,
    harnessCompat: g.hcByModel.get(id) ?? [],
    sources: getSources({ modelId: id }),
    changes: getChanges(200).filter((c) => c.entityId.includes(id) || c.entityId.includes(`${m.providerId}__`)),
  };
}

// ---------------------------------------------------------------------------
// Filtering / search
// ---------------------------------------------------------------------------

export interface ModelFilters {
  q?: string;
  access?: AccessType[];
  coding?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  toolCalling?: boolean;
  structuredOutput?: boolean;
  longContext?: boolean;
  openSource?: boolean;
  provider?: string[];
  harness?: string;
  noPayment?: boolean;
  noSignup?: boolean;
  apiKeyRequired?: boolean | null;
  minContext?: number;
  verified?: VerificationConfidence[];
  sort?: "relevance" | "context" | "coding" | "recent" | "freshness" | "reliability";
}

export function queryModels(f: ModelFilters): ModelView[] {
  let views = getModelViews().filter((m) => m.freeRouteCount > 0 || f.q);

  if (f.q) {
    const q = f.q.toLowerCase();
    views = views.filter((m) => {
      const provNames = m.routes.map((r) => r.provider.name.toLowerCase());
      return (
        m.name.toLowerCase().includes(q) ||
        (m.family ?? "").toLowerCase().includes(q) ||
        provNames.some((n) => n.includes(q)) ||
        (m.providerId ?? "").toLowerCase().includes(q) ||
        (m.description ?? "").toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }
  if (f.access && f.access.length) {
    views = views.filter((m) => m.routes.some((r) => f.access!.includes(r.availability.accessType)));
  }
  if (f.verified && f.verified.length) {
    views = views.filter((m) => f.verified!.includes(m.bestConfidence));
  }
  if (f.coding) views = views.filter((m) => (m.codingCapability ?? 0) >= 4);
  if (f.reasoning) views = views.filter((m) => m.reasoningSupport);
  if (f.vision) views = views.filter((m) => m.visionSupport);
  if (f.toolCalling) views = views.filter((m) => m.toolCalling);
  if (f.structuredOutput) views = views.filter((m) => m.structuredOutput);
  if (f.longContext) views = views.filter((m) => (m.contextWindow ?? 0) >= 100000);
  if (f.openSource) views = views.filter((m) => m.isOpenSource);
  if (f.provider && f.provider.length) {
    views = views.filter((m) => m.routes.some((r) => f.provider!.includes(r.provider.id)));
  }
  if (f.harness) {
    const hcIds = new Set(getHarnessCompat({ harnessId: f.harness }).map((h) => h.modelId));
    views = views.filter((m) => hcIds.has(m.id));
  }
  if (f.noPayment) views = views.filter((m) => m.noPaymentMethod);
  if (f.noSignup) views = views.filter((m) => m.routes.some((r) => !r.availability.requiresSignup));
  if (f.apiKeyRequired === true) views = views.filter((m) => m.routes.some((r) => r.availability.requiresApiKey));
  if (f.apiKeyRequired === false) views = views.filter((m) => m.routes.some((r) => !r.availability.requiresApiKey));
  if (f.minContext) views = views.filter((m) => (m.contextWindow ?? 0) >= f.minContext!);

  switch (f.sort) {
    case "context":
      views.sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0));
      break;
    case "coding":
      views.sort((a, b) => (b.codingCapability ?? 0) - (a.codingCapability ?? 0));
      break;
    case "recent":
      views.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
      break;
    case "freshness":
      views.sort((a, b) => freshnessSortKey(b.bestFreshness) - freshnessSortKey(a.bestFreshness));
      break;
    case "reliability":
      views.sort((a, b) => confSortKey(b.bestConfidence) - confSortKey(a.bestConfidence));
      break;
    default:
      // Relevance: capability first, NOT number of routes — avoid rewarding a
      // model merely for being listed through many providers.
      views.sort((a, b) => (b.codingCapability ?? 0) - (a.codingCapability ?? 0) || (b.contextWindow ?? 0) - (a.contextWindow ?? 0));
  }
  return views;
}

function freshnessSortKey(t: FreshnessTier): number {
  return { live_verified: 6, likely: 4, unverified: 2, seed_demo: 1, stale: 0, expired: 0, unavailable: -1 }[t];
}
function confSortKey(c: VerificationConfidence): number {
  return { verified: 4, likely: 3, unverified: 1, stale: 0 }[c];
}

// ---------------------------------------------------------------------------
// Scoring for "best free" rankings — transparent, route-count independent
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  total: number;
  capability: number;
  freeAccess: number;
  reliability: number;
  freshness: number;
  availability: number;
}

export interface ScoredModel {
  view: ModelView;
  score: ScoreBreakdown;
}

const ACCESS_QUALITY: Record<AccessType, number> = {
  completely_free: 25,
  free_local: 25,
  free_tier: 20,
  free_with_limits: 14,
  free_credits: 15,
  free_through_aggregator: 15,
  free_through_harness: 12,
  temporarily_free: 8,
  community_unofficial: 6,
};

export function scoreModel(m: ModelView): ScoreBreakdown {
  const cap = (m.codingCapability ?? 0) * (m.reasoningSupport ? 1.2 : 1) + (m.visionSupport ? 2 : 0) + (m.toolCalling ? 1 : 0);
  const capability = Math.min(30, cap * 2.2);

  // best free-access quality across routes (does NOT sum route count)
  let bestAccess = 0;
  let maxQuota = 0;
  for (const r of m.routes) {
    bestAccess = Math.max(bestAccess, ACCESS_QUALITY[r.availability.accessType] ?? 0);
    if (r.availability.dailyLimit) maxQuota = Math.max(maxQuota, r.availability.dailyLimit);
    else if (r.availability.monthlyLimit) maxQuota = Math.max(maxQuota, r.availability.monthlyLimit / 30);
    else if (r.availability.freeQuotaValue && r.availability.freeQuotaUnit === "requests") {
      const mult = r.availability.freeQuotaPeriod === "day" ? 1 : r.availability.freeQuotaPeriod === "minute" ? 1440 : 1;
      maxQuota = Math.max(maxQuota, (r.availability.freeQuotaValue ?? 0) * mult);
    } else if (r.availability.freeQuotaValue && r.availability.freeQuotaUnit === "dollars") {
      maxQuota = Math.max(maxQuota, 500);
    } else if (r.availability.accessType === "free_local") {
      maxQuota = Math.max(maxQuota, 100000);
    }
  }
  const quotaBonus = Math.min(12, Math.log10(Math.max(10, maxQuota)) * 3);
  const freeAccess = Math.round(Math.min(25, bestAccess + quotaBonus * 0.4));

  const confRank: Record<VerificationConfidence, number> = { verified: 18, likely: 10, unverified: 3, stale: 0 };
  const reliability = confRank[m.bestConfidence] ?? 0;

  const freshRank: Record<FreshnessTier, number> = {
    live_verified: 15, likely: 10, unverified: 3, seed_demo: 4, stale: 0, expired: 0, unavailable: 0,
  };
  const freshness = freshRank[m.bestFreshness] ?? 0;

  const statusRank: Record<string, number> = { available: 15, limited: 10, degraded: 5, temporarily_free: 10, unknown: 4, unavailable: 0 };
  const availability = statusRank[m.bestStatus ?? "unknown"] ?? 4;

  const total = Math.round(capability + freeAccess + reliability + freshness + availability);
  return {
    total,
    capability: Math.round(capability),
    freeAccess,
    reliability,
    freshness,
    availability,
  };
}

export function rankModels(views: ModelView[], predicate?: (m: ModelView) => boolean): ScoredModel[] {
  return views
    .filter((m) => (predicate ? predicate(m) : true))
    .map((view) => ({ view, score: scoreModel(view) }))
    .sort((a, b) => b.score.total - a.score.total);
}

// ---------------------------------------------------------------------------
// Contradiction / data-quality detection
// ---------------------------------------------------------------------------

export interface DataIssue {
  severity: "critical" | "warning" | "info";
  entityType: string;
  entityId: string;
  code: string;
  message: string;
}

export function detectContradictions(): DataIssue[] {
  ensureSeeded();
  const issues: DataIssue[] = [];
  const providers = getAllProviders();
  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const avail = getAvailability({ activeOnly: true });

  for (const a of avail) {
    const push = (severity: DataIssue["severity"], code: string, message: string) =>
      issues.push({ severity, entityType: "availability", entityId: a.id, code, message });

    if (a.accessType === "completely_free" && a.requiresPaymentMethod) {
      push("critical", "free_requires_payment", "Route is marked completely_free but requires a payment method.");
    }
    if (a.accessType === "free_local" && a.requiresApiKey) {
      push("warning", "local_requires_key", "Local/self-hosted route requires an API key (should be keyless).");
    }
    if (a.accessType === "free_local" && a.requiresSignup) {
      push("warning", "local_requires_signup", "Local/self-hosted route requires signup (should be standalone).");
    }
    if ((a.inputPricePerMillion != null && a.inputPricePerMillion > 0) || (a.outputPricePerMillion != null && a.outputPricePerMillion > 0)) {
      push("warning", "free_has_price", "Free route carries a non-zero price per million tokens.");
    }
    if (a.lastVerifiedAt && new Date(a.lastVerifiedAt).getTime() > Date.now() + 86400000) {
      push("critical", "future_verification", "Verification date is in the future.");
    }
    if (a.expiresAt && new Date(a.expiresAt).getTime() < Date.now() && a.status !== "unavailable") {
      push("warning", "expired_still_available", "Promotional/expiry date has passed but route is still marked available.");
    }
    const prov = providerMap.get(a.providerId);
    if (prov && prov.status === "unavailable" && FREE_STATUSES.includes(a.status)) {
      push("warning", "provider_unavailable", `Route is '${a.status}' via a provider marked '${prov.status}'.`);
    }
    if (prov && prov.requiresPaymentMethod && !a.requiresPaymentMethod && a.accessType === "completely_free") {
      push("warning", "provider_requires_card", "Route claims no card but its provider requires a payment method.");
    }
    const linked = getAvailabilitySources(a.id);
    if (linked.length === 0 && !a.sourceUrl) {
      push("warning", "missing_source", "Availability claim has no linked source.");
    }
    const hasQuota = a.freeQuotaValue != null || a.dailyLimit != null || a.monthlyLimit != null;
    if (!hasQuota && a.accessType !== "free_local" && a.accessType !== "free_through_harness") {
      push("info", "missing_quota", "Free route has no recorded quota (value/period/daily/monthly).");
    }
  }

  // Cross-claim contradictions: the same provider/model should not simultaneously
  // assert two materially different things (e.g. "completely_free" and
  // "free_with_limits", or "available" and "unavailable") on verified/likely rows.
  const byKey = new Map<string, Availability[]>();
  for (const a of avail) {
    if (a.verificationConfidence === "unverified") continue;
    const k = `${a.modelId}__${a.providerId}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(a);
  }
  for (const [key, rows] of byKey) {
    const accessTypes = new Set(rows.map((r) => r.accessType));
    if (rows.length >= 2 && accessTypes.size >= 2) {
      issues.push({
        severity: "critical",
        entityType: "availability",
        entityId: key,
        code: "same_provider_conflicting_access",
        message: `Provider claims ${accessTypes.size} conflicting free-access types (${[...accessTypes].join(", ")}) for the same model.`,
      });
    }
    const statuses = new Set(rows.map((r) => r.status));
    if (statuses.has("available") && statuses.has("unavailable")) {
      issues.push({
        severity: "warning",
        entityType: "availability",
        entityId: key,
        code: "same_provider_conflicting_status",
        message: "Provider reports the same model as both available and unavailable.",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Verification queue — first-class admin workflow
// ---------------------------------------------------------------------------

export type QueueSeverity = "all" | "critical" | "warning" | "info";

export interface VerificationQueueItem {
  availabilityId: string;
  modelId: string;
  providerId: string;
  modelName: string;
  providerName: string;
  accessType: AccessType;
  status: AvailabilityStatus;
  confidence: VerificationConfidence;
  freshness: FreshnessTier;
  dataOrigin: DataOrigin;
  lastVerifiedAt: string | null;
  ageDays: number;
  reason: string;
  urgency: number;
}

export function needsVerification(a: Availability): boolean {
  const fresh = classifyFreshness(a);
  return (
    a.dataOrigin === "seed" ||
    fresh === "stale" ||
    fresh === "expired" ||
    fresh === "unverified" ||
    a.status === "unavailable"
  );
}

export function getVerificationQueue(filters: { provider?: string; model?: string; severity?: QueueSeverity } = {}): VerificationQueueItem[] {
  ensureSeeded();
  const g = loadGraph();
  const out: VerificationQueueItem[] = [];
  const allActive = getAvailability({ activeOnly: true });
  const sevByEntity = new Map<string, DataIssue["severity"]>();
  for (const issue of detectContradictions()) {
    const cur = sevByEntity.get(issue.entityId);
    if (issue.severity === "critical" || (issue.severity === "warning" && cur !== "critical") || (!cur)) {
      sevByEntity.set(issue.entityId, issue.severity);
    }
  }
  for (const a of allActive) {
    if (!needsVerification(a)) continue;
    if (filters.provider && a.providerId !== filters.provider) continue;
    if (filters.model && a.modelId !== filters.model) continue;
    const m = g.modelMap.get(a.modelId);
    const p = g.providerMap.get(a.providerId);
    const fresh = classifyFreshness(a);
    const ageDays = a.lastVerifiedAt ? Math.floor((Date.now() - new Date(a.lastVerifiedAt).getTime()) / 86400000) : 9999;
    let reason = "Seed/demo data not yet verified against a live source.";
    if (fresh === "stale") reason = `Last verified ${ageDays}d ago (>${STALE_THRESHOLD_DAYS}d threshold).`;
    else if (fresh === "expired") reason = "Promotional/expiry date has passed.";
    else if (fresh === "unverified") reason = "No positive verification recorded.";
    else if (a.status === "unavailable") reason = "Route currently marked unavailable.";
    const issueSev = sevByEntity.get(a.id);
    if (filters.severity && filters.severity !== "all" && issueSev !== filters.severity) continue;
    const urgency =
      (issueSev === "critical" ? 100000 : issueSev === "warning" ? 10000 : 0) +
      (a.dataOrigin === "seed" ? 5000 : 0) +
      ageDays;
    out.push({
      availabilityId: a.id,
      modelId: a.modelId,
      providerId: a.providerId,
      modelName: m?.name ?? a.modelId,
      providerName: p?.name ?? a.providerId,
      accessType: a.accessType,
      status: a.status,
      confidence: a.verificationConfidence,
      freshness: fresh,
      dataOrigin: a.dataOrigin ?? "seed",
      lastVerifiedAt: a.lastVerifiedAt,
      ageDays,
      reason,
      urgency,
    });
  }
  out.sort((x, y) => y.urgency - x.urgency);
  return out;
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export interface DashboardStats {
  totalFreeModels: number;
  totalProviders: number;
  totalHarnesses: number;
  freeApiProviders: number;
  harnessFreeModels: number;
  newlyFree: ChangeHistory[];
  recentlyRemoved: ChangeHistory[];
  alerts: { level: "info" | "warn" | "new" | "down" | "seed"; text: string; href?: string }[];
  needsVerificationCount: number;
  contradictionCount: number;
  seedCount: number;
  staleCount: number;
}

export function getStaleCount(thresholdDays = STALE_THRESHOLD_DAYS): number {
  ensureSeeded();
  const db = getDb();
  const cutoff = new Date(Date.now() - thresholdDays * 86400000).toISOString().slice(0, 10);
  const r = db.prepare(
    "SELECT COUNT(*) AS c FROM availability WHERE is_active=1 AND data_origin != 'seed' AND (last_verified_at IS NULL OR last_verified_at < ?)"
  ).get(cutoff) as { c: number };
  return r.c;
}

// ---------------------------------------------------------------------------
// Data state — distinguishes LIVE COLLECTOR data from DEMO/SEED data so the UI
// can tell the user which claims are live-verified vs curated demo entries.
// ---------------------------------------------------------------------------

export interface DataState {
  hasSeed: boolean;
  hasLive: boolean;
  seedRouteCount: number;
  liveRouteCount: number;
  liveProviders: string[];
}

export function getDataState(): DataState {
  ensureSeeded();
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT data_origin, provider_id, COUNT(*) AS c FROM availability WHERE is_active = 1 GROUP BY data_origin, provider_id"
    )
    .all() as { data_origin: string; provider_id: string; c: number }[];
  let seedRouteCount = 0;
  let liveRouteCount = 0;
  const liveProviders = new Set<string>();
  for (const r of rows) {
    if (r.data_origin === "live_collector") {
      liveRouteCount += r.c;
      liveProviders.add(r.provider_id);
    } else if (r.data_origin === "seed") {
      seedRouteCount += r.c;
    }
  }
  return {
    hasSeed: seedRouteCount > 0,
    hasLive: liveRouteCount > 0,
    seedRouteCount,
    liveRouteCount,
    liveProviders: [...liveProviders],
  };
}

// ---------------------------------------------------------------------------
// Collector run history (for multi-provider debugging)
// ---------------------------------------------------------------------------

export interface CollectorRunRow {
  id: string;
  collector: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  dry_run: number;
  models_discovered: number;
  free_models: number;
  models_added: number;
  models_changed: number;
  models_removed: number;
  free_routes_added: number;
  free_routes_removed: number;
  error_count: number;
  warning_count: number;
  error_message: string | null;
  summary: string | null;
}

export function getLastCollectorRuns(limit = 20): CollectorRunRow[] {
  ensureSeeded();
  const db = getDb();
  return db.prepare("SELECT * FROM collector_runs ORDER BY started_at DESC LIMIT ?").all(limit) as CollectorRunRow[];
}

export function getDashboardStats(): DashboardStats {
  const views = getModelViews().filter((m) => m.freeRouteCount > 0);
  const providers = getAllProviders();
  const freeApiProviders = providers.filter((p) => p.hasFreeTier || p.freeCreditsAmount).length;
  const harnesses = getAllHarnesses();

  const hcAll = getHarnessCompat();
  const harnessFreeModelIds = new Set(hcAll.filter((h) => h.freeStatus === "free").map((h) => h.modelId));
  const harnessFreeModels = views.filter((v) => harnessFreeModelIds.has(v.id)).length;

  const changes = getChanges(50);
  const isRecent = (d: string) => Date.now() - new Date(d).getTime() < 120 * 86400000;
  const newlyFree = changes.filter((c) => isRecent(c.detectedAt) && (c.fieldChanged === "added" || (c.fieldChanged === "status_change" && /free|limited|tier/i.test(c.newValue ?? ""))));
  const recentlyRemoved = changes.filter((c) => isRecent(c.detectedAt) && (c.fieldChanged === "removed" || (c.fieldChanged === "status_change" && /unavailable/i.test(c.newValue ?? ""))));

  const queue = getVerificationQueue();
  const issues = detectContradictions();
  const seedCount = getAvailability({ activeOnly: true }).filter((a) => a.dataOrigin === "seed").length;

  const alerts: DashboardStats["alerts"] = [];
  if (seedCount > 0) alerts.push({ level: "seed", text: `${seedCount} free routes are demo/seed data — verify against live sources before relying.`, href: "/admin" });
  if (newlyFree.length) alerts.push({ level: "new", text: `${newlyFree.length} model(s) became free recently.`, href: "/changes" });
  if (recentlyRemoved.length) alerts.push({ level: "down", text: `${recentlyRemoved.length} model(s) lost free access recently.`, href: "/changes" });
  const staleCount = getStaleCount();
  if (staleCount) alerts.push({ level: "warn", text: `${staleCount} verified route(s) haven't been re-checked in ${STALE_THRESHOLD_DAYS}+ days.`, href: "/admin" });
  const unverified = views.filter((v) => v.bestConfidence === "unverified").length;
  if (unverified) alerts.push({ level: "info", text: `${unverified} free routes are marked unverified — verify before relying.` });
  if (issues.length) alerts.push({ level: "warn", text: `${issues.length} data contradiction(s) detected in the dataset.`, href: "/admin" });

  return {
    totalFreeModels: views.length,
    totalProviders: providers.length,
    totalHarnesses: harnesses.length,
    freeApiProviders,
    harnessFreeModels,
    newlyFree,
    recentlyRemoved,
    alerts,
    needsVerificationCount: queue.length,
    contradictionCount: issues.length,
    seedCount,
    staleCount,
  };
}
