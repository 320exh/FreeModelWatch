import { getDb } from "../db";
import {
  OpenRouterCollector,
  normalizeModel,
  OPENROUTER_PROVIDER_ID,
  OPENROUTER_SOURCE_URL,
  type OpenRouterModel,
  type NormalizedModel,
} from "./openrouter";
import {
  GeminiCollector,
  normalizeModel as normalizeGeminiModel,
  GEMINI_PROVIDER_ID,
  GEMINI_CATALOG_SNAPSHOT,
  GEMINI_SOURCE_CATALOG_ID,
  GEMINI_SOURCE_CATALOG_URL,
  GEMINI_SOURCE_PRICING_ID,
  GEMINI_SOURCE_RATELIMITS_ID,
  GEMINI_SOURCE_BILLING_ID,
  type GeminiModel,
} from "./gemini";
import {
  GroqCollector,
  normalizeGroqModel,
  GROQ_PROVIDER_ID,
  GROQ_CATALOG_SNAPSHOT,
  GROQ_SOURCE_MODELS_ID,
  GROQ_SOURCE_MODELS_URL,
  GROQ_SOURCE_PRICING_ID,
  GROQ_SOURCE_PRICING_URL,
  GROQ_SOURCE_RATELIMITS_ID,
  GROQ_SOURCE_RATELIMITS_URL,
  type GroqModel,
} from "./groq";
import { DbCollectorSink } from "./dbSink";
import type { FetchLike, FetchOptions } from "./openrouter";

const PREFIX = `${OPENROUTER_PROVIDER_ID}__`;
const SUFFIX = `__${OPENROUTER_PROVIDER_ID}`;

function externalIdFromAvailId(aid: string): string {
  return aid.slice(PREFIX.length, aid.length - SUFFIX.length);
}

export interface CollectorRunReport {
  dryRun: boolean;
  status: "success" | "failed" | "partial";
  startedAt: string;
  finishedAt: string;
  collector: string;
  runId?: string;
  modelsDiscovered: number;
  freeModels: number;
  newModels: string[];
  existingModels: number;
  changedModels: { id: string; fields: string[] }[];
  newFreeRoutes: string[];
  changedFreeRoutes: { id: string; fields: string[] }[];
  reactivatedFreeRoutes: string[];
  removedFreeRoutes: string[];
  errors: string[];
  warnings: string[];
  errorMessage: string | null;
  modelsAdded: number;
  modelsChanged: number;
  modelsRemoved: number;
  freeRoutesAdded: number;
  freeRoutesRemoved: number;
}

export interface RunOptions {
  dryRun?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  apiKey?: string;
}

function uid(prefix: string): string {
  const now = Date.now();
  return `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run the OpenRouter collector end-to-end.
 *
 * Failure safety: the network fetch happens FIRST and is the only risky step.
 * If it fails we record a `failed` run and return an error report WITHOUT
 * touching any model/availability/source rows — a provider outage can never
 * wipe or falsify existing data.
 *
 * Idempotency: the sink only writes history when something actually changed,
 * so running twice against an unchanged catalog is a no-op (no duplicates).
 */
export async function runOpenRouterCollector(opts: RunOptions = {}): Promise<CollectorRunReport> {
  const now = opts.now ?? new Date();
  const startedAt = now.toISOString();
  const dryRun = !!opts.dryRun;
  const sink = new DbCollectorSink(now);
  const collector = new OpenRouterCollector();

  const report: CollectorRunReport = {
    dryRun,
    status: "success",
    startedAt,
    finishedAt: startedAt,
    collector: OPENROUTER_PROVIDER_ID,
    modelsDiscovered: 0,
    freeModels: 0,
    newModels: [],
    existingModels: 0,
    changedModels: [],
    newFreeRoutes: [],
    changedFreeRoutes: [],
    reactivatedFreeRoutes: [],
    removedFreeRoutes: [],
    errors: [],
    warnings: [],
    errorMessage: null,
    modelsAdded: 0,
    modelsChanged: 0,
    modelsRemoved: 0,
    freeRoutesAdded: 0,
    freeRoutesRemoved: 0,
  };

  let rawModels: OpenRouterModel[];
  try {
    const fetchOpts: FetchOptions = {
      timeoutMs: opts.timeoutMs ?? 15_000,
      maxRetries: opts.maxRetries ?? 3,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    };
    rawModels = await collector.fetchCatalog(fetchOpts);
  } catch (err) {
    report.status = "failed";
    report.errorMessage = err instanceof Error ? err.message : String(err);
    report.errors.push(report.errorMessage);
    report.finishedAt = new Date().toISOString();
    if (!dryRun) {
      sink.recordRun({
        id: uid("run"),
        collector: OPENROUTER_PROVIDER_ID,
        startedAt,
        finishedAt: report.finishedAt,
        status: "failed",
        dryRun,
        modelsDiscovered: 0,
        freeModels: 0,
        modelsAdded: 0,
        modelsChanged: 0,
        modelsRemoved: 0,
        freeRoutesAdded: 0,
        freeRoutesRemoved: 0,
        errorCount: report.errors.length,
        warningCount: report.warnings.length,
        errorMessage: report.errorMessage,
        summary: JSON.stringify(report, null, 2),
      });
    }
    return report;
  }

  report.modelsDiscovered = rawModels.length;

  // --- Failure-safety sanity guard (Scenario E: partial/truncated response) ---
  // If a previous successful run discovered a substantially larger catalog and this
  // run returns far fewer models, the response is likely truncated or a
  // partial/error payload. We must NOT mass-remove or mutate existing live data on
  // a suspicious response — report it and bail out so existing availability stays
  // intact. (Cold start / first run has no previous count, so it is never guarded.)
  const prevRun = getDb()
    .prepare(
      "SELECT models_discovered FROM collector_runs WHERE collector = ? AND status IN ('success','partial') ORDER BY started_at DESC LIMIT 1"
    )
    .get(OPENROUTER_PROVIDER_ID) as any;
  const prevCount = prevRun ? Number(prevRun.models_discovered) : 0;
  const SUSPICIOUS = prevCount > 20 && rawModels.length < prevCount * 0.5;
  if (SUSPICIOUS) {
    const msg = `Catalog returned only ${rawModels.length} models, far below the previous run's ${prevCount}. Treating as a partial/truncated response — refusing to mutate existing data.`;
    report.status = "failed";
    report.warnings.push(msg);
    report.errorMessage = msg;
    report.finishedAt = new Date().toISOString();
    if (!dryRun) {
      sink.recordRun({
        id: uid("run"),
        collector: OPENROUTER_PROVIDER_ID,
        startedAt,
        finishedAt: report.finishedAt,
        status: report.status,
        dryRun,
        modelsDiscovered: report.modelsDiscovered,
        freeModels: 0,
        modelsAdded: 0,
        modelsChanged: 0,
        modelsRemoved: 0,
        freeRoutesAdded: 0,
        freeRoutesRemoved: 0,
        errorCount: report.errors.length,
        warningCount: report.warnings.length,
        errorMessage: report.errorMessage,
        summary: JSON.stringify(report, null, 2),
      });
    }
    return report;
  }

  const normalized: NormalizedModel[] = [];
  for (const raw of rawModels) {
    try {
      if (!raw || !raw.id) {
        report.warnings.push("Skipped catalog entry with no id.");
        continue;
      }
      normalized.push(normalizeModel(raw));
    } catch (err) {
      report.errors.push(`Normalize failed for ${raw?.id ?? "?"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const freeModels = normalized.filter((n) => n.isFree);
  report.freeModels = freeModels.length;

  const catalogExternalIds = new Set(normalized.map((n) => n.raw.id));
  const newFreeAvailIds = new Set(freeModels.map((n) => n.availability!.id));

  const db = getDb();
  const currentActive = db
    .prepare("SELECT * FROM availability WHERE provider_id = ? AND data_origin = ? AND is_active = 1")
    .all(OPENROUTER_PROVIDER_ID, "live_collector") as any[];

  for (const n of freeModels) {
    const m = n.model;
    const a = n.availability!;
    try {
      if (dryRun) {
        const existingModel = db.prepare("SELECT * FROM models WHERE id = ?").get(m.id) as any;
        const existingAvail = db.prepare("SELECT * FROM availability WHERE id = ?").get(a.id) as any;
        if (!existingModel) report.newModels.push(m.id);
        else {
          report.existingModels++;
          const modelChanged =
            String(existingModel.context_window ?? "") !== String(m.contextWindow ?? "") ||
            String(existingModel.name ?? "") !== String(m.name ?? "");
          if (modelChanged) report.changedModels.push({ id: m.id, fields: ["context_window/name"] });
        }
        if (!existingAvail) {
          report.newFreeRoutes.push(a.id);
        } else if (existingAvail.is_active !== 1) {
          report.reactivatedFreeRoutes.push(a.id);
        } else {
          const changed =
            existingAvail.status !== a.status ||
            existingAvail.access_type !== a.accessType ||
            String(existingAvail.input_price_per_million ?? "") !== String(a.inputPricePerMillion ?? "") ||
            String(existingAvail.output_price_per_million ?? "") !== String(a.outputPricePerMillion ?? "");
          if (changed) report.changedFreeRoutes.push({ id: a.id, fields: ["status/price"] });
        }
      } else {
        const mr = sink.upsertModelRow(m, {
          sourceUrl: OPENROUTER_SOURCE_URL,
          sourceNotes: "Changed in OpenRouter catalog during live collection.",
        });
        if (mr.added) {
          report.newModels.push(m.id);
          report.modelsAdded++;
        } else if (mr.changed) {
          report.changedModels.push({ id: m.id, fields: mr.changedFields });
          report.modelsChanged++;
        } else {
          report.existingModels++;
        }
        const sourceId = sink.ensureSource();
        const ar = sink.upsertAvailabilityRow(a, sourceId);
        if (ar.added) {
          report.newFreeRoutes.push(a.id);
          report.freeRoutesAdded++;
        } else if (ar.reactivated) {
          report.reactivatedFreeRoutes.push(a.id);
          report.freeRoutesAdded++;
        } else if (ar.changed) {
          report.changedFreeRoutes.push({ id: a.id, fields: ["status/price/access"] });
          report.modelsChanged++;
        }
      }
    } catch (err) {
      report.errors.push(`Write failed for ${m.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const cur of currentActive) {
    if (newFreeAvailIds.has(cur.id)) continue;
    const extId = externalIdFromAvailId(cur.id);
    const becamePaid = catalogExternalIds.has(extId);
    const reason = becamePaid
      ? "Model is still listed by OpenRouter but is no longer free (pricing > 0)."
      : "Model no longer present in the OpenRouter live catalog.";
    if (dryRun) {
      report.removedFreeRoutes.push(cur.id);
    } else {
      const removed = sink.markRemoved(cur.id, reason, OPENROUTER_SOURCE_URL);
      if (removed) {
        report.removedFreeRoutes.push(cur.id);
        report.freeRoutesRemoved++;
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  if (report.errors.length > 0 && report.status === "success") report.status = "partial";

  if (!dryRun) {
    sink.ensureProvider();
    sink.recordRun({
      id: uid("run"),
      collector: OPENROUTER_PROVIDER_ID,
      startedAt,
      finishedAt: report.finishedAt,
      status: report.status,
      dryRun: false,
      modelsDiscovered: report.modelsDiscovered,
      freeModels: report.freeModels,
      modelsAdded: report.modelsAdded,
      modelsChanged: report.modelsChanged,
      modelsRemoved: report.modelsRemoved,
      freeRoutesAdded: report.freeRoutesAdded,
      freeRoutesRemoved: report.freeRoutesRemoved,
      errorCount: report.errors.length,
      warningCount: report.warnings.length,
      errorMessage: report.errorMessage,
      summary: JSON.stringify(report, null, 2),
    });
  }

  return report;
}

const GEMINI_SUFFIX = `__${GEMINI_PROVIDER_ID}`;
function externalIdFromGeminiAvailId(aid: string): string {
  return aid.endsWith(GEMINI_SUFFIX) ? aid.slice(0, aid.length - GEMINI_SUFFIX.length) : aid;
}

/**
 * Run the Google Gemini / AI Studio collector end-to-end, using the exact same
 * failure-safety and idempotency guarantees as runOpenRouterCollector.
 *
 * The live `models.list` endpoint requires an API key. When no key is available
 * (opts.apiKey / GEMINI_API_KEY), the collector falls back to the bundled,
 * clearly-labeled official snapshot so it is runnable in any environment. A
 * warning is recorded in that case.
 */
export async function runGeminiCollector(opts: RunOptions = {}): Promise<CollectorRunReport> {
  const now = opts.now ?? new Date();
  const startedAt = now.toISOString();
  const dryRun = !!opts.dryRun;
  const sink = new DbCollectorSink(now);
  const collector = new GeminiCollector();

  const report: CollectorRunReport = {
    dryRun,
    status: "success",
    startedAt,
    finishedAt: startedAt,
    collector: GEMINI_PROVIDER_ID,
    modelsDiscovered: 0,
    freeModels: 0,
    newModels: [],
    existingModels: 0,
    changedModels: [],
    newFreeRoutes: [],
    changedFreeRoutes: [],
    reactivatedFreeRoutes: [],
    removedFreeRoutes: [],
    errors: [],
    warnings: [],
    errorMessage: null,
    modelsAdded: 0,
    modelsChanged: 0,
    modelsRemoved: 0,
    freeRoutesAdded: 0,
    freeRoutesRemoved: 0,
  };

  let rawModels: GeminiModel[];
  let apiKey: string | undefined;
  try {
    apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (apiKey) {
      const fetchOpts: FetchOptions = {
        timeoutMs: opts.timeoutMs ?? 15_000,
        maxRetries: opts.maxRetries ?? 3,
        fetchImpl: opts.fetchImpl,
        signal: opts.signal,
        apiKey,
      } as FetchOptions;
      rawModels = await collector.fetchCatalog(fetchOpts);
    } else {
      report.warnings.push(
        "No GEMINI_API_KEY set — using the bundled official model snapshot instead of live discovery."
      );
      rawModels = GEMINI_CATALOG_SNAPSHOT;
    }
  } catch (err) {
    report.status = "failed";
    report.errorMessage = err instanceof Error ? err.message : String(err);
    report.errors.push(report.errorMessage);
    report.finishedAt = new Date().toISOString();
    if (!dryRun) {
      sink.recordRun({
        id: uid("run"),
        collector: GEMINI_PROVIDER_ID,
        startedAt,
        finishedAt: report.finishedAt,
        status: "failed",
        dryRun,
        modelsDiscovered: 0,
        freeModels: 0,
        modelsAdded: 0,
        modelsChanged: 0,
        modelsRemoved: 0,
        freeRoutesAdded: 0,
        freeRoutesRemoved: 0,
        errorCount: report.errors.length,
        warningCount: report.warnings.length,
        errorMessage: report.errorMessage,
        summary: JSON.stringify(report, null, 2),
      });
    }
    return report;
  }

  report.modelsDiscovered = rawModels.length;

  const prevRun = getDb()
    .prepare(
      "SELECT models_discovered FROM collector_runs WHERE collector = ? AND status IN ('success','partial') ORDER BY started_at DESC LIMIT 1"
    )
    .get(GEMINI_PROVIDER_ID) as any;
  const prevCount = prevRun ? Number(prevRun.models_discovered) : 0;
  const SUSPICIOUS = prevCount > 20 && rawModels.length < prevCount * 0.5;
  if (SUSPICIOUS) {
    const msg = `Catalog returned only ${rawModels.length} models, far below the previous run's ${prevCount}. Treating as a partial/truncated response — refusing to mutate existing data.`;
    report.status = "failed";
    report.warnings.push(msg);
    report.errorMessage = msg;
    report.finishedAt = new Date().toISOString();
    if (!dryRun) {
      sink.recordRun({
        id: uid("run"),
        collector: GEMINI_PROVIDER_ID,
        startedAt,
        finishedAt: report.finishedAt,
        status: report.status,
        dryRun,
        modelsDiscovered: report.modelsDiscovered,
        freeModels: 0,
        modelsAdded: 0,
        modelsChanged: 0,
        modelsRemoved: 0,
        freeRoutesAdded: 0,
        freeRoutesRemoved: 0,
        errorCount: report.errors.length,
        warningCount: report.warnings.length,
        errorMessage: report.errorMessage,
        summary: JSON.stringify(report, null, 2),
      });
    }
    return report;
  }

  const isFrozen = !apiKey;

  const normalized: NormalizedModel[] = [];
  for (const raw of rawModels) {
    try {
      if (!raw || !raw.name) {
        report.warnings.push("Skipped catalog entry with no name.");
        continue;
      }
      normalized.push(normalizeGeminiModel(raw, GEMINI_PROVIDER_ID, isFrozen ? "frozen" : "live"));
    } catch (err) {
      report.errors.push(`Normalize failed for ${raw?.name ?? "?"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const freeModels = normalized.filter((n) => n.isFree);
  report.freeModels = freeModels.length;

  const catalogExternalIds = new Set(normalized.map((n) => n.model.id));
  const newFreeAvailIds = new Set(freeModels.map((n) => n.availability!.id));

  const db = getDb();
  const currentActive = db
    .prepare("SELECT * FROM availability WHERE provider_id = ? AND data_origin = ? AND is_active = 1")
    .all(GEMINI_PROVIDER_ID, "live_collector") as any[];

  // Gemini sources are created up-front so every imported route links to all
  // of them (catalog, pricing, rate-limits, billing).
  const [catalogSrc, pricingSrc, rateSrc, billingSrc] = !dryRun
    ? sink.ensureGeminiSources()
    : [GEMINI_SOURCE_CATALOG_ID, GEMINI_SOURCE_PRICING_ID, GEMINI_SOURCE_RATELIMITS_ID, GEMINI_SOURCE_BILLING_ID];

  for (const n of freeModels) {
    const m = n.model;
    const a = n.availability!;
    try {
      if (dryRun) {
        const existingModel = db.prepare("SELECT * FROM models WHERE id = ?").get(m.id) as any;
        const existingAvail = db.prepare("SELECT * FROM availability WHERE id = ?").get(a.id) as any;
        if (!existingModel) report.newModels.push(m.id);
        else {
          report.existingModels++;
          const modelChanged =
            String(existingModel.context_window ?? "") !== String(m.contextWindow ?? "") ||
            String(existingModel.name ?? "") !== String(m.name ?? "");
          if (modelChanged) report.changedModels.push({ id: m.id, fields: ["context_window/name"] });
        }
        if (!existingAvail) {
          report.newFreeRoutes.push(a.id);
        } else if (existingAvail.is_active !== 1) {
          report.reactivatedFreeRoutes.push(a.id);
        } else {
          const changed =
            existingAvail.status !== a.status ||
            existingAvail.access_type !== a.accessType ||
            String(existingAvail.input_price_per_million ?? "") !== String(a.inputPricePerMillion ?? "") ||
            String(existingAvail.output_price_per_million ?? "") !== String(a.outputPricePerMillion ?? "") ||
            String(existingAvail.rate_limit_tpm ?? "") !== String(a.rateLimitTpm ?? "") ||
            String(existingAvail.requires_payment_method ?? "") !== String(a.requiresPaymentMethod ?? "");
          if (changed) report.changedFreeRoutes.push({ id: a.id, fields: ["status/price/access/limits"] });
        }
      } else {
        const mr = sink.upsertModelRow(m, {
          sourceUrl: GEMINI_SOURCE_CATALOG_URL,
          sourceNotes: "Changed in Gemini catalog during live collection.",
        });
        if (mr.added) {
          report.newModels.push(m.id);
          report.modelsAdded++;
        } else if (mr.changed) {
          report.changedModels.push({ id: m.id, fields: mr.changedFields });
          report.modelsChanged++;
        } else {
          report.existingModels++;
        }
        const ar = sink.upsertAvailabilityRow(a, pricingSrc);
        if (ar.added) {
          report.newFreeRoutes.push(a.id);
          report.freeRoutesAdded++;
        } else if (ar.reactivated) {
          report.reactivatedFreeRoutes.push(a.id);
          report.freeRoutesAdded++;
        } else if (ar.changed) {
          report.changedFreeRoutes.push({ id: a.id, fields: ["status/price/access/limits"] });
          report.modelsChanged++;
        }
        sink.linkSources(a.id, [catalogSrc, rateSrc, billingSrc]);
      }
    } catch (err) {
      report.errors.push(`Write failed for ${m.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const cur of currentActive) {
    if (newFreeAvailIds.has(cur.id)) continue;
    const extId = externalIdFromGeminiAvailId(cur.id);
    const becamePaid = catalogExternalIds.has(extId);
    const reason = becamePaid
      ? "Model is still listed by Google but is no longer free (now paid-only)."
      : "Model no longer present in the Gemini live catalog.";
    if (dryRun) {
      report.removedFreeRoutes.push(cur.id);
    } else {
      const removed = sink.markRemoved(cur.id, reason, GEMINI_SOURCE_CATALOG_URL);
      if (removed) {
        report.removedFreeRoutes.push(cur.id);
        report.freeRoutesRemoved++;
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  if (report.errors.length > 0 && report.status === "success") report.status = "partial";

  if (!dryRun) {
    sink.ensureGeminiProvider();
    sink.recordRun({
      id: uid("run"),
      collector: GEMINI_PROVIDER_ID,
      startedAt,
      finishedAt: report.finishedAt,
      status: report.status,
      dryRun: false,
      modelsDiscovered: report.modelsDiscovered,
      freeModels: report.freeModels,
      modelsAdded: report.modelsAdded,
      modelsChanged: report.modelsChanged,
      modelsRemoved: report.modelsRemoved,
      freeRoutesAdded: report.freeRoutesAdded,
      freeRoutesRemoved: report.freeRoutesRemoved,
      errorCount: report.errors.length,
      warningCount: report.warnings.length,
      errorMessage: report.errorMessage,
      summary: JSON.stringify(report, null, 2),
    });
  }

  return report;
}

const GROQ_SUFFIX = `__${GROQ_PROVIDER_ID}`;
function externalIdFromGroqAvailId(aid: string): string {
  return aid.endsWith(GROQ_SUFFIX) ? aid.slice(0, aid.length - GROQ_SUFFIX.length) : aid;
}

/**
 * Run the Groq collector end-to-end, using the same failure-safety and
 * idempotency guarantees as the OpenRouter / Gemini runners.
 *
 * Groq's live `/v1/models` endpoint requires an API key. This prototype uses the
 * bundled, clearly-labeled GROQ_CATALOG_SNAPSHOT (transcribed from Groq's
 * official free-tier / pricing / rate-limits docs) so it runs WITHOUT a key. A
 * warning is recorded to make the snapshot source explicit.
 */
export async function runGroqCollector(opts: RunOptions = {}): Promise<CollectorRunReport> {
  const now = opts.now ?? new Date();
  const startedAt = now.toISOString();
  const dryRun = !!opts.dryRun;
  const sink = new DbCollectorSink(now);
  const collector = new GroqCollector();

  const report: CollectorRunReport = {
    dryRun,
    status: "success",
    startedAt,
    finishedAt: startedAt,
    collector: GROQ_PROVIDER_ID,
    modelsDiscovered: 0,
    freeModels: 0,
    newModels: [],
    existingModels: 0,
    changedModels: [],
    newFreeRoutes: [],
    changedFreeRoutes: [],
    reactivatedFreeRoutes: [],
    removedFreeRoutes: [],
    errors: [],
    warnings: [],
    errorMessage: null,
    modelsAdded: 0,
    modelsChanged: 0,
    modelsRemoved: 0,
    freeRoutesAdded: 0,
    freeRoutesRemoved: 0,
  };

  let rawModels: GroqModel[];
  const apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
  try {
    if (apiKey) {
      const prepared = await collector.prepareLive(apiKey);
      if (prepared.status === "ok") {
        report.warnings.push(
          "Live Groq discovery via /v1/models (catalog) + parsed official Free Plan rate-limits."
        );
        rawModels = collector.getCatalogModels();
      } else {
        report.warnings.push(
          `Live Groq discovery failed (${prepared.error ?? "unknown"}) — using the bundled official snapshot.`
        );
        rawModels = GROQ_CATALOG_SNAPSHOT;
      }
    } else {
      report.warnings.push(
        "No GROQ_API_KEY set — using the bundled official model snapshot instead of live discovery."
      );
      rawModels = GROQ_CATALOG_SNAPSHOT;
    }
  } catch (err) {
    report.status = "failed";
    report.errorMessage = err instanceof Error ? err.message : String(err);
    report.errors.push(report.errorMessage);
    report.finishedAt = new Date().toISOString();
    if (!dryRun) {
      sink.recordRun({
        id: uid("run"),
        collector: GROQ_PROVIDER_ID,
        startedAt,
        finishedAt: report.finishedAt,
        status: "failed",
        dryRun,
        modelsDiscovered: 0,
        freeModels: 0,
        modelsAdded: 0,
        modelsChanged: 0,
        modelsRemoved: 0,
        freeRoutesAdded: 0,
        freeRoutesRemoved: 0,
        errorCount: report.errors.length,
        warningCount: report.warnings.length,
        errorMessage: report.errorMessage,
        summary: JSON.stringify(report, null, 2),
      });
    }
    return report;
  }

  report.modelsDiscovered = rawModels.length;

  const prevRun = getDb()
    .prepare(
      "SELECT models_discovered FROM collector_runs WHERE collector = ? AND status IN ('success','partial') ORDER BY started_at DESC LIMIT 1"
    )
    .get(GROQ_PROVIDER_ID) as any;
  const prevCount = prevRun ? Number(prevRun.models_discovered) : 0;
  const SUSPICIOUS = prevCount > 20 && rawModels.length < prevCount * 0.5;
  if (SUSPICIOUS) {
    const msg = `Catalog returned only ${rawModels.length} models, far below the previous run's ${prevCount}. Treating as a partial/truncated response — refusing to mutate existing data.`;
    report.status = "failed";
    report.warnings.push(msg);
    report.errorMessage = msg;
    report.finishedAt = new Date().toISOString();
    if (!dryRun) {
      sink.recordRun({
        id: uid("run"),
        collector: GROQ_PROVIDER_ID,
        startedAt,
        finishedAt: report.finishedAt,
        status: report.status,
        dryRun,
        modelsDiscovered: report.modelsDiscovered,
        freeModels: 0,
        modelsAdded: 0,
        modelsChanged: 0,
        modelsRemoved: 0,
        freeRoutesAdded: 0,
        freeRoutesRemoved: 0,
        errorCount: report.errors.length,
        warningCount: report.warnings.length,
        errorMessage: report.errorMessage,
        summary: JSON.stringify(report, null, 2),
      });
    }
    return report;
  }

  const normalized: NormalizedModel[] = [];
  for (const raw of rawModels) {
    try {
      if (!raw || !raw.name) {
        report.warnings.push("Skipped catalog entry with no name.");
        continue;
      }
      normalized.push(collector.normalizeRecord(raw));
    } catch (err) {
      report.errors.push(`Normalize failed for ${raw?.name ?? "?"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const freeModels = normalized.filter((n) => n.isFree);
  report.freeModels = freeModels.length;

  const catalogExternalIds = new Set(normalized.map((n) => n.model.id));
  const newFreeAvailIds = new Set(freeModels.map((n) => n.availability!.id));

  const db = getDb();
  const currentActive = db
    .prepare("SELECT * FROM availability WHERE provider_id = ? AND data_origin = ? AND is_active = 1")
    .all(GROQ_PROVIDER_ID, "live_collector") as any[];

  // Groq sources are created up-front so every imported route links to all of
  // them (models, pricing, rate-limits).
  const [modelsSrc, pricingSrc, rateSrc] = !dryRun
    ? sink.ensureGroqSources()
    : [GROQ_SOURCE_MODELS_ID, GROQ_SOURCE_PRICING_ID, GROQ_SOURCE_RATELIMITS_ID];

  for (const n of freeModels) {
    const m = n.model;
    const a = n.availability!;
    try {
      if (dryRun) {
        const existingModel = db.prepare("SELECT * FROM models WHERE id = ?").get(m.id) as any;
        const existingAvail = db.prepare("SELECT * FROM availability WHERE id = ?").get(a.id) as any;
        if (!existingModel) report.newModels.push(m.id);
        else {
          report.existingModels++;
          const modelChanged =
            String(existingModel.context_window ?? "") !== String(m.contextWindow ?? "") ||
            String(existingModel.name ?? "") !== String(m.name ?? "");
          if (modelChanged) report.changedModels.push({ id: m.id, fields: ["context_window/name"] });
        }
        if (!existingAvail) {
          report.newFreeRoutes.push(a.id);
        } else if (existingAvail.is_active !== 1) {
          report.reactivatedFreeRoutes.push(a.id);
        } else {
          const changed =
            existingAvail.status !== a.status ||
            existingAvail.access_type !== a.accessType ||
            String(existingAvail.input_price_per_million ?? "") !== String(a.inputPricePerMillion ?? "") ||
            String(existingAvail.output_price_per_million ?? "") !== String(a.outputPricePerMillion ?? "") ||
            String(existingAvail.rate_limit_rpm ?? "") !== String(a.rateLimitRpm ?? "") ||
            String(existingAvail.rate_limit_tpm ?? "") !== String(a.rateLimitTpm ?? "") ||
            String(existingAvail.daily_limit ?? "") !== String(a.dailyLimit ?? "") ||
            String(existingAvail.requires_payment_method ?? "") !== String(a.requiresPaymentMethod ?? "");
          if (changed) report.changedFreeRoutes.push({ id: a.id, fields: ["status/price/access/limits"] });
        }
      } else {
        const mr = sink.upsertModelRow(m, {
          sourceUrl: GROQ_SOURCE_MODELS_URL,
          sourceNotes: "Changed in Groq catalog during live collection.",
        });
        if (mr.added) {
          report.newModels.push(m.id);
          report.modelsAdded++;
        } else if (mr.changed) {
          report.changedModels.push({ id: m.id, fields: mr.changedFields });
          report.modelsChanged++;
        } else {
          report.existingModels++;
        }
        const ar = sink.upsertAvailabilityRow(a, pricingSrc);
        if (ar.added) {
          report.newFreeRoutes.push(a.id);
          report.freeRoutesAdded++;
        } else if (ar.reactivated) {
          report.reactivatedFreeRoutes.push(a.id);
          report.freeRoutesAdded++;
        } else if (ar.changed) {
          report.changedFreeRoutes.push({ id: a.id, fields: ["status/price/access/limits"] });
          report.modelsChanged++;
        }
        sink.linkSources(a.id, [modelsSrc, rateSrc]);
      }
    } catch (err) {
      report.errors.push(`Write failed for ${m.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const cur of currentActive) {
    if (newFreeAvailIds.has(cur.id)) continue;
    const extId = externalIdFromGroqAvailId(cur.id);
    const becamePaid = catalogExternalIds.has(extId);
    const reason = becamePaid
      ? "Model is still listed by Groq but is no longer free (now paid-only)."
      : "Model no longer present in the Groq catalog.";
    if (dryRun) {
      report.removedFreeRoutes.push(cur.id);
    } else {
      const removed = sink.markRemoved(cur.id, reason, GROQ_SOURCE_MODELS_URL);
      if (removed) {
        report.removedFreeRoutes.push(cur.id);
        report.freeRoutesRemoved++;
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  if (report.errors.length > 0 && report.status === "success") report.status = "partial";

  if (!dryRun) {
    sink.ensureGroqProvider();
    sink.recordRun({
      id: uid("run"),
      collector: GROQ_PROVIDER_ID,
      startedAt,
      finishedAt: report.finishedAt,
      status: report.status,
      dryRun: false,
      modelsDiscovered: report.modelsDiscovered,
      freeModels: report.freeModels,
      modelsAdded: report.modelsAdded,
      modelsChanged: report.modelsChanged,
      modelsRemoved: report.modelsRemoved,
      freeRoutesAdded: report.freeRoutesAdded,
      freeRoutesRemoved: report.freeRoutesRemoved,
      errorCount: report.errors.length,
      warningCount: report.warnings.length,
      errorMessage: report.errorMessage,
      summary: JSON.stringify(report, null, 2),
    });
  }

  return report;
}

/** Human-readable one-line-per-section summary for CLI / logs. */
export function formatRunReport(report: CollectorRunReport): string {
  const display =
    report.collector === OPENROUTER_PROVIDER_ID
      ? "OpenRouter"
      : report.collector === GEMINI_PROVIDER_ID
        ? "Gemini"
        : report.collector === GROQ_PROVIDER_ID
          ? "Groq"
          : report.collector;
  const lines: string[] = [];
  lines.push(`${display} collector run — ${report.dryRun ? "DRY RUN" : "LIVE"} — status: ${report.status}`);
  lines.push(`  models discovered : ${report.modelsDiscovered}`);
  lines.push(`  free models       : ${report.freeModels}`);
  lines.push(`  new models        : ${report.newModels.length}  (${report.newModels.slice(0, 8).join(", ")}${report.newModels.length > 8 ? " …" : ""})`);
  lines.push(`  existing models   : ${report.existingModels}`);
  lines.push(`  changed models    : ${report.changedModels.length}`);
  lines.push(`  new free routes   : ${report.newFreeRoutes.length}`);
  lines.push(`  changed free rts  : ${report.changedFreeRoutes.length}`);
  lines.push(`  reactivated rts   : ${report.reactivatedFreeRoutes.length}`);
  lines.push(`  removed free rts  : ${report.removedFreeRoutes.length}`);
  lines.push(`  errors            : ${report.errors.length}`);
  lines.push(`  warnings          : ${report.warnings.length}`);
  if (report.errorMessage) lines.push(`  error message    : ${report.errorMessage}`);
  for (const e of report.errors) lines.push(`    ! ${e}`);
  for (const w of report.warnings) lines.push(`    ~ ${w}`);
  return lines.join("\n");
}
