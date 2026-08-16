import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, getDb } from "../db";
import {
  classifyPricing,
  normalizeModel,
  OPENROUTER_PROVIDER_ID,
  type OpenRouterModel,
  type FetchLike,
} from "../collectors/openrouter";
import { runOpenRouterCollector } from "../collectors/run";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkModel(id: string, pricing: Record<string, string>, extra: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id,
    name: id,
    canonical_slug: id,
    context_length: 8000,
    created: 1700000000,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: pricing as any,
    supported_parameters: ["tools"],
    ...extra,
  };
}

const FREE_PRICING = { prompt: "0", completion: "0", request: "0" };
const PAID_PRICING = { prompt: "0.00001", completion: "0.00002", request: "0" };

function catalogFetch(catalog: OpenRouterModel[]): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: catalog }),
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

function providerCount() {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) AS c FROM providers WHERE id = ?").get(OPENROUTER_PROVIDER_ID) as any).c as number;
}
function availCount() {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) AS c FROM availability WHERE provider_id = ?").get(OPENROUTER_PROVIDER_ID) as any).c as number;
}
function activeAvailCount() {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) AS c FROM availability WHERE provider_id = ? AND is_active = 1").get(OPENROUTER_PROVIDER_ID) as any).c as number;
}
function changeCountFor(entityId: string) {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) AS c FROM change_history WHERE entity_id = ?").get(entityId) as any).c as number;
}

// ---------------------------------------------------------------------------
// Free / paid detection (the core "don't trust free blindly" rule)
// ---------------------------------------------------------------------------

describe("classifyPricing — free model detection", () => {
  it("classifies all-zero pricing as zero_cost_inference (free)", () => {
    const c = classifyPricing({ prompt: "0", completion: "0", request: "0" });
    expect(c.isFree).toBe(true);
    expect(c.pricingClass).toBe("zero_cost_inference");
    expect(c.accessType).toBe("free_through_aggregator");
  });

  it("classifies a non-zero price as paid (never labels paid as free)", () => {
    const c = classifyPricing(PAID_PRICING);
    expect(c.isFree).toBe(false);
    expect(c.pricingClass).toBe("paid");
  });

  it("treats a missing price dimension as free", () => {
    const c = classifyPricing({ prompt: "0", completion: "0" });
    expect(c.isFree).toBe(true);
  });

  it("flags paid when only request is non-zero", () => {
    const c = classifyPricing({ prompt: "0", completion: "0", request: "0.001" });
    expect(c.isFree).toBe(false);
  });

  it("does not trust the model name — a ':free' suffix with paid pricing is NOT free", () => {
    const c = classifyPricing({ prompt: "0.1", completion: "0.2", request: "0" });
    expect(c.isFree).toBe(false);
  });

  it("returns unknown (not free) when pricing is missing", () => {
    const c = classifyPricing(undefined);
    expect(c.isFree).toBe(false);
    expect(c.pricingClass).toBe("unknown");
  });

  it("normalizeModel only builds a free availability for free pricing", () => {
    const free = normalizeModel(mkModel("a/b:free", FREE_PRICING));
    expect(free.isFree).toBe(true);
    expect(free.availability).not.toBeNull();
    const paid = normalizeModel(mkModel("a/b", PAID_PRICING));
    expect(paid.isFree).toBe(false);
    expect(paid.availability).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Collector runs
// ---------------------------------------------------------------------------

describe("runOpenRouterCollector", () => {
  beforeEach(() => {
    resetDb();
  });

  it("successful API response imports free models, provider, source", async () => {
    const report = await runOpenRouterCollector({
      fetchImpl: catalogFetch([
        mkModel("meta-llama/llama-3.1-8b:free", FREE_PRICING),
        mkModel("openai/gpt-4o", PAID_PRICING),
      ]),
    });
    expect(report.status).toBe("success");
    expect(report.modelsDiscovered).toBe(2);
    expect(report.freeModels).toBe(1);
    expect(availCount()).toBe(1);
    expect(activeAvailCount()).toBe(1);
    expect(providerCount()).toBe(1);
    // provenance: live_collector, not production
    const db = getDb();
    const a = db.prepare("SELECT * FROM availability WHERE id = ?").get("openrouter__meta-llama/llama-3.1-8b:free__openrouter") as any;
    expect(a.data_origin).toBe("live_collector");
    expect(a.verification_confidence).toBe("likely");
    expect(a.status).toBe("available");
    // paid model is NOT imported as a free route
    const paidAvail = db.prepare("SELECT COUNT(*) AS c FROM availability WHERE model_id = 'openrouter__openai/gpt-4o'").get() as any;
    expect(paidAvail.c).toBe(0);
    // source de-duplicated
    const src = db.prepare("SELECT COUNT(*) AS c FROM sources WHERE url = 'https://openrouter.ai/api/v1/models'").get() as any;
    expect(src.c).toBe(1);
  });

  it("malformed API response (missing data) fails without writing data", async () => {
    const bad: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ foo: [] }), text: async () => "" });
    const report = await runOpenRouterCollector({ fetchImpl: bad });
    expect(report.status).toBe("failed");
    expect(report.errorMessage).toMatch(/data/);
    expect(availCount()).toBe(0);
    expect(providerCount()).toBe(0);
  });

  it("empty catalog succeeds with no free models and writes nothing", async () => {
    const report = await runOpenRouterCollector({ fetchImpl: catalogFetch([]) });
    expect(report.status).toBe("success");
    expect(report.modelsDiscovered).toBe(0);
    expect(report.freeModels).toBe(0);
    expect(availCount()).toBe(0);
  });

  it("network error is recorded as failed and writes nothing", async () => {
    const report = await runOpenRouterCollector({ fetchImpl: throwingFetch(new Error("network down")) });
    expect(report.status).toBe("failed");
    expect(report.errorMessage).toMatch(/network down/);
    expect(availCount()).toBe(0);
    expect(providerCount()).toBe(0);
  });

  it("timeout (aborted fetch) is recorded as failed and writes nothing", async () => {
    const report = await runOpenRouterCollector({ fetchImpl: abortingFetch(), timeoutMs: 30, maxRetries: 0 });
    expect(report.status).toBe("failed");
    expect(availCount()).toBe(0);
  });

  it("is idempotent across repeated runs (no duplicates)", async () => {
    const fetch1 = catalogFetch([mkModel("meta-llama/llama-3.1-8b:free", FREE_PRICING, { context_length: 8000 })]);
    const r1 = await runOpenRouterCollector({ fetchImpl: fetch1 });
    expect(r1.newFreeRoutes.length).toBe(1);
    const r2 = await runOpenRouterCollector({ fetchImpl: fetch1 });
    expect(r2.newFreeRoutes.length).toBe(0);
    expect(r2.existingModels).toBe(1);
    expect(availCount()).toBe(1); // no duplicate availability
    expect(providerCount()).toBe(1); // no duplicate provider
    // no spurious change history on the second run
    expect(changeCountFor("openrouter__meta-llama/llama-3.1-8b:free__openrouter")).toBe(1); // only the initial 'added'
  });

  it("model becoming free creates a new free route", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", PAID_PRICING)]) });
    expect(availCount()).toBe(0);
    const r2 = await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING)]) });
    expect(r2.newFreeRoutes.length).toBe(1);
    expect(activeAvailCount()).toBe(1);
    expect(changeCountFor("openrouter__a/b__openrouter")).toBeGreaterThanOrEqual(1);
  });

  it("model becoming paid is removed (not deleted)", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING)]) });
    expect(activeAvailCount()).toBe(1);
    const r2 = await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", PAID_PRICING)]) });
    expect(r2.removedFreeRoutes.length).toBe(1);
    expect(activeAvailCount()).toBe(0);
    // row preserved but marked unavailable/inactive
    const db = getDb();
    const a = db.prepare("SELECT * FROM availability WHERE id = 'openrouter__a/b__openrouter'").get() as any;
    expect(a.is_active).toBe(0);
    expect(a.status).toBe("unavailable");
    expect(a.data_origin).toBe("live_collector");
  });

  it("model disappearing from the catalog is marked removed", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING)]) });
    const r2 = await runOpenRouterCollector({ fetchImpl: catalogFetch([]) });
    expect(r2.removedFreeRoutes.length).toBe(1);
    expect(activeAvailCount()).toBe(0);
  });

  it("changed context limit is recorded as a model change", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING, { context_length: 8000 })]) });
    const r2 = await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING, { context_length: 16000 })]) });
    expect(r2.changedModels.length).toBe(1);
    expect(r2.changedModels[0].id).toBe("openrouter__a/b");
    expect(changeCountFor("openrouter__a/b")).toBeGreaterThanOrEqual(1);
  });

  it("dry run fetches and reports but writes nothing", async () => {
    const r = await runOpenRouterCollector({ dryRun: true, fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING)]) });
    expect(r.dryRun).toBe(true);
    expect(r.freeModels).toBe(1);
    expect(r.newFreeRoutes.length).toBe(1); // reported as would-be
    expect(availCount()).toBe(0); // nothing actually written
    expect(providerCount()).toBe(0);
  });

  it("failed collection does not corrupt pre-existing data", async () => {
    // seed some unrelated data first
    const { seedDatabase } = await import("../seed");
    await seedDatabase();
    const beforeTotal = (getDb().prepare("SELECT COUNT(*) AS c FROM availability").get() as any).c as number;
    const beforeOpenrouter = availCount();
    expect(beforeTotal).toBeGreaterThan(0);
    const report = await runOpenRouterCollector({ fetchImpl: throwingFetch(new Error("boom")) });
    expect(report.status).toBe("failed");
    const afterTotal = (getDb().prepare("SELECT COUNT(*) AS c FROM availability").get() as any).c as number;
    expect(afterTotal).toBe(beforeTotal); // untouched
    expect(availCount()).toBe(beforeOpenrouter); // no openrouter rows sneaked in/out
  });
});
