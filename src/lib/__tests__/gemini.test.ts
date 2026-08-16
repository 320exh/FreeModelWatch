import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDb, getDb } from "../db";
import {
  normalizeModel,
  GeminiCollector,
  GEMINI_PROVIDER_ID,
  GEMINI_FREE_TIER,
  GEMINI_CATALOG_SNAPSHOT,
  GEMINI_SOURCE_CATALOG_ID,
  GEMINI_SOURCE_PRICING_ID,
  GEMINI_SOURCE_RATELIMITS_ID,
  GEMINI_SOURCE_BILLING_ID,
  type GeminiModel,
} from "../collectors/gemini";
import type { FetchLike } from "../collectors/openrouter";
import { runGeminiCollector } from "../collectors/run";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkModel(id: string, extra: Partial<GeminiModel> = {}): GeminiModel {
  return {
    name: `models/${id}`,
    displayName: id,
    inputTokenLimit: 1000000,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"],
    version: "1.0",
    ...extra,
  };
}

function catalogFetch(catalog: GeminiModel[]): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ models: catalog }),
    text: async () => "",
  });
}

function throwingFetch(err: Error): FetchLike {
  return async () => {
    throw err;
  };
}

function abortingFetch(): FetchLike {
  return (_url: string, init?: unknown) => {
    const signal = (init as any)?.signal as AbortSignal | undefined;
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  };
}

// ---------------------------------------------------------------------------
// normalizeModel unit tests
// ---------------------------------------------------------------------------

describe("Gemini normalizeModel", () => {
  it("classifies a free-tier model with direct_api access, $0 pricing, no card", () => {
    const n = normalizeModel(mkModel("gemini-2.5-flash"));
    expect(n.isFree).toBe(true);
    expect(n.availability).not.toBeNull();
    const a = n.availability!;
    expect(a.accessType).toBe("direct_api");
    expect(a.isFree).toBe(true);
    expect(a.inputPricePerMillion).toBe(0);
    expect(a.outputPricePerMillion).toBe(0);
    expect(a.requiresApiKey).toBe(true);
    expect(a.requiresPaymentMethod).toBe(false);
    expect(a.requiresSignup).toBe(true);
    expect(a.apiFormat).toBe("gemini");
    expect(a.status).toBe("available");
  });

  it("stores the published per-model TPM but leaves RPM and RPD unknown (null)", () => {
    const a = normalizeModel(mkModel("gemini-2.5-flash")).availability!;
    // 2.5 Flash published TPM from the official rate-limits docs.
    expect(a.rateLimitTpm).toBe(3_000_000);
    // Google publishes no fixed public RPM/RPD grid for the standard API. These
    // are intentionally null so the UI never invents them.
    expect(a.rateLimitRpm).toBeNull();
    expect(a.dailyLimit).toBeNull();
    expect(a.free.reason).toMatch(/AI Studio|usage tier|not publish/i);
  });

  it("does NOT prefix the model id and matches the seed google availability id", () => {
    const n = normalizeModel(mkModel("gemini-2.5-flash"));
    expect(n.model.id).toBe("gemini-2.5-flash");
    expect(n.availability!.id).toBe("gemini-2.5-flash__google");
    expect(n.model.providerId).toBe("google");
  });

  it("derives multimodal vision support for chat models and text-only for embeddings", () => {
    const flash = normalizeModel(mkModel("gemini-2.5-flash")).model;
    expect(flash.visionSupport).toBe(true);
    expect(flash.inputModalities).toContain("image");

    const embed = normalizeModel(
      mkModel("gemini-embedding-2", { supportedGenerationMethods: ["embedContent"], outputTokenLimit: 0 })
    ).model;
    expect(embed.visionSupport).toBe(false);
    expect(embed.inputModalities).toEqual(["text"]);
  });

  it("classifies a paid-only model as NOT free", () => {
    const n = normalizeModel(mkModel("gemini-3.1-pro-preview"));
    expect(n.isFree).toBe(false);
    expect(n.availability).toBeNull();
    expect(n.free.isFree).toBe(false);
    expect(n.free.pricingClass).toBe("paid");
  });

  it("treats unknown models (not in the free-tier transcription) as unknown", () => {
    const n = normalizeModel(mkModel("gemini-xyz-unknown"));
    expect(n.isFree).toBe(false);
    expect(n.availability).toBeNull();
    expect(n.free.pricingClass).toBe("unknown");
  });

  it("tolerates unexpected/extra fields without throwing", () => {
    const raw = mkModel("gemini-2.5-flash", {
      // @ts-expect-error - intentionally unexpected field
      weirdField: "should be ignored",
      temperature: 0.7,
      topK: 40,
    });
    expect(() => normalizeModel(raw)).not.toThrow();
    expect(normalizeModel(raw).isFree).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end run tests
// ---------------------------------------------------------------------------

describe("Gemini runGeminiCollector", () => {
  beforeEach(() => resetDb());
  afterEach(() => resetDb());

  it("discovers catalog models and imports only the free ones (snapshot fallback when no key)", async () => {
    const report = await runGeminiCollector({});
    expect(report.status).toBe("success");
    expect(report.modelsDiscovered).toBe(GEMINI_CATALOG_SNAPSHOT.length);
    // gemini-3.1-pro-preview is paid-only, so it is excluded.
    expect(report.freeModels).toBeGreaterThan(0);
    expect(report.freeModels).toBeLessThan(report.modelsDiscovered);
    expect(report.warnings.some((w) => /snapshot/i.test(w))).toBe(true);
    expect(report.freeRoutesAdded).toBe(report.freeModels);

    const rows = getDb().prepare("SELECT * FROM availability WHERE provider_id = ? AND is_active = 1").all(GEMINI_PROVIDER_ID) as any[];
    expect(rows.length).toBe(report.freeModels);
    expect(rows.every((r) => r.access_type === "direct_api")).toBe(true);
  });

  it("uses a live fetch when an apiKey + fetchImpl are supplied", async () => {
    const catalog = [mkModel("gemini-2.5-flash")];
    const report = await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch(catalog) });
    expect(report.status).toBe("success");
    expect(report.modelsDiscovered).toBe(1);
    expect(report.freeModels).toBe(1);
    expect(report.warnings.some((w) => /snapshot/i.test(w))).toBe(false);
  });

  it("links every imported route to all four official sources", async () => {
    await runGeminiCollector({});
    const routes = getDb()
      .prepare("SELECT id FROM availability WHERE provider_id = ? AND is_active = 1")
      .all(GEMINI_PROVIDER_ID) as any[];
    expect(routes.length).toBeGreaterThan(0);
    const expectedSources = [GEMINI_SOURCE_CATALOG_ID, GEMINI_SOURCE_PRICING_ID, GEMINI_SOURCE_RATELIMITS_ID, GEMINI_SOURCE_BILLING_ID];
    for (const r of routes) {
      const linked = getDb()
        .prepare("SELECT source_id FROM availability_sources WHERE availability_id = ?")
        .all(r.id) as any[];
      const ids = linked.map((x) => x.source_id);
      for (const sid of expectedSources) expect(ids).toContain(sid);
    }
  });

  it("is idempotent: a second identical run adds nothing", async () => {
    const r1 = await runGeminiCollector({});
    const r2 = await runGeminiCollector({});
    expect(r2.modelsAdded).toBe(0);
    expect(r2.freeRoutesAdded).toBe(0);
    expect(r2.modelsChanged).toBe(0);
    expect(r2.freeRoutesRemoved).toBe(0);
    // The collector_runs table should have two runs.
    const runs = getDb().prepare("SELECT COUNT(*) AS c FROM collector_runs WHERE collector = ?").get(GEMINI_PROVIDER_ID) as any;
    expect(runs.c).toBe(2);
    expect(r1.status).toBe("success");
  });

  it("adds a new free model discovered in a later run", async () => {
    await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
    const catalog2 = [mkModel("gemini-2.5-flash"), mkModel("gemini-2.0-flash")];
    const r2 = await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch(catalog2) });
    expect(r2.newFreeRoutes).toContain("gemini-2.0-flash__google");
    expect(r2.freeRoutesAdded).toBe(1);
  });

  it("removes a free route when the model disappears from the catalog", async () => {
    await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
    // Run again with an empty catalog (model gone).
    const r2 = await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([]) });
    expect(r2.removedFreeRoutes).toContain("gemini-2.5-flash__google");
    const row = getDb().prepare("SELECT is_active, status FROM availability WHERE id = ?").get("gemini-2.5-flash__google") as any;
    expect(row.is_active).toBe(0);
    expect(row.status).toBe("unavailable");
  });

  it("marks a route removed with a 'became paid' reason when it leaves the free tier", async () => {
    await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
    // Simulate the model leaving the free tier (still present in catalog).
    const prev = GEMINI_FREE_TIER["gemini-2.5-flash"];
    delete GEMINI_FREE_TIER["gemini-2.5-flash"];
    try {
      const r2 = await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
      expect(r2.removedFreeRoutes).toContain("gemini-2.5-flash__google");
      const chg = getDb()
        .prepare("SELECT * FROM change_history WHERE entity_id = ? AND field_changed = 'removed' ORDER BY detected_at DESC LIMIT 1")
        .get("gemini-2.5-flash__google") as any;
      expect(chg.notes).toMatch(/no longer free|paid/i);
    } finally {
      GEMINI_FREE_TIER["gemini-2.5-flash"] = prev;
    }
  });

  it("records a rate-limit change when the published TPM changes", async () => {
    await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
    const prev = GEMINI_FREE_TIER["gemini-2.5-flash"];
    GEMINI_FREE_TIER["gemini-2.5-flash"] = { ...prev, tpm: 12345 };
    try {
      const r2 = await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
      expect(r2.changedFreeRoutes.some((c) => c.id === "gemini-2.5-flash__google")).toBe(true);
      const row = getDb().prepare("SELECT rate_limit_tpm FROM availability WHERE id = ?").get("gemini-2.5-flash__google") as any;
      expect(row.rate_limit_tpm).toBe(12345);
    } finally {
      GEMINI_FREE_TIER["gemini-2.5-flash"] = prev;
    }
  });

  it("is failure-safe: a network error records a failed run and touches no rows", async () => {
    const before = getDb().prepare("SELECT COUNT(*) AS c FROM availability WHERE provider_id = ?").get(GEMINI_PROVIDER_ID) as any;
    const report = await runGeminiCollector({ apiKey: "k", fetchImpl: throwingFetch(new Error("boom")) });
    expect(report.status).toBe("failed");
    expect(report.errorMessage).toMatch(/boom/);
    const after = getDb().prepare("SELECT COUNT(*) AS c FROM availability WHERE provider_id = ?").get(GEMINI_PROVIDER_ID) as any;
    expect(after.c).toBe(before.c);
    const runs = getDb().prepare("SELECT status FROM collector_runs WHERE collector = ? ORDER BY started_at DESC LIMIT 1").get(GEMINI_PROVIDER_ID) as any;
    expect(runs.status).toBe("failed");
  });

  it("refuses a suspiciously small catalog (partial response guard)", async () => {
    // Seed a prior large successful run so the guard arms.
    getDb()
      .prepare(
        "INSERT INTO collector_runs (id, collector, started_at, finished_at, status, dry_run, models_discovered, free_models, models_added, models_changed, models_removed, free_routes_added, free_routes_removed, error_count, warning_count, error_message, summary) VALUES (?,?,?,?,?,0,?,?,0,0,0,0,0,0,0,NULL,'')"
      )
      .run("run-seed", GEMINI_PROVIDER_ID, "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "success", 50, 10);
    await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
    const runs = getDb().prepare("SELECT status FROM collector_runs WHERE collector = ? ORDER BY started_at DESC LIMIT 1").get(GEMINI_PROVIDER_ID) as any;
    expect(runs.status).toBe("failed");
    // No availability rows should have been written by the refused run.
    const rows = getDb().prepare("SELECT COUNT(*) AS c FROM availability WHERE data_origin = 'live_collector' AND provider_id = ?").get(GEMINI_PROVIDER_ID) as any;
    expect(rows.c).toBe(0);
  });

  it("treats an empty catalog as a removal sweep (not an error)", async () => {
    await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([mkModel("gemini-2.5-flash")]) });
    const r2 = await runGeminiCollector({ apiKey: "k", fetchImpl: catalogFetch([]) });
    expect(r2.status).toBe("success");
    expect(r2.removedFreeRoutes).toContain("gemini-2.5-flash__google");
  });

  it("handles malformed catalog responses by recording a failed run", async () => {
    const badFetch: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ notModels: [] }), text: async () => "" });
    const report = await runGeminiCollector({ apiKey: "k", fetchImpl: badFetch });
    expect(report.status).toBe("failed");
    expect(report.errorMessage).toMatch(/Malformed|models/i);
  });

  it("dry run does not write rows", async () => {
    const report = await runGeminiCollector({ dryRun: true });
    expect(report.dryRun).toBe(true);
    const rows = getDb().prepare("SELECT COUNT(*) AS c FROM availability WHERE provider_id = ? AND data_origin = 'live_collector'").get(GEMINI_PROVIDER_ID) as any;
    expect(rows.c).toBe(0);
    expect(report.newFreeRoutes.length).toBeGreaterThan(0);
  });
});
