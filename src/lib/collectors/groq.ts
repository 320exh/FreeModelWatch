import type { AccessType, AvailabilityStatus, VerificationConfidence } from "../types";
import {
  type FreeClassification,
  type NormalizedModel,
  type NormalizedModelRow,
  type NormalizedAvailabilityRow,
} from "./openrouter";
import type { Collector, RawModelListing, RawPricing, NormalizedAvailability } from "./types";

// ---------------------------------------------------------------------------
// Groq — direct provider (OpenAI-compatible API). Source of truth for this
// collector is Groq's official documentation (NOT an aggregator):
//
// Model catalog:
//   https://console.groq.com/docs/models
//   Live API:     GET https://api.groq.com/openai/v1/models  (REQUIRES an API key)
//
// Pricing (authoritative, transcribed 2026-08-19):
//   https://groq.com/pricing
//   The FREE tier is zero-cost inference: every model listed in Groq's free
//   tier has $0 input / $0 output pricing. Paid (Developer/Enterprise) tiers
//   bill per token at the published rates.
//
// Rate limits:
//   https://console.groq.com/docs/rate-limits
//   Groq PUBLISHES per-model free-tier rate limits (unlike Google's Gemini API,
//   whose RPM/RPD are dynamic). Captured here as rate_limit_rpm / rate_limit_tpm
//   and daily_limit (requests/day, RPD). Monthly limits are NOT published for the
//   free tier and are stored as NULL (do NOT invent them).
//
//   IMPORTANT — TPD NOT CAPTURED: Groq ALSO publishes a tokens/day (TPD) ceiling
//   (e.g. ~100K TPD for llama-3.3-70b-versatile, ~500K TPD for llama-3.1-8b-instant).
//   The current availability schema has NO token/day column, so TPD is
//   intentionally NOT stored in any rate-limit field. Do NOT squeeze TPD into
//   rpm / tpm / daily_limit.
//
// Billing:
//   https://groq.com/pricing
//   The free tier requires NO credit card / NO payment method. It is intended
//   for development and prototyping; production traffic requires a paid plan.
//
// IMPORTANT: Groq rotates preview models and adjusts free-tier quotas. This
// collector uses a BUNDLED, FROZEN snapshot of the official free-tier model
// list (GROQ_FREE_TIER + GROQ_CATALOG_SNAPSHOT) so it runs WITHOUT a live API
// key. Snapshot transcribed 2026-08-19 and verified against Groq's official
// rate-limits / pricing docs (cross-checked through ~2026-07). The snapshot is
// clearly labeled and its source/date are recorded in every imported row. Real
// deployments should set GROQ_API_KEY for live discovery and re-transcribe
// GROQ_FREE_TIER when Groq updates its docs.
// ---------------------------------------------------------------------------

export const GROQ_PROVIDER_ID = "groq";
export const GROQ_MODELS_URL = "https://console.groq.com/docs/models";
export const GROQ_PRICING_URL = "https://groq.com/pricing";
export const GROQ_RATELIMITS_URL = "https://console.groq.com/docs/rate-limits";

export const GROQ_SOURCE_MODELS_ID = "src-groq-models";
export const GROQ_SOURCE_PRICING_ID = "src-groq-pricing";
export const GROQ_SOURCE_RATELIMITS_ID = "src-groq-rate-limits";

// Source URLs mirror the canonical doc URLs used as the source of truth.
export const GROQ_SOURCE_MODELS_URL = GROQ_MODELS_URL;
export const GROQ_SOURCE_PRICING_URL = GROQ_PRICING_URL;
export const GROQ_SOURCE_RATELIMITS_URL = GROQ_RATELIMITS_URL;

export const GROQ_SNAPSHOT_DATE = "2026-08-19";

export interface GroqModel {
  /** Groq model id, e.g. "llama-3.3-70b-versatile". */
  name: string;
  displayName?: string;
  description?: string;
  contextWindow?: number | null;
  version?: string;
}

interface GroqFreeTierEntry {
  free: boolean;
  /** USD per million tokens (0 = free on the free tier). */
  inputPrice: number;
  outputPrice: number;
  /** Published free-tier rate limits (per Groq's official rate-limits docs). */
  rpm: number | null;
  tpm: number | null;
  /** Requests per day (RPD). */
  rpd: number | null;
  contextWindow: number | null;
  confidence: VerificationConfidence;
  notes?: string;
}

/**
 * Transcription of Groq's official free-tier + pricing + rate-limits docs,
 * transcribed 2026-08-19 and verified against Groq's published rate-limits page
 * (cross-checked through ~2026-07). A model is FREE only when it appears in
 * Groq's published free-tier table (https://console.groq.com/docs/rate-limits).
 * RPM/TPM/RPD are the documented per-model free-tier ceilings. Monthly caps and
 * tokens/day (TPD) are NOT published in a capturable form and are stored as NULL
 * / omitted (see the TPD note in the file header — do NOT invent them).
 *
 * Model IDs follow Groq's current API ids, including the `meta-llama/`,
 * `openai/`, and `moonshotai/` org prefixes that Groq uses for partner/Llama-4
 * models. Models whose free-tier status could not be confirmed against current
 * official docs (deepseek-r1-distill-llama-70b, gemma2-9b-it, mistral-saba-24b,
 * qwen-qwq-32b, allam-2-7b) were intentionally removed rather than claimed free.
 *
 * One clearly paid-only model (llama-3.1-405b) is included so a free→paid
 * transition is observable in tests / future live runs.
 *
 * Confidence is "likely" because this is a secondary transcription of Groq's
 * docs (not a live API assertion); Groq shifts free-tier models/limits.
 */
export const GROQ_FREE_TIER: Record<string, GroqFreeTierEntry> = {
  "llama-3.1-8b-instant": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 6000, rpd: 14400, contextWindow: 131072, confidence: "likely", notes: "Highest daily quota on the free tier (14,400 RPD)." },
  "llama-3.3-70b-versatile": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 12000, rpd: 1000, contextWindow: 131072, confidence: "likely" },
  "meta-llama/llama-4-scout-17b-16e-instruct": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 30000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "Multimodal (image input supported)." },
  "llama-4-maverick-17b-128e-instruct": { free: true, inputPrice: 0, outputPrice: 0, rpm: 15, tpm: null, rpd: 500, contextWindow: 131072, confidence: "likely", notes: "Multimodal; reduced free-tier quota (15 RPM / 500 RPD). Free-tier TPM not separately published — stored as unknown." },
  "openai/gpt-oss-120b": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 8000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "OpenAI open-weight reasoning model." },
  "qwen/qwen3-32b": { free: true, inputPrice: 0, outputPrice: 0, rpm: 60, tpm: 6000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "Open-weight reasoning model." },
  "moonshotai/kimi-k2-instruct": { free: true, inputPrice: 0, outputPrice: 0, rpm: 60, tpm: 10000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "Open-weight multimodal reasoning model." },
  // Explicitly paid-only: present so the collector can correctly mark it PAID
  // (and so a free→paid / paid→free transition is observable in tests).
  "llama-3.1-405b": { free: false, inputPrice: 2.99, outputPrice: 2.99, rpm: null, tpm: null, rpd: null, contextWindow: 131072, confidence: "likely", notes: "Paid-only on Groq; not part of the free tier." },
};

/**
 * Bundled, frozen snapshot of Groq's free-tier model catalog. Used as the source
 * of truth so the collector runs WITHOUT an API key (the live /v1/models
 * endpoint requires a key). Clearly labeled as a snapshot in the run report.
 */
export const GROQ_CATALOG_SNAPSHOT: GroqModel[] = [
  { name: "llama-3.1-8b-instant", displayName: "Llama 3.1 8B Instant", description: "Small, fast open-weight model; highest free-tier daily quota.", contextWindow: 131072, version: "3.1" },
  { name: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B Versatile", description: "General-purpose open-weight model, free on Groq's free tier.", contextWindow: 131072, version: "3.3" },
  { name: "meta-llama/llama-4-scout-17b-16e-instruct", displayName: "Llama 4 Scout 17B 16E Instruct", description: "Long-context multimodal open-weight model, free on Groq's free tier.", contextWindow: 131072, version: "4" },
  { name: "llama-4-maverick-17b-128e-instruct", displayName: "Llama 4 Maverick 17B 128E Instruct", description: "Multimodal open-weight model, reduced free-tier quota.", contextWindow: 131072, version: "4" },
  { name: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B", description: "OpenAI open-weight reasoning model, free on Groq's free tier.", contextWindow: 131072, version: "120b" },
  { name: "qwen/qwen3-32b", displayName: "Qwen 3 32B", description: "Open-weight reasoning model, free on Groq's free tier.", contextWindow: 131072, version: "3" },
  { name: "moonshotai/kimi-k2-instruct", displayName: "Kimi K2 Instruct", description: "Open-weight multimodal reasoning model, free on Groq's free tier.", contextWindow: 131072, version: "2" },
  { name: "llama-3.1-405b", displayName: "Llama 3.1 405B", description: "Large open-weight model, paid-only on Groq.", contextWindow: 131072, version: "3.1" },
];

// ---------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------

function externalIdOf(name: string): string {
  return name.replace(/^models\//, "");
}

function deriveModalities(raw: GroqModel, id: string): {
  inputModalities: string[];
  outputModalities: string[];
  visionSupport: boolean;
  toolCalling: boolean;
  reasoningSupport: boolean;
  isOpenSource: boolean;
} {
  const lower = id.toLowerCase();
  const visionSupport = /vision|llama-4|scout|maverick|llama-3\.2/.test(lower);
  // Reasoning-capable free models in the current snapshot: GPT-OSS, Qwen3, Kimi K2,
  // plus the legacy r1/qwq deepseek naming.
  const reasoningSupport = /r1|qwq|deepseek-r1|reason|gpt-oss|qwen3|kimi/.test(lower);
  const isOpenSource =
    lower.startsWith("llama") ||
    lower.startsWith("gemma") ||
    lower.startsWith("qwen") ||
    lower.startsWith("deepseek") ||
    lower.startsWith("mistral") ||
    lower.startsWith("mixtral") ||
    lower.startsWith("allam") ||
    lower.startsWith("openai") ||
    lower.startsWith("moonshotai");

  return {
    inputModalities: visionSupport ? ["text", "image"] : ["text"],
    outputModalities: ["text"],
    visionSupport,
    toolCalling: true,
    reasoningSupport,
    isOpenSource,
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeGroqModel(raw: GroqModel, providerId: string = GROQ_PROVIDER_ID): NormalizedModel {
  const externalId = externalIdOf(raw.name);
  const modelId = externalId; // unprefixed — matches direct-provider convention (like Gemini)
  const availId = `${modelId}__${providerId}`;

  const entry = GROQ_FREE_TIER[externalId];
  const isFree = !!entry?.free;

  let free: FreeClassification;
  if (!entry) {
    free = {
      isFree: false,
      pricingClass: "unknown",
      accessType: "direct_api",
      reason: "Not present in the Groq free-tier / pricing transcription — cannot assert free status.",
    };
  } else if (!entry.free) {
    free = {
      isFree: false,
      pricingClass: "paid",
      accessType: "direct_api",
      reason: `Paid-only on Groq (input $${entry.inputPrice}/M, output $${entry.outputPrice}/M). ${entry.notes ?? ""}`.trim(),
    };
  } else {
    const limits: string[] = [];
    if (entry.rpm != null) limits.push(`${entry.rpm} RPM`);
    if (entry.tpm != null) limits.push(`${entry.tpm.toLocaleString()} TPM`);
    if (entry.rpd != null) limits.push(`${entry.rpd.toLocaleString()} requests/day`);
    const limitNote = limits.length
      ? `Documented free-tier rate limits: ${limits.join(", ")} (per Groq's official rate-limits docs). Groq also publishes a tokens/day (TPD) cap that this collector does not currently store.`
      : "Free-tier rate limits are not documented for this model.";
    free = {
      isFree: true,
      pricingClass: "free_tier",
      accessType: "direct_api",
      reason:
        "Free tier via Groq (direct provider access, OpenAI-compatible API). " +
        "Input and output tokens are free of charge on Groq's free tier — no credit card required. " +
        `${limitNote} ` +
        "The free tier is for development/prototyping; production workloads require a paid plan. " +
        `Snapshot transcribed from Groq's official docs (${GROQ_SNAPSHOT_DATE}); free-tier models/limits shift — verify at ${GROQ_PRICING_URL}.`,
    };
  }

  const mod = deriveModalities(raw, externalId);
  const family = externalId.replace(/-(\d+(\.\d+)*).*$/, "") || externalId;
  const version = raw.version ?? (externalId.match(/(\d+(?:\.\d+)*)/) ?? [null])[1] ?? null;

  const model: NormalizedModelRow = {
    id: modelId,
    name: raw.displayName ?? externalId,
    providerId: GROQ_PROVIDER_ID,
    author: GROQ_PROVIDER_ID,
    family,
    version,
    releaseDate: null,
    contextWindow: raw.contextWindow ?? entry?.contextWindow ?? null,
    maxOutputTokens: null,
    inputModalities: mod.inputModalities,
    outputModalities: mod.outputModalities,
    visionSupport: mod.visionSupport,
    toolCalling: mod.toolCalling,
    structuredOutput: true,
    reasoningSupport: mod.reasoningSupport,
    isOpenSource: mod.isOpenSource,
    description: raw.description ?? null,
    officialPageUrl: GROQ_MODELS_URL,
  };

  let availability: NormalizedAvailabilityRow | null = null;
  if (isFree && entry) {
    availability = {
      id: availId,
      modelId,
      providerId: GROQ_PROVIDER_ID,
      accessType: "direct_api" as AccessType,
      status: "available" as AvailabilityStatus,
      confidence: entry.confidence,
      isFree: true,
      pricingClass: "free_tier",
      free,
      inputPricePerMillion: entry.inputPrice,
      outputPricePerMillion: entry.outputPrice,
      rateLimitRpm: entry.rpm,
      rateLimitTpm: entry.tpm,
      dailyLimit: entry.rpd,
      monthlyLimit: null,
      requiresApiKey: true,
      requiresPaymentMethod: false,
      paymentRequirementKnown: true,
      requiresSignup: true,
      expiresAt: null,
      sourceUrl: GROQ_PRICING_URL,
      sourceType: "official_docs",
      sourceTitle: "Groq",
      apiFormat: "openai_chat_completions",
    };
  }

  return { model, availability, isFree, free, raw: raw as any };
}

// ---------------------------------------------------------------------------
// Collector (implements the shared Collector contract)
// ---------------------------------------------------------------------------

export class GroqCollector {
  readonly id = GROQ_PROVIDER_ID;
  readonly displayName = "Groq";

  async discover(): Promise<RawModelListing[]> {
    return GROQ_CATALOG_SNAPSHOT.map((m) => ({
      externalId: externalIdOf(m.name),
      displayName: m.displayName ?? m.name,
      family: m.name.replace(/-(\d+(\.\d+)*).*$/, "") || m.name,
      version: m.version,
    }));
  }

  async fetchPricing(externalId: string): Promise<RawPricing | null> {
    const entry = GROQ_FREE_TIER[externalId];
    if (!entry) return null;
    return {
      externalId,
      freeAccess: entry.free,
      accessType: "direct_api",
      status: "available",
      requiresPaymentMethod: false,
      requiresApiKey: true,
      requiresSignup: true,
      pricePerMillionIn: entry.inputPrice,
      pricePerMillionOut: entry.outputPrice,
      sourceUrl: GROQ_PRICING_URL,
      sourceTitle: "Groq",
      sourceType: "official_docs",
      expiresAt: null,
    };
  }

  normalize(externalId: string, raw: RawPricing): NormalizedAvailability {
    const entry = GROQ_FREE_TIER[externalId];
    return {
      id: `${externalId}__${GROQ_PROVIDER_ID}`,
      modelId: externalId,
      providerId: GROQ_PROVIDER_ID,
      externalId,
      freeAccess: !!raw.freeAccess,
      accessType: raw.accessType ?? "direct_api",
      status: raw.status ?? "available",
      confidence: entry?.confidence ?? "likely",
      requiresPaymentMethod: raw.requiresPaymentMethod ?? false,
      paymentRequirementKnown: true,
      requiresApiKey: raw.requiresApiKey ?? true,
      requiresSignup: raw.requiresSignup ?? true,
      pricePerMillionIn: raw.pricePerMillionIn ?? null,
      pricePerMillionOut: raw.pricePerMillionOut ?? null,
      freeQuotaValue: null,
      freeQuotaUnit: null,
      freeQuotaPeriod: null,
      expiresAt: raw.expiresAt ?? null,
      sourceUrl: raw.sourceUrl ?? null,
      sourceTitle: raw.sourceTitle ?? null,
      sourceType: raw.sourceType ?? "official_docs",
    };
  }

  validate(a: NormalizedAvailability): string[] {
    const issues: string[] = [];
    if (a.freeAccess && !a.accessType) issues.push("freeAccess set without accessType");
    if (a.freeAccess && a.requiresPaymentMethod) issues.push("available but requires payment method while marked free");
    if (a.status === "available" && a.requiresPaymentMethod) issues.push("available but requires payment method");
    return issues;
  }
}

export const groqCollector = new GroqCollector() as unknown as Collector;
