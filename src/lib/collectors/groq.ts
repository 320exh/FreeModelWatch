import type { AccessType, AvailabilityStatus, VerificationConfidence, CollectionMode } from "../types";
import {
  type FreeClassification,
  type NormalizedModel,
  type NormalizedModelRow,
  type NormalizedAvailabilityRow,
} from "./openrouter";
import type { Collector, RawModelListing, RawPricing, NormalizedAvailability } from "./types";

// ---------------------------------------------------------------------------
// Groq — direct provider (OpenAI-compatible API).
//
// Source-of-truth strategy (HYBRID, two complementary sources):
//   1. LIVE CATALOG  — GET https://api.groq.com/openai/v1/models (requires an
//      API key). Authoritative for *which models exist* and their IDs, `active`
//      flag, `created` and `context_window`. It does NOT contain any pricing /
//      free-tier / rate-limit information.
//   2. OFFICIAL FREE PLAN DOC — https://console.groq.com/docs/rate-limits
//      (Free Plan tab). Authoritative for *which models are free* and their
//      per-model free-tier rate limits (RPM / TPM / RPD). The catalog API and
//      the pricing page never tell us this.
//
//   CONFIRMED FREE = model present in (1) with active=true AND present in (2).
//   UNKNOWN        = present in (1) but absent from (2) — NEVER claimed free OR
//                    paid (absence from the free list is NOT proof of paid).
//   STALE/REMOVED  = present in (2) but absent/inactive in (1) — not emitted.
//   PAID           = only with explicit authoritative evidence (e.g. the docs
//                    list it as a paid/Developer-tier model, or it is absent
//                    from the free list with a known paid price).
//
// When no GROQ_API_KEY is set (or when either live source fails), the collector
// falls back to a BUNDLED, FROZEN snapshot (GROQ_FREE_TIER + GROQ_CATALOG_SNAPSHOT)
// so it runs offline. The snapshot is clearly labeled and its source/date are
// recorded in every row. Failure of a live source degrades to the frozen
// snapshot rather than emitting partial/incorrect data — we never invent.
//
// Model catalog:   https://console.groq.com/docs/models
// Pricing:         https://groq.com/pricing
// Rate limits:     https://console.groq.com/docs/rate-limits
// ---------------------------------------------------------------------------

export const GROQ_PROVIDER_ID = "groq";
export const GROQ_API_BASE = "https://api.groq.com/openai/v1";
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

export const GROQ_SNAPSHOT_DATE = "2026-08-20";

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
 * Frozen, offline fallback bundle of Groq's free-tier + pricing + rate limits,
 * last verified 2026-08-20 against Groq's official Free Plan rate-limits table
 * (console.groq.com/docs/rate-limits, Free Plan tab) and the live /v1/models
 * catalog (13 active models at that time). This bundle is the OFFLINE fallback
 * used when no GROQ_API_KEY is present; the live collector (prepareLive)
 * supersedes it by intersecting the real /v1/models catalog with the parsed Free
 * Plan doc table.
 *
 * A model is FREE only when it appears in Groq's published free-tier table.
 * RPM/TPM/RPD are the documented per-model free-tier ceilings. Monthly caps and
 * tokens/day (TPD) are NOT published in a capturable form and are stored as NULL
 * / omitted (see the TPD note in the file header — do NOT invent them).
 *
 * Model IDs follow Groq's current API ids, including the `meta-llama/`,
 * `openai/`, `canopylabs/`, and `qwen/` org prefixes Groq uses for partner
 * models. Models that are in Groq's live catalog but NOT confirmed free on the
 * Free Plan table — e.g. allam-2-7b — are intentionally included ONLY in
 * GROQ_CATALOG_SNAPSHOT (so they are discovered as catalog models) but excluded
 * from GROQ_FREE_TIER, so they are classified `unknown` (never claimed free; no
 * fabrication).
 *
 * One clearly paid-only model (llama-3.1-405b) is included so a free→paid
 * transition is observable in tests / future live runs. It is NOT part of the
 * catalog snapshot (it was absent from the live /v1/models catalog on 2026-08-20).
 *
 * Confidence is "likely" because this frozen bundle is a snapshot, not a live API
 * assertion; Groq shifts free-tier models/limits. (Live runs carry "verified".)
 */
export const GROQ_FREE_TIER: Record<string, GroqFreeTierEntry> = {
  "groq/compound": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 70000, rpd: 250, contextWindow: 131072, confidence: "likely", notes: "Groq compound reasoning model, free on the current Free Plan." },
  "groq/compound-mini": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 70000, rpd: 250, contextWindow: 131072, confidence: "likely", notes: "Groq smaller compound reasoning model, free on the current Free Plan." },
  "canopylabs/orpheus-arabic-saudi": { free: true, inputPrice: 0, outputPrice: 0, rpm: 10, tpm: 1200, rpd: 100, contextWindow: 131072, confidence: "likely", notes: "Arabic speech/voice model, free on the current Free Plan." },
  "canopylabs/orpheus-v1-english": { free: true, inputPrice: 0, outputPrice: 0, rpm: 10, tpm: 1200, rpd: 100, contextWindow: 131072, confidence: "likely", notes: "English speech/voice model, free on the current Free Plan." },
  "meta-llama/llama-prompt-guard-2-22m": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 15000, rpd: 14400, contextWindow: 131072, confidence: "likely", notes: "Prompt-injection guard model, free on the current Free Plan." },
  "meta-llama/llama-prompt-guard-2-86m": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 15000, rpd: 14400, contextWindow: 131072, confidence: "likely", notes: "Prompt-injection guard model, free on the current Free Plan." },
  "openai/gpt-oss-120b": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 8000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "OpenAI open-weight reasoning model, free on the current Free Plan." },
  "openai/gpt-oss-20b": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 8000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "OpenAI open-weight reasoning model, free on the current Free Plan." },
  "openai/gpt-oss-safeguard-20b": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 8000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "OpenAI open-weight safeguard model, free on the current Free Plan." },
  "qwen/qwen3.6-27b": { free: true, inputPrice: 0, outputPrice: 0, rpm: 30, tpm: 8000, rpd: 1000, contextWindow: 131072, confidence: "likely", notes: "Qwen open-weight model, free on the current Free Plan." },
  "whisper-large-v3": { free: true, inputPrice: 0, outputPrice: 0, rpm: 20, tpm: 7200, rpd: 2000, contextWindow: 131072, confidence: "likely", notes: "OpenAI Whisper v3 transcription model, free on the current Free Plan." },
  "whisper-large-v3-turbo": { free: true, inputPrice: 0, outputPrice: 0, rpm: 20, tpm: 7200, rpd: 2000, contextWindow: 131072, confidence: "likely", notes: "OpenAI Whisper v3 Turbo transcription model, free on the current Free Plan." },
  // Explicitly paid-only: present so the collector can correctly mark it PAID
  // (and so a free→paid / paid→free transition is observable in tests).
  "llama-3.1-405b": { free: false, inputPrice: 2.99, outputPrice: 2.99, rpm: null, tpm: null, rpd: null, contextWindow: 131072, confidence: "likely", notes: "Paid-only on Groq; not part of the free tier." },
};

/**
 * Bundled, frozen snapshot of Groq's free-tier model catalog. Used as the source
 * of truth so the collector runs WITHOUT an API key (the live /v1/models
 * endpoint requires a key). Clearly labeled as a snapshot in the run report.
 * Superseded by the live collector when GROQ_API_KEY is present.
 */
export const GROQ_CATALOG_SNAPSHOT: GroqModel[] = [
  { name: "groq/compound", displayName: "Compound", description: "Groq compound reasoning model, free on Groq's free tier.", contextWindow: 131072, version: "compound" },
  { name: "groq/compound-mini", displayName: "Compound Mini", description: "Groq smaller compound reasoning model, free on Groq's free tier.", contextWindow: 131072, version: "compound-mini" },
  { name: "canopylabs/orpheus-arabic-saudi", displayName: "Orpheus Arabic (Saudi)", description: "Arabic speech/voice model, free on Groq's free tier.", contextWindow: 131072, version: "orpheus" },
  { name: "canopylabs/orpheus-v1-english", displayName: "Orpheus v1 English", description: "English speech/voice model, free on Groq's free tier.", contextWindow: 131072, version: "orpheus" },
  { name: "meta-llama/llama-prompt-guard-2-22m", displayName: "Llama Prompt Guard 2 22M", description: "Prompt-injection guard model, free on Groq's free tier.", contextWindow: 131072, version: "2" },
  { name: "meta-llama/llama-prompt-guard-2-86m", displayName: "Llama Prompt Guard 2 86M", description: "Prompt-injection guard model, free on Groq's free tier.", contextWindow: 131072, version: "2" },
  { name: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B", description: "OpenAI open-weight reasoning model, free on Groq's free tier.", contextWindow: 131072, version: "120b" },
  { name: "openai/gpt-oss-20b", displayName: "GPT-OSS 20B", description: "OpenAI open-weight reasoning model, free on Groq's free tier.", contextWindow: 131072, version: "20b" },
  { name: "openai/gpt-oss-safeguard-20b", displayName: "GPT-OSS Safeguard 20B", description: "OpenAI open-weight safeguard model, free on Groq's free tier.", contextWindow: 131072, version: "20b" },
  { name: "qwen/qwen3.6-27b", displayName: "Qwen 3.6 27B", description: "Qwen open-weight model, free on Groq's free tier.", contextWindow: 131072, version: "3.6" },
  { name: "whisper-large-v3", displayName: "Whisper Large v3", description: "OpenAI Whisper v3 transcription model, free on Groq's free tier.", contextWindow: 131072, version: "v3" },
  { name: "whisper-large-v3-turbo", displayName: "Whisper Large v3 Turbo", description: "OpenAI Whisper v3 Turbo transcription model, free on Groq's free tier.", contextWindow: 131072, version: "v3-turbo" },
  { name: "allam-2-7b", displayName: "Allam 2 7B", description: "SDAIA Allam Arabic model; in Groq's catalog but NOT confirmed free on the Free Plan table.", contextWindow: 131072, version: "2" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function externalIdOf(name: string): string {
  return name.replace(/^models\//, "");
}

function humanize(id: string): string {
  const last = id.split("/").pop() ?? id;
  return last
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function versionOf(id: string): string | undefined {
  const m = id.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : undefined;
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
// Normalization — frozen snapshot path (offline fallback)
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
      collectionMode: "frozen",
    };
  }

  return { model, availability, isFree, free, raw: raw as any };
}

// ---------------------------------------------------------------------------
// Live catalog + Free Plan doc (hybrid two-source discovery)
// ---------------------------------------------------------------------------

export interface GroqCatalogModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  active?: boolean;
  context_window?: number | null;
}

export interface GroqCatalogResult {
  status: "ok" | "error";
  models: GroqCatalogModel[];
  error?: string;
}

export interface GroqFreePlanEntry {
  id: string;
  rpm: number | null;
  tpm: number | null;
  rpd: number | null;
  contextWindow?: number | null;
  confidence: VerificationConfidence;
  status: "free" | "paid" | "unknown";
}

export interface GroqFreePlanParseResult {
  status: "parsed" | "empty" | "partial" | "failed";
  entries: GroqFreePlanEntry[];
  missing: string[];
  error?: string;
  rawLen?: number;
}

export interface GroqFreePlanResult {
  status: "ok" | "error";
  entries: GroqFreePlanEntry[];
  error?: string;
}

export interface GroqCollectorOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function cellText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumericCell(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim().replace(/,/g, "");
  if (!t || t === "-" || t.toLowerCase() === "n/a" || t.toLowerCase() === "—" || t.toLowerCase() === "none") return null;
  const mult = /k/i.test(t) ? 1_000 : /m/i.test(t) ? 1_000_000 : 1;
  const num = parseFloat(t.replace(/[kKmM]/g, ""));
  if (Number.isNaN(num)) return null;
  return Math.round(num * mult);
}

/**
 * Parse Groq's official Rate Limits HTML (Free Plan tab) into structured free
 * entries. The page is JS-rendered, so production robustness may require
 * fetching the underlying data feed; here we parse the served HTML defensively
 * and degrade to `empty` / `failed` when we cannot extract a usable Free Plan
 * table (callers then fall back to the frozen snapshot — never invent).
 */
export function parseGroqFreePlanHtml(html: string): GroqFreePlanParseResult {
  if (!html || !html.trim()) return { status: "failed", entries: [], missing: [], error: "Empty HTML" };
  try {
    // Structural extraction: Groq's Rate Limits page is server-rendered and the
    // Free Plan model table is present as real <table> markup in the initial
    // HTML. The Free/Developer plan selectors are ADJACENT tab buttons (not
    // far-apart section headings), and the column header row lives in a
    // different <table> element than the model <tbody> rows. We therefore:
    //   1. locate the model-table header row (MODEL ID / RPM / RPD / TPM / ...)
    //      by its column text, and
    //   2. walk the subsequent <tr> rows, stopping at the next header row
    //      (e.g. a Developer Plan table), accepting only rows whose first cell
    //      is a model id and whose remaining cells are numeric-or-dash limit
    //      values (which excludes doc tables such as Header/Value/Notes).
    const rowMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    const isHeaderRow = (cells: string[], lower: string[]): boolean =>
      lower.some((c) => c.includes("model")) &&
      (lower.some((c) => c.includes("rpm")) ||
        lower.some((c) => c.includes("rpd")) ||
        lower.some((c) => c.includes("tpm")));

    let headerCols: string[] = [];
    let headerIdx = -1;
    for (let i = 0; i < rowMatches.length; i++) {
      const cells = [...rowMatches[i][1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1]));
      const lower = cells.map((c) => c.toLowerCase());
      if (isHeaderRow(cells, lower)) {
        headerCols = lower;
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      return { status: "failed", entries: [], missing: [], error: "No Free Plan model table header found", rawLen: html.length };
    }

    const entries: GroqFreePlanEntry[] = [];
    let brokeAtHeader = false;
    let lastTrPos = -1;
    for (let i = headerIdx + 1; i < rowMatches.length; i++) {
      lastTrPos = rowMatches[i].index;
      const cells = [...rowMatches[i][1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1]));
      if (cells.length === 0) continue;
      const lower = cells.map((c) => c.toLowerCase());
      if (isHeaderRow(cells, lower)) {
        brokeAtHeader = true; // reached a different plan's header → clean boundary
        break;
      }

      const first = cells[0]?.trim() ?? "";
      if (!first) continue;
      if (/^[0-9.,\sKkMm]+$/.test(first)) continue; // numeric-only first cell → not a model row

      const rest = cells.slice(1);
      if (rest.length === 0) continue;
      const restAllNumericOrDash = rest.every((c) => {
        const t = c.trim().toLowerCase();
        return t === "" || t === "-" || t === "n/a" || t === "—" || t === "none" || parseNumericCell(c) != null;
      });
      if (!restAllNumericOrDash) continue; // e.g. a Header/Value/Notes doc row

      let rpm: number | null = null;
      let tpm: number | null = null;
      let rpd: number | null = null;
      let ctx: number | null = null;
      cells.forEach((c, idx) => {
        const h = headerCols[idx] ?? "";
        const v = parseNumericCell(c);
        if (v == null) return;
        if (h.includes("rpm")) rpm = v;
        else if (h.includes("tpm")) tpm = v;
        else if (h.includes("rpd") || h.includes("requests") || h.includes("per day") || h.includes("daily")) rpd = v;
        else if (h.includes("context") || h.includes("window") || h.includes("tokens")) ctx = v;
        else if (rpm == null) rpm = v;
        else if (tpm == null) tpm = v;
        else if (rpd == null) rpd = v;
      });

      const extId = first.replace(/^models\//, "");
      entries.push({ id: extId, rpm, tpm, rpd, contextWindow: ctx ?? null, confidence: "verified", status: "free" });
    }

    if (entries.length === 0) return { status: "empty", entries: [], missing: [], rawLen: html.length };

    // Completeness check: a parse is only authoritative if we stopped at a clear
    // table boundary (the next plan's header) OR the Free Plan model table is
    // properly closed by a </tbody>/</table> after the last row. If the walk ran
    // off the end of the input with no closing boundary, the HTML was truncated
    // (e.g. a cut network response) and the table is incomplete — treat it as a
    // partial failure so we fall back to the frozen snapshot rather than
    // under-reporting the free set as "verified".
    if (!brokeAtHeader && lastTrPos >= 0) {
      const tail = html.slice(lastTrPos);
      const closedByTableBoundary = /<\/(tbody|table)>/.test(tail);
      if (!closedByTableBoundary) {
        return {
          status: "partial",
          entries: [],
          missing: [],
          error: "Free Plan table appears truncated (no closing table boundary after last row)",
          rawLen: html.length,
        };
      }
    }

    return { status: "parsed", entries, missing: [], rawLen: html.length };
  } catch (e) {
    return { status: "failed", entries: [], missing: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchGroqCatalogJson(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GroqCatalogResult> {
  try {
    const res = await fetchImpl(`${GROQ_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return { status: "error", models: [], error: `catalog HTTP ${res.status}` };
    const json = (await res.json()) as { data?: GroqCatalogModel[] };
    const models = (json.data ?? []).map((m) => ({
      id: m.id,
      object: m.object,
      created: m.created,
      owned_by: m.owned_by,
      active: m.active,
      context_window: m.context_window ?? null,
    }));
    return { status: "ok", models };
  } catch (e) {
    return { status: "error", models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchGroqFreePlanHtml(
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "ok" | "error"; html: string; error?: string }> {
  try {
    const res = await fetchImpl(GROQ_RATELIMITS_URL, { headers: { Accept: "text/html" } });
    if (!res.ok) return { status: "error", html: "", error: `rate-limits HTTP ${res.status}` };
    const html = await res.text();
    return { status: "ok", html };
  } catch (e) {
    return { status: "error", html: "", error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Collector (implements the shared Collector contract + hybrid live mode)
// ---------------------------------------------------------------------------

export class GroqCollector {
  readonly id = GROQ_PROVIDER_ID;
  readonly displayName = "Groq";

  private live = false;
  private catalog: GroqCatalogModel[] = [];
  private freePlan: GroqFreePlanEntry[] = [];
  private freePlanConfidence: VerificationConfidence = "likely";

  /** Whether the collector is currently in live (keyed) mode. */
  isLive(): boolean {
    return this.live;
  }

  /** Test helper: inject live catalog + parsed Free Plan state. */
  setState(catalog: GroqCatalogModel[], freePlan: GroqFreePlanEntry[], opts: { confidence?: VerificationConfidence } = {}): void {
    this.catalog = catalog;
    this.freePlan = freePlan;
    this.freePlanConfidence = opts.confidence ?? "verified";
    this.live = true;
  }

  /** Reset to frozen-snapshot (no-key / fallback) mode. */
  resetToFrozen(): void {
    this.live = false;
    this.catalog = [];
    this.freePlan = [];
  }

  async prepareLive(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ status: "ok" | "error"; error?: string }> {
    const [catRes, docRes] = await Promise.all([
      fetchGroqCatalogJson(apiKey, fetchImpl),
      fetchGroqFreePlanHtml(fetchImpl),
    ]);
    if (catRes.status !== "ok") return { status: "error", error: `catalog: ${catRes.error}` };
    if (docRes.status !== "ok") return { status: "error", error: `doc: ${docRes.error}` };
    const parsed = parseGroqFreePlanHtml(docRes.html);
    // Only a fully-parsed Free Plan table may activate live mode. An empty,
    // partial, or malformed parse is treated as a FAILURE so we fall back to the
    // frozen snapshot rather than activating live mode with an empty free set
    // (which would silently wipe the known-good free models).
    if (parsed.status !== "parsed") {
      return { status: "error", error: `doc parse ${parsed.status}${parsed.error ? ": " + parsed.error : ""}` };
    }
    this.catalog = catRes.models;
    this.freePlan = parsed.entries;
    this.freePlanConfidence = "verified";
    this.live = true;
    return { status: "ok" };
  }

  /** Models to process: live catalog (active only) when keyed, else frozen snapshot. */
  getCatalogModels(): GroqModel[] {
    if (this.live) {
      return this.catalog
        .filter((m) => m.active !== false)
        .map((m) => {
          const extId = externalIdOf(m.id);
          return {
            name: extId,
            displayName: humanize(extId),
            contextWindow: m.context_window ?? null,
            version: versionOf(extId),
          } as GroqModel;
        });
    }
    return GROQ_CATALOG_SNAPSHOT;
  }

  private decide(externalId: string): {
    isFree: boolean;
    pricingClass: "free_tier" | "paid" | "unknown";
    confidence: VerificationConfidence;
    rpm: number | null;
    tpm: number | null;
    rpd: number | null;
    contextWindow: number | null;
    reason: string;
  } {
    if (this.live) {
      const fp = this.freePlan.find((e) => e.id === externalId);
      if (fp && fp.status === "free") {
        return {
          isFree: true,
          pricingClass: "free_tier",
          confidence: this.freePlanConfidence,
          rpm: fp.rpm,
          tpm: fp.tpm,
          rpd: fp.rpd,
          contextWindow: fp.contextWindow ?? null,
          reason:
            "Free tier via Groq (direct provider access). Confirmed by intersecting the live /v1/models catalog " +
            "with Groq's official Free Plan rate-limits table. Requires an API key but NO payment method. " +
            "Production workloads require a paid plan. Verify at " + GROQ_RATELIMITS_URL + ".",
        };
      }
      if (fp && fp.status === "paid") {
        return {
          isFree: false,
          pricingClass: "paid",
          confidence: this.freePlanConfidence,
          rpm: fp.rpm,
          tpm: fp.tpm,
          rpd: fp.rpd,
          contextWindow: fp.contextWindow ?? null,
          reason:
            "Marked PAID by Groq's official rate-limits documentation (absent from the Free Plan table). " +
            "Verify at " + GROQ_RATELIMITS_URL + ".",
        };
      }
      return {
        isFree: false,
        pricingClass: "unknown",
        confidence: "likely",
        rpm: null,
        tpm: null,
        rpd: null,
        contextWindow: null,
        reason:
          "Listed by Groq's live catalog but ABSENT from the official Free Plan rate-limits table. " +
          "Absence from the free list is NOT proof of paid — classified 'unknown', never claimed free or paid.",
      };
    }

    const entry = GROQ_FREE_TIER[externalId];
    if (!entry) {
      return {
        isFree: false,
        pricingClass: "unknown",
        confidence: "likely",
        rpm: null,
        tpm: null,
        rpd: null,
        contextWindow: null,
        reason: "Not present in the Groq free-tier / pricing transcription — cannot assert free status.",
      };
    }
    if (!entry.free) {
      return {
        isFree: false,
        pricingClass: "paid",
        confidence: entry.confidence,
        rpm: entry.rpm,
        tpm: entry.tpm,
        rpd: entry.rpd,
        contextWindow: entry.contextWindow,
        reason: `Paid-only on Groq (input $${entry.inputPrice}/M, output $${entry.outputPrice}/M). ${entry.notes ?? ""}`.trim(),
      };
    }
    const limits: string[] = [];
    if (entry.rpm != null) limits.push(`${entry.rpm} RPM`);
    if (entry.tpm != null) limits.push(`${entry.tpm.toLocaleString()} TPM`);
    if (entry.rpd != null) limits.push(`${entry.rpd.toLocaleString()} requests/day`);
    const limitNote = limits.length
      ? `Documented free-tier rate limits: ${limits.join(", ")} (per Groq's official rate-limits docs). Groq also publishes a tokens/day (TPD) cap that this collector does not currently store.`
      : "Free-tier rate limits are not documented for this model.";
    return {
      isFree: true,
      pricingClass: "free_tier",
      confidence: entry.confidence,
      rpm: entry.rpm,
      tpm: entry.tpm,
      rpd: entry.rpd,
      contextWindow: entry.contextWindow,
      reason:
        "Free tier via Groq (direct provider access, OpenAI-compatible API). " +
        "Input and output tokens are free of charge on Groq's free tier — no credit card required. " +
        `${limitNote} ` +
        "The free tier is for development/prototyping; production workloads require a paid plan. " +
        `Snapshot transcribed from Groq's official docs (${GROQ_SNAPSHOT_DATE}); free-tier models/limits shift — verify at ${GROQ_PRICING_URL}.`,
    };
  }

  /** Full normalized model + availability (used by run.ts). */
  normalizeRecord(raw: GroqModel): NormalizedModel {
    if (this.live) {
      const externalId = externalIdOf(raw.name);
      const d = this.decide(externalId);
      const mod = deriveModalities(raw, externalId);
      const family = externalId.replace(/-(\d+(\.\d+)*).*$/, "") || externalId;
      const version = raw.version ?? (externalId.match(/(\d+(?:\.\d+)*)/) ?? [null])[1] ?? null;
      const ctx = raw.contextWindow ?? d.contextWindow ?? null;
      const modelId = externalId;
      const availId = `${modelId}__${GROQ_PROVIDER_ID}`;

      const model: NormalizedModelRow = {
        id: modelId,
        name: raw.displayName ?? externalId,
        providerId: GROQ_PROVIDER_ID,
        author: GROQ_PROVIDER_ID,
        family,
        version,
        releaseDate: null,
        contextWindow: ctx,
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

      const free: FreeClassification = {
        isFree: d.isFree,
        pricingClass: d.pricingClass,
        accessType: "direct_api",
        reason: d.reason,
      };

      let availability: NormalizedAvailabilityRow | null = null;
      if (d.isFree) {
        availability = {
          id: availId,
          modelId,
          providerId: GROQ_PROVIDER_ID,
          accessType: "direct_api" as AccessType,
          status: "available" as AvailabilityStatus,
          confidence: d.confidence,
          isFree: true,
          pricingClass: "free_tier",
          free,
          inputPricePerMillion: 0,
          outputPricePerMillion: 0,
          rateLimitRpm: d.rpm,
          rateLimitTpm: d.tpm,
          dailyLimit: d.rpd,
          monthlyLimit: null,
          requiresApiKey: true,
          requiresPaymentMethod: false,
          paymentRequirementKnown: true,
          requiresSignup: true,
          expiresAt: null,
          sourceUrl: GROQ_RATELIMITS_URL,
          sourceType: "official_docs",
          sourceTitle: "Groq",
          apiFormat: "openai_chat_completions",
          collectionMode: "live",
        };
      }

      return { model, availability, isFree: d.isFree, free, raw: raw as any };
    }
    return normalizeGroqModel(raw);
  }

  // --- Collector contract (registry / orchestrator) -------------------------

  async discover(): Promise<RawModelListing[]> {
    return this.getCatalogModels().map((m) => ({
      externalId: externalIdOf(m.name),
      displayName: m.displayName ?? m.name,
      family: m.name.replace(/-(\d+(\.\d+)*).*$/, "") || m.name,
      version: m.version,
    }));
  }

  async fetchPricing(externalId: string): Promise<RawPricing | null> {
    const d = this.decide(externalId);
    if (this.live && d.pricingClass === "unknown") return null; // unknown is not emitted
    return {
      externalId,
      freeAccess: d.isFree,
      accessType: "direct_api",
      status: "available",
      requiresPaymentMethod: false,
      requiresApiKey: true,
      requiresSignup: true,
      pricePerMillionIn: d.isFree ? 0 : null,
      pricePerMillionOut: d.isFree ? 0 : null,
      sourceUrl: GROQ_RATELIMITS_URL,
      sourceTitle: "Groq",
      sourceType: "official_docs",
      expiresAt: null,
    };
  }

  normalize(externalId: string, raw: RawPricing): NormalizedAvailability {
    const d = this.decide(externalId);
    return {
      id: `${externalId}__${GROQ_PROVIDER_ID}`,
      modelId: externalId,
      providerId: GROQ_PROVIDER_ID,
      externalId,
      freeAccess: !!raw.freeAccess,
      accessType: raw.accessType ?? "direct_api",
      status: raw.status ?? "available",
      confidence: d.confidence,
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
