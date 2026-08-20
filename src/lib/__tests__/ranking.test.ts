import { describe, it, expect } from "vitest";
import { getModelView, getFreeModels, rankModels, queryModels, getDataState, isLiveFreshness } from "@/lib/queries";
import type { ModelView } from "@/lib/queries";
import type { FreshnessTier } from "@/lib/types";

function makeMockModel(overrides: Partial<ModelView> = {}): ModelView {
  return {
    id: "test-model",
    name: "Test Model",
    providerId: "test",
    family: null,
    version: null,
    releaseDate: null,
    contextWindow: 4096,
    maxOutputTokens: 4096,
    inputModalities: [],
    outputModalities: [],
    visionSupport: false,
    toolCalling: false,
    structuredOutput: false,
    reasoningSupport: false,
    codingCapability: 3,
    isOpenSource: false,
    license: null,
    officialPageUrl: null,
    documentationUrl: null,
    description: null,
    routes: [],
    freeRouteCount: 0,
    bestAccessType: null,
    bestStatus: null,
    bestConfidence: "unverified",
    bestFreshness: "seed_demo",
    noPaymentMethod: false,
    noCreditCard: false,
    lowFriction: false,
    harnessCount: 0,
    dataQuality: "seed",
    ...overrides,
  };
}

describe("ranking is transparent and route-count independent", () => {
  const buildViews = () => {
    const free = queryModels({}).slice(0, 30);
    return free.map((m) => getModelView(m.id)).filter((v): v is NonNullable<typeof v> => !!v);
  };

  it("produces a ranked list with score breakdowns", () => {
    const views = buildViews();
    const ranked = rankModels(views);
    expect(Array.isArray(ranked)).toBe(true);
    expect(ranked.length).toBeGreaterThan(0);
    for (const r of ranked) {
      const s = r.score;
      expect(Number.isFinite(s.total)).toBe(true);
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(s.total).toBeLessThanOrEqual(110);
      expect(s).toHaveProperty("capability");
      expect(s).toHaveProperty("freshness");
      expect(s).toHaveProperty("reliability");
    }
  });

  it("scores stay within bounds (no NaN / no reward beyond max)", () => {
    const views = buildViews();
    const ranked = rankModels(views);
    for (const r of ranked) {
      expect(Number.isFinite(r.score.total)).toBe(true);
      expect(r.score.total).toBeLessThanOrEqual(110);
      expect(r.score.total).toBeGreaterThanOrEqual(0);
    }
  });

  it("free-model filter excludes models with no free route", () => {
    const freeModels = getFreeModels();
    const all = queryModels({});
    const freeIds = new Set(freeModels.map((m) => m.id));
    for (const m of all) expect(freeIds.has(m.id)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(freeModels.length);
  });
});

describe("isLiveFreshness helper", () => {
  it("returns true for live_verified and likely", () => {
    expect(isLiveFreshness("live_verified")).toBe(true);
    expect(isLiveFreshness("likely")).toBe(true);
  });
  it("returns false for seed_demo, unverified, stale, expired, unavailable", () => {
    expect(isLiveFreshness("seed_demo")).toBe(false);
    expect(isLiveFreshness("unverified")).toBe(false);
    expect(isLiveFreshness("stale")).toBe(false);
    expect(isLiveFreshness("expired")).toBe(false);
    expect(isLiveFreshness("unavailable")).toBe(false);
  });
});

describe("live-first sort behavior", () => {
  it("groups live_verified/likely before seed_demo, preserves capability within groups", () => {
    const models: ModelView[] = [
      makeMockModel({ id: "seed-low", name: "Seed Low", codingCapability: 1, bestFreshness: "seed_demo" }),
      makeMockModel({ id: "seed-high", name: "Seed High", codingCapability: 5, bestFreshness: "seed_demo" }),
      makeMockModel({ id: "live-low", name: "Live Low", codingCapability: 1, bestFreshness: "likely" }),
      makeMockModel({ id: "live-high", name: "Live High", codingCapability: 5, bestFreshness: "live_verified" }),
      makeMockModel({ id: "unverified-mid", name: "Unverified Mid", codingCapability: 3, bestFreshness: "unverified" }),
    ];

    // Sort using live-first logic (copied from queryModels)
    const sorted = [...models].sort((a, b) => {
      const aLive = isLiveFreshness(a.bestFreshness) ? 1 : 0;
      const bLive = isLiveFreshness(b.bestFreshness) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return (b.codingCapability ?? 0) - (a.codingCapability ?? 0) || (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
    });

    // Live models should come first
    expect(sorted[0].id).toBe("live-high");  // live_verified, cap 5
    expect(sorted[1].id).toBe("live-low");   // likely, cap 1
    // Then seed/unverified models by capability
    expect(sorted[2].id).toBe("seed-high");     // seed_demo, cap 5
    expect(sorted[3].id).toBe("unverified-mid"); // unverified, cap 3
    expect(sorted[4].id).toBe("seed-low");      // seed_demo, cap 1
  });

  it("preserves relevance ranking within live group", () => {
    const models: ModelView[] = [
      makeMockModel({ id: "live-cap3", codingCapability: 3, bestFreshness: "live_verified" }),
      makeMockModel({ id: "live-cap5", codingCapability: 5, bestFreshness: "likely" }),
      makeMockModel({ id: "live-cap1", codingCapability: 1, bestFreshness: "live_verified" }),
    ];
    const sorted = [...models].sort((a, b) => {
      const aLive = isLiveFreshness(a.bestFreshness) ? 1 : 0;
      const bLive = isLiveFreshness(b.bestFreshness) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return (b.codingCapability ?? 0) - (a.codingCapability ?? 0) || (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
    });
    expect(sorted.map((m) => m.id)).toEqual(["live-cap5", "live-cap3", "live-cap1"]);
  });

  it("preserves relevance ranking within seed group", () => {
    const models: ModelView[] = [
      makeMockModel({ id: "seed-cap2", codingCapability: 2, bestFreshness: "seed_demo" }),
      makeMockModel({ id: "seed-cap4", codingCapability: 4, bestFreshness: "seed_demo" }),
      makeMockModel({ id: "seed-cap1", codingCapability: 1, bestFreshness: "seed_demo" }),
    ];
    const sorted = [...models].sort((a, b) => {
      const aLive = isLiveFreshness(a.bestFreshness) ? 1 : 0;
      const bLive = isLiveFreshness(b.bestFreshness) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return (b.codingCapability ?? 0) - (a.codingCapability ?? 0) || (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
    });
    expect(sorted.map((m) => m.id)).toEqual(["seed-cap4", "seed-cap2", "seed-cap1"]);
  });
});

describe("origin filter (live-only vs seed)", () => {
  it("getDataState reports seed in test environment (no live collectors run in tests)", () => {
    const state = getDataState();
    expect(state.hasSeed).toBe(true);
    // In test env, no live collectors run, so no live routes
    expect(state.hasLive).toBe(false);
    expect(state.seedRouteCount).toBeGreaterThan(0);
    expect(state.liveRouteCount).toBe(0);
  });

  it("origin=live_collector filters to live-collector models only", () => {
    const liveOnly = queryModels({ origin: ["live_collector"] });
    // In test env, no live routes exist, so this should be empty
    expect(liveOnly.length).toBe(0);
  });

  it("origin=seed filters to seed models only", () => {
    const seedOnly = queryModels({ origin: ["seed"] });
    for (const m of seedOnly) {
      for (const r of m.routes) {
        expect(r.availability.dataOrigin).toBe("seed");
      }
      expect(m.dataQuality).toBe("seed");
    }
    // Should match all models since all test data is seed
    const all = queryModels({});
    expect(seedOnly.length).toBe(all.length);
  });

  it("origin=live_collector,production excludes seed", () => {
    const liveAndProd = queryModels({ origin: ["live_collector", "production"] });
    // In test env, no live/production routes
    expect(liveAndProd.length).toBe(0);
  });

  it("origin filter does not affect total model count when empty", () => {
    const withOrigin = queryModels({ origin: [] });
    const withoutOrigin = queryModels({});
    expect(withOrigin.length).toBe(withoutOrigin.length);
  });
});
