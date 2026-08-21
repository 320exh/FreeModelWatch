import type { AccessType, AvailabilityStatus, VerificationConfidence, CollectionMode } from "../types";

// ---------------------------------------------------------------------------
// Official OpenRouter API — single source of truth for this collector.
//
// Endpoint: GET https://openrouter.ai/api/v1/models
// Docs:     https://openrouter.ai/docs/api/api-reference/models/get-models
//
// Auth: NOT required for the public model-list endpoint (verified against the
//       official docs; an API key is only needed to make inference requests).
// Rate limits: the public catalog is served by OpenRouter's CDN; we still
//               apply our own client-side timeout + retry/backoff so we never
//               hammer the endpoint.
//
// Each model in `data` exposes:
//   id                 stable slug, e.g. "meta-llama/llama-3.1-8b-instruct:free"
//   name               human display name
//   canonical_slug     normalized id (author/slug)
//   context_length     integer token context window
//   created            unix seconds
//   description        free text
//   architecture       { input_modalities[], output_modalities[], modality, instruct_type, tokenizer }
//   pricing            { prompt, completion, request, image, web_search, internal_reasoning,
//                        input_cache_read, input_cache_write, ... } — ALL strings, USD per unit.
//                        A value of "0" means that dimension is free.
//   top_provider       { is_moderated, context_length, max_completion_tokens }
//   per_request_limits { completion_tokens, prompt_tokens } | null
//   supported_parameters[]   e.g. ["tools", "response_format", "temperature"]
//   supported_voices   string[] | null
//   reasoning          { default_enabled, default_effort, ... } | null
//   links.details      relative API path to the per-model endpoints
//   expiration_date    ISO date (YYYY-MM-DD) or null — when the model may be removed
//   knowledge_cutoff   ISO date or null
// ---------------------------------------------------------------------------

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
export const OPENROUTER_MODELS_URL = `${OPENROUTER_API_BASE}/models`;
export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_MODELS_PAGE = "https://openrouter.ai/models";

// Canonical source used for every claim this collector imports. Linking every
// free route to this one source (instead of creating 400 near-identical rows)
// keeps sources de-duplicated across runs.
export const OPENROUTER_SOURCE_ID = "src-openrouter-models-api";
export const OPENROUTER_SOURCE_URL = OPENROUTER_MODELS_URL;

export interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
  request?: string;
  image?: string;
  web_search?: string;
  internal_reasoning?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  image_token?: string;
  discount?: number;
  [key: string]: string | number | undefined;
}

export interface OpenRouterArchitecture {
  input_modalities?: string[];
  output_modalities?: string[];
  modality?: string;
  instruct_type?: string;
  tokenizer?: string;
}

export interface OpenRouterTopProvider {
  is_moderated?: boolean;
  context_length?: number;
  max_completion_tokens?: number;
}

export interface OpenRouterReasoning {
  default_enabled?: boolean;
  default_effort?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  canonical_slug?: string;
  context_length?: number;
  created?: number;
  description?: string;
  architecture?: OpenRouterArchitecture;
  pricing?: OpenRouterPricing;
  top_provider?: OpenRouterTopProvider;
  per_request_limits?: { completion_tokens?: number; prompt_tokens?: number } | null;
  supported_parameters?: string[];
  supported_voices?: string[] | null;
  reasoning?: OpenRouterReasoning | null;
  links?: { details?: string };
  expiration_date?: string | null;
  knowledge_cutoff?: string | null;
}

export interface OpenRouterCatalogResponse {
  data: OpenRouterModel[];
}

// ---------------------------------------------------------------------------
// Pricing helpers
// ---------------------------------------------------------------------------

/** OpenRouter prices are USD *per token*. Convert to USD *per million tokens*. */
export function pricePerMillion(priceStr: string | number | undefined | null): number | null {
  if (priceStr == null) return null;
  const n = typeof priceStr === "number" ? priceStr : Number(priceStr);
  if (!Number.isFinite(n)) return null;
  return n * 1_000_000;
}

/**
 * Decide whether a model is genuinely FREE (zero-cost inference) vs PAID.
 *
 * RULE (documented, authoritative):
 *   A model is classified FREE only when EVERY usage-priced dimension that
 *   OpenRouter exposes is explicitly "0" (zero cost). We deliberately do NOT
 *   trust the model name (e.g. a ":free" suffix is a hint, not proof) and we
 *   do NOT treat promotional credits / free-tier quotas as "free" — those are
 *   separate `AccessType`s and OpenRouter's free models here are pure
 *   zero-cost inference.
 *
 *   Free dimensions checked (a missing key is treated as "0"/free):
 *     - prompt            (input token price)
 *     - completion        (output token price)
 *     - request           (per-request price)
 *     - image             (image input price)
 *     - web_search        (per web-search price)
 *     - internal_reasoning(reasoning token price)
 *
 *   If ANY of those is a positive number, the model is PAID and must NOT be
 *   labeled FREE. A `discount` of >= 1 also means free, but the top-level
 *   price strings already reflect the effective (post-discount) price per the
 *   OpenRouter docs, so the string check is sufficient and authoritative.
 *
 * Returns the classification used for both ingestion and the UI "why free".
 */
export interface FreeClassification {
  isFree: boolean;
  /** Short machine classification used in notes / debugging. */
  pricingClass: "zero_cost_inference" | "free_tier" | "paid" | "unknown";
  accessType: AccessType;
  reason: string;
}

const FREE_PRICE_KEYS: (keyof OpenRouterPricing)[] = [
  "prompt",
  "completion",
  "request",
  "image",
  "web_search",
  "internal_reasoning",
];

export function classifyPricing(pricing: OpenRouterPricing | undefined | null): FreeClassification {
  if (!pricing) {
    return {
      isFree: false,
      pricingClass: "unknown",
      accessType: "free_through_aggregator",
      reason: "No pricing object returned by the API — cannot assert free status.",
    };
  }

  const problems: string[] = [];
  let hasPositive = false;
  let hasNegative = false;
  for (const key of FREE_PRICE_KEYS) {
    const raw = pricing[key];
    if (raw == null) continue; // absent dimension is treated as free
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      // Non-numeric sentinel (e.g. "-1" encoded as a string that isn't a number).
      problems.push(`${String(key)}=${raw}`);
      hasNegative = true;
      continue;
    }
    if (n > 0) {
      hasPositive = true;
      problems.push(`${String(key)}=${raw}`);
    } else if (n < 0) {
      // OpenRouter uses "-1" as a sentinel for routing/meta models whose price is
      // NOT a per-token amount (e.g. openrouter/auto picks a sub-model dynamically).
      // A negative price is NOT zero-cost inference and must not be classified free.
      hasNegative = true;
      problems.push(`${String(key)}=${raw} (negative sentinel)`);
    }
  }

  if (hasPositive) {
    return {
      isFree: false,
      pricingClass: "paid",
      accessType: "free_through_aggregator",
      reason: `Paid: non-zero price(s) on ${problems.join(", ")}.`,
    };
  }

  if (hasNegative) {
    return {
      isFree: false,
      pricingClass: "unknown",
      accessType: "free_through_aggregator",
      reason: `Cannot assert free: negative/sentinel price on ${problems.join(", ")}. OpenRouter uses -1 for routing/meta models whose price is not a fixed per-token amount.`,
    };
  }

  // All known usage dimensions are zero (or absent). Treat as zero-cost inference.
  return {
    isFree: true,
    pricingClass: "zero_cost_inference",
    accessType: "free_through_aggregator",
    reason: "Zero-cost inference: prompt/completion/request/image/web_search/reasoning all priced at 0.",
  };
}

// ---------------------------------------------------------------------------
// HTTP: timeout + retry with exponential backoff (never hammer the provider)
// ---------------------------------------------------------------------------

export type FetchLike = (
  url: string,
  init?: unknown
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export class CollectorHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "CollectorHttpError";
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseRetryMs?: number;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new CollectorHttpError("Request aborted", undefined, "abort"));
      },
      { once: true }
    );
  });
}

/**
 * Fetch a JSON endpoint with a hard timeout and exponential-backoff retries.
 * Retries on: network errors, HTTP 429 (honoring Retry-After), and 5xx.
 * Does NOT retry on 4xx (except 429) — those are permanent client errors.
 */
export async function fetchJsonWithRetry(url: string, opts: FetchOptions = {}): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetries = opts.maxRetries ?? 3;
  const baseRetryMs = opts.baseRetryMs ?? 400;
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const res = await doFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "freeai.today-collector/1.0 (+https://freeai.today)",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status >= 500) {
        lastErr = new CollectorHttpError(`Upstream 5xx (${res.status})`, res.status);
      } else if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const wait = retryAfter ? Number(retryAfter) * 1000 : baseRetryMs * Math.pow(2, attempt);
        lastErr = new CollectorHttpError(`Rate limited (429)`, 429);
        if (attempt < maxRetries) {
          await delay(Number.isFinite(wait) ? wait : baseRetryMs, opts.signal);
          continue;
        }
      } else if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new CollectorHttpError(`HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
      } else {
        return await res.json();
      }
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }

    if (attempt < maxRetries) {
      const backoff = baseRetryMs * Math.pow(2, attempt);
      await delay(backoff, opts.signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new CollectorHttpError("Request failed", undefined, lastErr);
}

// ---------------------------------------------------------------------------
// Parsing / validation of the raw catalog
// ---------------------------------------------------------------------------

export function parseCatalog(json: any): OpenRouterModel[] {
  if (!json || !Array.isArray(json.data)) {
    throw new CollectorHttpError("Malformed catalog: missing `data` array");
  }
  return json.data as OpenRouterModel[];
}

export function authorOf(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > -1 ? modelId.slice(0, slash) : modelId;
}

// ---------------------------------------------------------------------------
// Normalization into FreeAI.today's internal schema
// ---------------------------------------------------------------------------

export interface NormalizedModelRow {
  id: string;
  name: string;
  providerId: string; // original upstream provider label (author), denormalized
  author: string;
  family: string | null;
  version: string | null;
  releaseDate: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  visionSupport: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  reasoningSupport: boolean;
  isOpenSource: boolean;
  description: string | null;
  officialPageUrl: string | null;
}

export interface NormalizedAvailabilityRow {
  id: string;
  modelId: string;
  providerId: string;
  accessType: AccessType;
  status: AvailabilityStatus;
  confidence: VerificationConfidence;
  isFree: boolean;
  pricingClass: FreeClassification["pricingClass"];
  free: FreeClassification;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  requiresApiKey: boolean;
  requiresPaymentMethod: boolean;
  paymentRequirementKnown: boolean;
  requiresSignup: boolean;
  expiresAt: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  sourceTitle: string | null;
  apiFormat: string;
  collectionMode: CollectionMode;
}

export interface NormalizedModel {
  model: NormalizedModelRow;
  availability: NormalizedAvailabilityRow | null; // null when the model is NOT free
  isFree: boolean;
  free: FreeClassification;
  raw: OpenRouterModel;
}

/** Turn one raw OpenRouter model into our internal normalized shape. */
export function normalizeModel(raw: OpenRouterModel, providerId: string = OPENROUTER_PROVIDER_ID): NormalizedModel {
  const slug = raw.canonical_slug ?? raw.id;
  const modelId = `${providerId}__${raw.id}`;
  const availId = `${modelId}__${providerId}`;
  const author = authorOf(raw.id);

  const arch = raw.architecture ?? {};
  const inputModalities = (arch.input_modalities ?? []).map((m) => String(m).toLowerCase());
  const outputModalities = (arch.output_modalities ?? []).map((m) => String(m).toLowerCase());
  const supported = raw.supported_parameters ?? [];

  const free = classifyPricing(raw.pricing);

  const contextWindow = raw.context_length ?? raw.top_provider?.context_length ?? null;
  const releaseDate = raw.created ? new Date(raw.created * 1000).toISOString().slice(0, 10) : null;

  const model: NormalizedModelRow = {
    id: modelId,
    name: raw.name ?? raw.id,
    providerId: author,
    author,
    family: author,
    version: raw.id.includes(":") ? raw.id.split(":").slice(1).join(":") || null : null,
    releaseDate,
    contextWindow,
    maxOutputTokens: raw.top_provider?.max_completion_tokens ?? null,
    inputModalities,
    outputModalities,
    // "Vision" means the model can *accept images as input* (multimodal
    // understanding) — keyed off input_modalities, NOT output_modalities
    // (which would only be true for image-generation models).
    visionSupport: inputModalities.includes("image"),
    toolCalling: supported.includes("tools") || supported.includes("tool_choice"),
    structuredOutput: supported.includes("response_format"),
    reasoningSupport: raw.reasoning?.default_enabled === true,
    isOpenSource:
      author.startsWith("mistral") ||
      author.startsWith("meta-llama") ||
      author.startsWith("qwen") ||
      author.startsWith("google"),
    description: raw.description ?? null,
    officialPageUrl: `${OPENROUTER_MODELS_PAGE}/${encodeURIComponent(slug)}`,
  };

  let availability: NormalizedAvailabilityRow | null = null;
  if (free.isFree) {
    // OpenRouter's catalog does NOT publish reliable per-model rate limits,
    // request caps, or token quotas. "Free" here means zero-cost inference only —
    // it must NOT be read as "unlimited". Record that explicitly so the UI never
    // implies unrestricted usage.
    const freeWithLimitsNote: FreeClassification = {
      ...free,
      reason: `${free.reason} Free inference pricing; usage limits (rate/request/token caps) are not specified by the source.`,
    };
    availability = {
      id: availId,
      modelId,
      providerId,
      accessType: free.accessType,
      status: "available",
      confidence: "likely",
      isFree: true,
      pricingClass: free.pricingClass,
      free: freeWithLimitsNote,
      inputPricePerMillion: pricePerMillion(raw.pricing?.prompt),
      outputPricePerMillion: pricePerMillion(raw.pricing?.completion),
      rateLimitRpm: null,
      rateLimitTpm: null,
      dailyLimit: null,
      monthlyLimit: null,
       requiresApiKey: true,
       requiresPaymentMethod: false,
       paymentRequirementKnown: false,
       requiresSignup: true,
      expiresAt: raw.expiration_date ?? null,
      sourceUrl: `${OPENROUTER_MODELS_PAGE}/${encodeURIComponent(slug)}`,
      sourceType: "official_docs",
      sourceTitle: "OpenRouter",
      apiFormat: "openai_chat_completions",
      collectionMode: "live",
    };
  }

  return { model, availability, isFree: free.isFree, free, raw };
}

// ---------------------------------------------------------------------------
// Collector (implements the shared Collector contract; OpenRouter exposes the
// whole catalog in one call, discovered inline).
// ---------------------------------------------------------------------------

export class OpenRouterCollector {
  readonly id = OPENROUTER_PROVIDER_ID;
  readonly displayName = "OpenRouter";

  /** Fetch + parse the live catalog. Throws (without side effects) on failure. */
  async fetchCatalog(opts: FetchOptions = {}): Promise<OpenRouterModel[]> {
    const json = await fetchJsonWithRetry(OPENROUTER_MODELS_URL, opts);
    return parseCatalog(json);
  }
}
