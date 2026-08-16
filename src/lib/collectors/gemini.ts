import type { AccessType, AvailabilityStatus, VerificationConfidence } from "../types";
import {
  fetchJsonWithRetry,
  CollectorHttpError,
  type FetchLike,
  type FetchOptions,
  type FreeClassification,
  type NormalizedModel,
  type NormalizedModelRow,
  type NormalizedAvailabilityRow,
} from "./openrouter";
import type { Collector, RawModelListing, RawPricing, NormalizedAvailability } from "./types";

// ---------------------------------------------------------------------------
// Official Google Gemini / Google AI Studio API — source of truth.
//
// Model catalog:
//   - Public docs:  https://ai.google.dev/gemini-api/docs/models
//   - Live API:     GET https://generativelanguage.googleapis.com/v1beta/models
//                   (REQUIRES ?key=API_KEY — verified: 403 without a key)
//
// Pricing (authoritative, published 2026-08-13):
//   https://ai.google.dev/gemini-api/docs/pricing
//   Free-of-charge input/output tiers exist for: Gemini 2.5 Pro, 2.5 Flash,
//   2.5 Flash-Lite, 2.5 Flash-Lite Preview, 2.0 Flash, 2.0 Flash-Lite, Gemma 4,
//   and the embedding models.
//
// Rate limits:
//   https://ai.google.dev/gemini-api/docs/rate-limits
//   IMPORTANT: Google no longer publishes a fixed public RPM/RPD/TPM grid for
//   the standard Gemini API. The official docs state limits vary by usage tier
//   and are shown per-project in Google AI Studio. The per-model token-rate
//   figures on that page ARE the published "tokens per minute" limit, captured
//   here as rate_limit_tpm. Per-minute request (RPM) and daily request (RPD)
//   limits are dynamic/unknown and stored as NULL (do NOT invent them).
//
// Billing:
//   https://ai.google.dev/gemini-api/docs/billing
//   The Free tier requires no credit card / no payment method.
// ---------------------------------------------------------------------------

export const GEMINI_PROVIDER_ID = "google";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_MODELS_URL = `${GEMINI_API_BASE}/models`;

export const GEMINI_SOURCE_CATALOG_ID = "src-gemini-models-api";
export const GEMINI_SOURCE_CATALOG_URL = "https://ai.google.dev/gemini-api/docs/models";
export const GEMINI_SOURCE_PRICING_ID = "src-gemini-pricing";
export const GEMINI_SOURCE_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";
export const GEMINI_SOURCE_RATELIMITS_ID = "src-gemini-rate-limits";
export const GEMINI_SOURCE_RATELIMITS_URL = "https://ai.google.dev/gemini-api/docs/rate-limits";
export const GEMINI_SOURCE_BILLING_ID = "src-gemini-billing";
export const GEMINI_SOURCE_BILLING_URL = "https://ai.google.dev/gemini-api/docs/billing";

export interface GeminiModel {
  name: string; // e.g. "models/gemini-2.5-flash"
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  version?: string;
  baseModelId?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTemperature?: number;
}

export interface GeminiCatalogResponse {
  models?: GeminiModel[];
}

interface GeminiFreeTierEntry {
  free: boolean;
  inputPrice: number; // USD per million tokens (0 = free)
  outputPrice: number; // USD per million tokens (0 = free)
  /** Published per-model token-rate limit (TPM) from the official rate-limits docs. */
  tpm: number | null;
  confidence: VerificationConfidence;
  notes?: string;
}

/**
 * Transcription of Google's official pricing + rate-limits pages (2026-08-13).
 * A model is FREE only when the official pricing page lists it as "Free of
 * charge". TPM values are the published per-model token-rate limits. RPM/RPD
 * are intentionally NOT recorded here (Google states they are dynamic per
 * usage tier and not a fixed public grid).
 *
 * Models NOT present in this table are treated as unknown and are not imported
 * by the collector.
 */
export const GEMINI_FREE_TIER: Record<string, GeminiFreeTierEntry> = {
  "gemini-2.5-flash": { free: true, inputPrice: 0, outputPrice: 0, tpm: 3_000_000, confidence: "likely" },
  "gemini-2.5-flash-lite": { free: true, inputPrice: 0, outputPrice: 0, tpm: 10_000_000, confidence: "likely" },
  "gemini-2.5-flash-lite-preview": { free: true, inputPrice: 0, outputPrice: 0, tpm: 10_000_000, confidence: "likely" },
  "gemini-2.5-pro": { free: true, inputPrice: 0, outputPrice: 0, tpm: 5_000_000, confidence: "likely" },
  "gemini-2.0-flash": { free: true, inputPrice: 0, outputPrice: 0, tpm: 10_000_000, confidence: "likely" },
  "gemini-2.0-flash-lite": { free: true, inputPrice: 0, outputPrice: 0, tpm: 10_000_000, confidence: "likely" },
  "gemini-3-flash": { free: true, inputPrice: 0, outputPrice: 0, tpm: 3_000_000, confidence: "likely" },
  "gemini-3.5-flash": { free: true, inputPrice: 0, outputPrice: 0, tpm: 3_000_000, confidence: "likely" },
  "gemini-3.6-flash": { free: true, inputPrice: 0, outputPrice: 0, tpm: 3_000_000, confidence: "likely" },
  "gemini-3.7-flash": { free: true, inputPrice: 0, outputPrice: 0, tpm: 3_000_000, confidence: "likely" },
  "gemini-3.1-flash-lite": { free: true, inputPrice: 0, outputPrice: 0, tpm: 10_000_000, confidence: "likely" },
  "gemini-3.5-flash-lite": { free: true, inputPrice: 0, outputPrice: 0, tpm: 10_000_000, confidence: "likely" },
  "gemma-4": { free: true, inputPrice: 0, outputPrice: 0, tpm: null, confidence: "likely" },
  "gemini-embedding": { free: true, inputPrice: 0, outputPrice: 0, tpm: 500_000, confidence: "likely" },
  "gemini-embedding-2": { free: true, inputPrice: 0, outputPrice: 0, tpm: 500_000, confidence: "likely" },
  // Explicitly paid-only: present so the collector can correctly mark it PAID
  // (and so a free→paid / paid→free transition is observable in tests).
  "gemini-3.1-pro-preview": { free: false, inputPrice: 1.5, outputPrice: 6, tpm: 1_000_000, confidence: "likely", notes: "Paid-only preview on the Gemini API." },
};

/**
 * Bundled, frozen snapshot of the official Gemini model catalog. Used as a
 * fallback so the collector runs WITHOUT an API key (the live models.list
 * endpoint requires a key). This snapshot is clearly labeled as a snapshot in
 * the run report; real deployments should set GEMINI_API_KEY for live discovery.
 */
export const GEMINI_CATALOG_SNAPSHOT: GeminiModel[] = [
  { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", description: "Fast multimodal model with a free tier.", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "2.5" },
  { name: "models/gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash-Lite", description: "Cost-efficient multimodal model.", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "2.5" },
  { name: "models/gemini-2.5-flash-lite-preview", displayName: "Gemini 2.5 Flash-Lite Preview", description: "Preview of Flash-Lite.", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "2.5" },
  { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", description: "High-capability multimodal model.", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "2.5" },
  { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", description: "Fast multimodal model.", inputTokenLimit: 1048576, outputTokenLimit: 8192, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "2.0" },
  { name: "models/gemini-2.0-flash-lite", displayName: "Gemini 2.0 Flash-Lite", description: "Small efficient model.", inputTokenLimit: 1048576, outputTokenLimit: 8192, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "2.0" },
  { name: "models/gemini-3-flash", displayName: "Gemini 3 Flash", description: "Next-gen fast model.", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "3.0" },
  { name: "models/gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview", description: "Paid-only preview model.", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "3.1" },
  { name: "models/gemma-4", displayName: "Gemma 4", description: "Open model family.", inputTokenLimit: 262144, outputTokenLimit: 8192, supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"], version: "4" },
  { name: "models/gemini-embedding-2", displayName: "Gemini Embedding 2", description: "Embedding model.", inputTokenLimit: 8192, outputTokenLimit: 0, supportedGenerationMethods: ["embedContent"], version: "2" },
];

// ---------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------

export function parseCatalog(json: any): GeminiModel[] {
  const models = json?.models;
  if (!Array.isArray(models)) {
    throw new CollectorHttpError("Malformed catalog: missing `models` array");
  }
  return models as GeminiModel[];
}

function externalIdOf(name: string): string {
  return name.replace(/^models\//, "");
}

function deriveModalities(raw: GeminiModel, id: string): {
  inputModalities: string[];
  outputModalities: string[];
  visionSupport: boolean;
  toolCalling: boolean;
  reasoningSupport: boolean;
  isOpenSource: boolean;
} {
  const methods = raw.supportedGenerationMethods ?? [];
  const lower = id.toLowerCase();

  if (methods.includes("embedContent") || lower.includes("embedding")) {
    return {
      inputModalities: ["text"],
      outputModalities: ["text"],
      visionSupport: false,
      toolCalling: false,
      reasoningSupport: false,
      isOpenSource: lower.startsWith("gemma"),
    };
  }

  if (lower.includes("image") || lower.includes("imagen") || lower.includes("nano-banana")) {
    return {
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
      visionSupport: true,
      toolCalling: false,
      reasoningSupport: false,
      isOpenSource: false,
    };
  }

  // General Gemini chat models accept multimodal input (text + image + audio).
  const reasoning = /\b(2\.5|3\.)|flash|pro/.test(lower) && !lower.includes("2.0-flash-lite");
  return {
    inputModalities: ["text", "image", "audio"],
    outputModalities: ["text"],
    visionSupport: true,
    toolCalling: true,
    reasoningSupport: reasoning,
    isOpenSource: lower.startsWith("gemma"),
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeModel(raw: GeminiModel, providerId: string = GEMINI_PROVIDER_ID): NormalizedModel {
  const externalId = externalIdOf(raw.name);
  const modelId = externalId; // unprefixed — matches seed google model ids
  const availId = `${modelId}__${providerId}`;

  const entry = GEMINI_FREE_TIER[externalId];
  const isFree = !!entry?.free;

  let free: FreeClassification;
  if (!entry) {
    free = {
      isFree: false,
      pricingClass: "unknown",
      accessType: "direct_api",
      reason: "Not present in the official Gemini free-tier / pricing transcription — cannot assert free status.",
    };
  } else if (!entry.free) {
    free = {
      isFree: false,
      pricingClass: "paid",
      accessType: "direct_api",
      reason: `Paid-only on the Gemini API (input $${entry.inputPrice}/M, output $${entry.outputPrice}/M). ${entry.notes ?? ""}`.trim(),
    };
  } else {
    const tpmNote = entry.tpm != null
      ? `Per-model token-rate limit: ${entry.tpm.toLocaleString()} TPM (from Google's official rate-limits docs).`
      : "Per-model token-rate limit not published as a fixed value.";
    free = {
      isFree: true,
      pricingClass: "free_tier",
      accessType: "direct_api",
      reason:
        "Free tier via Google AI Studio / Gemini API (direct provider access, NOT an aggregator). " +
        "Input and output tokens are free of charge on the Free tier. " +
        "Per-minute request (RPM) and daily request (RPD) limits vary by usage tier and are shown per-project in Google AI Studio; " +
        "Google's official docs do not publish a fixed public RPM/RPD grid for the standard API. " +
        `${tpmNote} No credit card required for the Free tier.`,
    };
  }

  const mod = deriveModalities(raw, externalId);
  const family = externalId.replace(/-(\d+(\.\d+)*).*$/, "") || externalId;

  const model: NormalizedModelRow = {
    id: modelId,
    name: raw.displayName ?? externalId,
    providerId: GEMINI_PROVIDER_ID,
    author: GEMINI_PROVIDER_ID,
    family,
    version: raw.version ?? (externalId.match(/(\d+(?:\.\d+)*)/) ?? [null])[1],
    releaseDate: null,
    contextWindow: raw.inputTokenLimit ?? null,
    maxOutputTokens: raw.outputTokenLimit ?? null,
    inputModalities: mod.inputModalities,
    outputModalities: mod.outputModalities,
    visionSupport: mod.visionSupport,
    toolCalling: mod.toolCalling,
    structuredOutput: true,
    reasoningSupport: mod.reasoningSupport,
    isOpenSource: mod.isOpenSource,
    description: raw.description ?? null,
    officialPageUrl: `https://ai.google.dev/gemini-api/docs/models#${externalId.replace(/\./g, "-")}`,
  };

  let availability: NormalizedAvailabilityRow | null = null;
  if (isFree && entry) {
    availability = {
      id: availId,
      modelId,
      providerId: GEMINI_PROVIDER_ID,
      accessType: "direct_api" as AccessType,
      status: "available",
      confidence: entry.confidence,
      isFree: true,
      pricingClass: "free_tier",
      free,
      inputPricePerMillion: entry.inputPrice,
      outputPricePerMillion: entry.outputPrice,
      rateLimitRpm: null,
      rateLimitTpm: entry.tpm,
      dailyLimit: null,
      monthlyLimit: null,
      requiresApiKey: true,
      requiresPaymentMethod: false,
      requiresSignup: true,
      expiresAt: null,
      sourceUrl: GEMINI_SOURCE_PRICING_URL,
      sourceType: "official_docs",
      sourceTitle: "Google AI Studio / Gemini API",
      apiFormat: "gemini",
    };
  }

  return { model, availability, isFree, free, raw: raw as any };
}

// ---------------------------------------------------------------------------
// Collector (implements the shared Collector contract)
// ---------------------------------------------------------------------------

export class GeminiCollector {
  readonly id = GEMINI_PROVIDER_ID;
  readonly displayName = "Google Gemini / AI Studio";

  /** Fetch + parse the live catalog. Throws (without side effects) on failure. */
  async fetchCatalog(opts: FetchOptions = {}): Promise<GeminiModel[]> {
    const apiKey = (opts as any).apiKey ?? process.env.GEMINI_API_KEY;
    const url = apiKey ? `${GEMINI_MODELS_URL}?key=${encodeURIComponent(apiKey)}` : GEMINI_MODELS_URL;
    const json = await fetchJsonWithRetry(url, opts);
    return parseCatalog(json);
  }

  // --- Generic Collector contract (used by the example orchestrator/registry) ---

  async discover(): Promise<RawModelListing[]> {
    return GEMINI_CATALOG_SNAPSHOT.map((m) => ({
      externalId: externalIdOf(m.name),
      displayName: m.displayName ?? m.name,
      family: m.name.replace(/-(\d+(\.\d+)*).*$/, "") || m.name,
      version: m.version,
    }));
  }

  async fetchPricing(externalId: string): Promise<RawPricing | null> {
    const entry = GEMINI_FREE_TIER[externalId];
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
      sourceUrl: GEMINI_SOURCE_PRICING_URL,
      sourceTitle: "Google AI Studio / Gemini API",
      sourceType: "official_docs",
      expiresAt: null,
    };
  }

  normalize(externalId: string, raw: RawPricing): NormalizedAvailability {
    const entry = GEMINI_FREE_TIER[externalId];
    const tpm = entry?.tpm ?? null;
    return {
      id: `${externalId}__${GEMINI_PROVIDER_ID}`,
      modelId: externalId,
      providerId: GEMINI_PROVIDER_ID,
      externalId,
      freeAccess: !!raw.freeAccess,
      accessType: raw.accessType ?? "direct_api",
      status: raw.status ?? "available",
      confidence: entry?.confidence ?? "likely",
      requiresPaymentMethod: raw.requiresPaymentMethod ?? false,
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

  validate(_a: NormalizedAvailability): string[] {
    return [];
  }
}

export const geminiCollector = new GeminiCollector() as unknown as Collector;
