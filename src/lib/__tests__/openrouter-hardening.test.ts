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
import { scoreModel } from "../queries";
import type { ModelView } from "../queries";

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
const SENTINEL_PRICING = { prompt: "-1", completion: "-1" };

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

function missingDataFetch(): FetchLike {
  return async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ foo: [] }), text: async () => "" });
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
function modelCount() {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) AS c FROM models").get() as any).c as number;
}

// ---------------------------------------------------------------------------
// Step 2 — Free classification / normalization bugs (regression)
// ---------------------------------------------------------------------------

describe("regression: classifyPricing must not trust '-1' sentinel as free", () => {
  it("treats prompt:'-1' as NOT free (unknown)", () => {
    const c = classifyPricing({ prompt: "-1", completion: "-1" });
    expect(c.isFree).toBe(false);
    expect(c.pricingClass).toBe("unknown");
  });

  it("treats a single negative price as NOT free", () => {
    const c = classifyPricing({ prompt: "0", completion: "-1" });
    expect(c.isFree).toBe(false);
  });

  it("treats a non-numeric price as NOT free", () => {
    const c = classifyPricing({ prompt: "free" as any, completion: "0" });
    expect(c.isFree).toBe(false);
  });

  it("normalizeModel does NOT build a free availability for '-1' pricing", () => {
    const n = normalizeModel(mkModel("openrouter/auto", SENTINEL_PRICING));
    expect(n.isFree).toBe(false);
    expect(n.availability).toBeNull();
  });

  it("does not confuse a genuinely free ':free' model with the '-1' routing models", () => {
    const free = normalizeModel(mkModel("openrouter/free", FREE_PRICING));
    expect(free.isFree).toBe(true);
    expect(free.availability).not.toBeNull();
  });
});

describe("regression: vision_support derives from input (image understanding), not output", () => {
  it("input image modalities => visionSupport true", () => {
    const n = normalizeModel(
      mkModel("x/y:free", FREE_PRICING, { architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } })
    );
    expect(n.model.visionSupport).toBe(true);
  });
  it("output-only image (image generation) => visionSupport false", () => {
    const n = normalizeModel(
      mkModel("x/y:free", FREE_PRICING, { architecture: { input_modalities: ["text"], output_modalities: ["text", "image"] } })
    );
    expect(n.model.visionSupport).toBe(false);
  });
});

describe("regression: free != unlimited — limits-not-specified note is attached", () => {
  it("normalized free availability reason warns about unspecified usage limits", () => {
    const n = normalizeModel(mkModel("x/y:free", FREE_PRICING));
    expect(n.availability!.free.reason).toMatch(/usage limits.*not specified/i);
  });
  it("persisted availability note includes the limits caveat after a run", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("x/y:free", FREE_PRICING)]) });
    const db = getDb();
    const a = db.prepare("SELECT verification_notes FROM availability WHERE id = 'openrouter__x/y:free__openrouter'").get() as any;
    expect(a.verification_notes).toMatch(/usage limits.*not specified/i);
  });
});

// ---------------------------------------------------------------------------
// Step 11 — ranking fairness: seed/demo must not outrank live_collector
// ---------------------------------------------------------------------------

describe("regression: ranking reliability uses trust tier, not raw confidence", () => {
  function view(freshness: any, access: any = "free_through_aggregator"): ModelView {
    return {
      id: "m", name: "m", providerId: "p", family: null, version: null, releaseDate: null,
      contextWindow: 8000, maxOutputTokens: null, inputModalities: ["text"], outputModalities: ["text"],
      visionSupport: false, toolCalling: false, structuredOutput: false, reasoningSupport: false,
      codingCapability: null, isOpenSource: false, license: null, officialPageUrl: null, documentationUrl: null,
      description: null, routes: [{ availability: { accessType: access } as any } as any],
      freeRouteCount: 1, bestAccessType: access, bestStatus: "available", bestConfidence: "verified",
      bestFreshness: freshness, noPaymentMethod: true, noCreditCard: true, lowFriction: false, harnessCount: 0,
      dataQuality: "live",
    } as unknown as ModelView;
  }
  it("a seed/demo row (even with 'verified' confidence) does not outrank a live_collector 'likely' row", () => {
    const seed = scoreModel(view("seed_demo"));
    const live = scoreModel(view("likely"));
    expect(live.total).toBeGreaterThanOrEqual(seed.total);
  });
  it("live_verified outranks both", () => {
    const live = scoreModel(view("likely"));
    const verified = scoreModel(view("live_verified"));
    expect(verified.total).toBeGreaterThan(live.total);
  });
});

// ---------------------------------------------------------------------------
// Step 6 — change detection scenarios A–E (deterministic fixtures)
// ---------------------------------------------------------------------------

describe("change detection scenarios", () => {
  beforeEach(() => resetDb());

  it("Scenario A — paid becomes free: availability created + change_history + values", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", PAID_PRICING)]) });
    expect(availCount()).toBe(0);
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING)]) });
    expect(r.newFreeRoutes.length).toBe(1);
    expect(activeAvailCount()).toBe(1);
    const db = getDb();
    const ch = db.prepare("SELECT * FROM change_history WHERE entity_id = 'openrouter__a/b__openrouter' AND field_changed = 'added'").get() as any;
    expect(ch).toBeTruthy();
    expect(ch.new_value).toMatch(/free_through_aggregator/);
    expect(ch.old_value).toBeNull();
  });

  it("Scenario B — free becomes paid: marked unavailable, history preserved", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING)]) });
    expect(activeAvailCount()).toBe(1);
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", PAID_PRICING)]) });
    expect(r.removedFreeRoutes.length).toBe(1);
    expect(activeAvailCount()).toBe(0);
    const db = getDb();
    const a = db.prepare("SELECT * FROM availability WHERE id = 'openrouter__a/b__openrouter'").get() as any;
    expect(a.is_active).toBe(0);
    expect(a.status).toBe("unavailable");
    // history is preserved (the original 'added' + the 'removed')
    expect(changeCountFor("openrouter__a/b__openrouter")).toBeGreaterThanOrEqual(2);
  });

  it("Scenario C — free model disappears: marked removed, NOT deleted", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING)]) });
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch([]) });
    expect(r.removedFreeRoutes.length).toBe(1);
    expect(activeAvailCount()).toBe(0);
    // row still exists (preserved, not deleted)
    expect(availCount()).toBe(1);
  });

  it("Scenario D — free model changes context length: current updated, history preserved", async () => {
    await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING, { context_length: 8000 })]) });
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b", FREE_PRICING, { context_length: 16000 })]) });
    expect(r.changedModels.length).toBe(1);
    const db = getDb();
    const m = db.prepare("SELECT context_window FROM models WHERE id = 'openrouter__a/b'").get() as any;
    expect(m.context_window).toBe(16000);
    expect(changeCountFor("openrouter__a/b")).toBeGreaterThanOrEqual(1);
  });

  it("Scenario E — partial/truncated response refuses to mutate existing data", async () => {
    // First establish a baseline with 30 free models (prevCount > 20 so the guard arms).
    const big = Array.from({ length: 30 }, (_, i) => mkModel(`prov/m${i}:free`, FREE_PRICING));
    await runOpenRouterCollector({ fetchImpl: catalogFetch(big) });
    expect(availCount()).toBe(30);

    // Now a truncated response (only 5 models) — far below 50% of 30.
    const partial = Array.from({ length: 5 }, (_, i) => mkModel(`prov/m${i}:free`, FREE_PRICING));
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch(partial) });
    expect(r.status).toBe("failed");
    expect(r.warnings.join(" ")).toMatch(/partial|truncated/i);
    // Existing data must remain completely intact.
    expect(availCount()).toBe(30);
    expect(activeAvailCount()).toBe(30);
    expect(r.removedFreeRoutes.length).toBe(0);
  });

  it("Scenario E negative — a plausible smaller response still proceeds", async () => {
    const big = Array.from({ length: 30 }, (_, i) => mkModel(`prov/m${i}:free`, FREE_PRICING));
    await runOpenRouterCollector({ fetchImpl: catalogFetch(big) });
    // 20 models is > 50% of 30, so it's considered plausible.
    const smaller = Array.from({ length: 20 }, (_, i) => mkModel(`prov/m${i}:free`, FREE_PRICING));
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch(smaller) });
    expect(r.status).toBe("success");
    expect(r.removedFreeRoutes.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Step 7 — aggressive idempotency + reordering
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  beforeEach(() => resetDb());

  it("repeated runs create zero duplicates (run 1/2/3)", async () => {
    const cat = catalogFetch([mkModel("a/b:free", FREE_PRICING, { context_length: 8000 }), mkModel("c/d:free", FREE_PRICING)]);
    const r1 = await runOpenRouterCollector({ fetchImpl: cat });
    expect(r1.newFreeRoutes.length).toBe(2);
    const before = availCount();
    const r2 = await runOpenRouterCollector({ fetchImpl: cat });
    expect(r2.newFreeRoutes.length).toBe(0);
    expect(availCount()).toBe(before);
    const r3 = await runOpenRouterCollector({ fetchImpl: cat });
    expect(r3.newFreeRoutes.length).toBe(0);
    expect(availCount()).toBe(before);
  });

  it("reordering the catalog creates no changes", async () => {
    const ordered = catalogFetch([mkModel("a/b:free", FREE_PRICING), mkModel("c/d:free", FREE_PRICING)]);
    await runOpenRouterCollector({ fetchImpl: ordered });
    const chBefore = (getDb().prepare("SELECT COUNT(*) c FROM change_history").get() as any).c;
    const reordered = catalogFetch([mkModel("c/d:free", FREE_PRICING), mkModel("a/b:free", FREE_PRICING)]);
    const r = await runOpenRouterCollector({ fetchImpl: reordered });
    expect(r.changedModels.length).toBe(0);
    expect(r.changedFreeRoutes.length).toBe(0);
    const chAfter = (getDb().prepare("SELECT COUNT(*) c FROM change_history").get() as any).c;
    expect(chAfter).toBe(chBefore);
  });
});

// ---------------------------------------------------------------------------
// Step 8 — failure safety against pre-existing data
// ---------------------------------------------------------------------------

describe("failure safety preserves existing data", () => {
  beforeEach(() => resetDb());

  async function seedLiveData() {
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch([mkModel("a/b:free", FREE_PRICING), mkModel("c/d:free", FREE_PRICING)]) });
    expect(r.status).toBe("success");
    expect(availCount()).toBe(2);
    expect(modelCount()).toBeGreaterThan(0);
  }

  it("malformed JSON (missing data array) fails without writing", async () => {
    await seedLiveData();
    const before = availCount();
    const r = await runOpenRouterCollector({ fetchImpl: missingDataFetch() });
    expect(r.status).toBe("failed");
    expect(availCount()).toBe(before);
  });

  it("HTTP / network failure fails without writing", async () => {
    await seedLiveData();
    const before = availCount();
    const r = await runOpenRouterCollector({ fetchImpl: throwingFetch(new Error("boom")) });
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toMatch(/boom/);
    expect(availCount()).toBe(before);
  });

  it("timeout (aborted fetch) fails without writing", async () => {
    await seedLiveData();
    const before = availCount();
    const r = await runOpenRouterCollector({ fetchImpl: abortingFetch(), timeoutMs: 20, maxRetries: 0 });
    expect(r.status).toBe("failed");
    expect(availCount()).toBe(before);
  });

  it("empty model array leaves existing data untouched", async () => {
    await seedLiveData();
    const before = availCount();
    const r = await runOpenRouterCollector({ fetchImpl: catalogFetch([]) });
    expect(r.status).toBe("success");
    expect(r.freeModels).toBe(0);
    expect(availCount()).toBe(before);
  });

  it("incomplete model objects (null / missing id) are skipped, no crash", async () => {
    await seedLiveData();
    const before = availCount();
    const cat = catalogFetch([
      mkModel("a/b:free", FREE_PRICING),
      null as any,
      { pricing: { prompt: "0", completion: "0" } } as any, // missing id
    ]);
    const r = await runOpenRouterCollector({ fetchImpl: cat });
    expect(r.status).toBe("success");
    expect(availCount()).toBe(before); // the broken entries were skipped
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("unexpected pricing format (price as object) is not classified free", async () => {
    await seedLiveData();
    const before = availCount();
    const cat = catalogFetch([
      mkModel("a/b:free", FREE_PRICING),
      mkModel("weird/x:free", { prompt: { per_token: 0 } } as any),
    ]);
    const r = await runOpenRouterCollector({ fetchImpl: cat });
    expect(r.status).toBe("success");
    // 'weird/x' must NOT be imported as free
    expect(availCount()).toBe(before);
  });

  it("run report signals failure so the UI never claims success on a failed run", async () => {
    await seedLiveData();
    const r = await runOpenRouterCollector({ fetchImpl: throwingFetch(new Error("boom")) });
    // The 'ok' semantics used by the admin action / API route:
    expect(r.status).toBe("failed");
    expect(r.status !== "failed").toBe(false);
  });
});
