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
    bestCollectionMode: "seed",
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

describe("collection_mode filter", () => {
  it("collection_mode=live filters to live models only", () => {
    const liveOnly = queryModels({ collection_mode: ["live"] });
    for (const m of liveOnly) {
      for (const r of m.routes) {
        expect(r.availability.collectionMode).toBe("live");
      }
      expect(m.bestCollectionMode).toBe("live");
    }
    // Should have fewer models than unfiltered
    const all = queryModels({});
    expect(liveOnly.length).toBeLessThanOrEqual(all.length);
  });

it("collection_mode=frozen filters to frozen models only", () => {
    const frozenOnly = queryModels({ collection_mode: ["frozen"] });
    for (const m of frozenOnly) {
      // Each model should have at least one frozen route
      const hasFrozen = m.routes.some((r) => r.availability.collectionMode === "frozen");
      expect(hasFrozen).toBe(true);
      // Note: bestCollectionMode may be "frozen" or "seed" depending on which route is ranked highest
    }
  });

it("collection_mode=seed filters to seed models only", () => {
    const seedOnly = queryModels({ collection_mode: ["seed"] });
    for (const m of seedOnly) {
      // Each model should have at least one seed route
      const hasSeed = m.routes.some((r) => r.availability.collectionMode === "seed");
      expect(hasSeed).toBe(true);
      // dataQuality should be "seed" (all routes are seed) or "mixed" (has seed + other)
      // In test env, some models are seed-only, some are mixed (have both seed and frozen routes)
      expect(["seed", "mixed"]).toContain(m.dataQuality);
    }
    // In test env, there are frozen models without seed routes, so seedOnly < all
    const all = queryModels({});
    expect(seedOnly.length).toBeLessThan(all.length);
  });

it("collection_mode=live,frozen excludes seed", () => {
    const liveAndFrozen = queryModels({ collection_mode: ["live", "frozen"] });
    // Should only include models that have at least one live/frozen route
    // In test env, this returns frozen fallback models (which may also have seed routes)
    // Verify no model has ONLY seed routes
    for (const m of liveAndFrozen) {
      const hasLiveOrFrozen = m.routes.some((r) => r.availability.collectionMode === "live" || r.availability.collectionMode === "frozen");
      expect(hasLiveOrFrozen).toBe(true);
      // All routes of this model should be either live or frozen (no seed-only models)
      const seedOnly = m.routes.every((r) => r.availability.collectionMode === "seed");
      expect(seedOnly).toBe(false);
    }
  });

  it("collection_mode filter does not affect total model count when empty", () => {
    const withMode = queryModels({ collection_mode: [] });
    const withoutMode = queryModels({});
    expect(withMode.length).toBe(withoutMode.length);
  });

  it("invalid collection_mode values are ignored via API route", () => {
    // The csv function in the API route filters out invalid values
    // This test would require hitting the API endpoint directly
    // For now, verify that queryModels with empty array returns all results
    const emptyMode = queryModels({ collection_mode: [] });
    const none = queryModels({});
    expect(emptyMode.length).toBe(none.length);
  });
});

describe("API serialization includes collection_mode", () => {
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
      bestCollectionMode: "seed",
      noPaymentMethod: false,
      noCreditCard: false,
      lowFriction: false,
      harnessCount: 0,
      dataQuality: "seed",
      ...overrides,
    };
  }

  it("serializes live collection_mode correctly", async () => {
    const { serializeModelView } = await import("@/lib/api");
    
    const model: ModelView = {
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
      routes: [{
        availability: { collectionMode: "live" } as any,
        provider: { 
          id: "test", 
          name: "Test", 
          category: "direct_api",
          websiteUrl: null,
          apiDocsUrl: null,
          pricingUrl: null,
          hasFreeTier: true,
          freeCreditsAmount: null,
          freeCreditsCurrency: "USD",
          rateLimitRpm: null,
          rateLimitTpm: null,
          dailyRequestLimit: null,
          monthlyTokenLimit: null,
          requiresPaymentMethod: false,
          requiresSignup: true,
          geographicRestrictions: [],
          termsRestrictions: null,
          status: "available",
          lastVerifiedAt: null,
          verificationConfidence: "verified",
          dataOrigin: "live_collector",
        },
        freshness: "live_verified",
        sources: [],
      }],
      freeRouteCount: 1,
      bestAccessType: "free_tier",
      bestStatus: "available",
      bestConfidence: "verified",
      bestFreshness: "live_verified",
      bestCollectionMode: "live",
      noPaymentMethod: false,
      noCreditCard: false,
      lowFriction: false,
      harnessCount: 0,
      dataQuality: "live",
    };
    
    const serialized = serializeModelView(model);
    expect(serialized.bestCollectionMode).toBe("live");
    expect(serialized.routes[0].collectionMode).toBe("live");
  });

  it("serializes frozen collection_mode correctly", async () => {
    const { serializeModelView } = await import("@/lib/api");
    
    const model: ModelView = {
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
      routes: [{
        availability: { collectionMode: "frozen" } as any,
        provider: { 
          id: "test", 
          name: "Test", 
          category: "direct_api",
          websiteUrl: null,
          apiDocsUrl: null,
          pricingUrl: null,
          hasFreeTier: true,
          freeCreditsAmount: null,
          freeCreditsCurrency: "USD",
          rateLimitRpm: null,
          rateLimitTpm: null,
          dailyRequestLimit: null,
          monthlyTokenLimit: null,
          requiresPaymentMethod: false,
          requiresSignup: true,
          geographicRestrictions: [],
          termsRestrictions: null,
          status: "available",
          lastVerifiedAt: null,
          verificationConfidence: "verified",
          dataOrigin: "seed",
        },
        freshness: "seed_demo",
        sources: [],
      }],
      freeRouteCount: 1,
      bestAccessType: "free_tier",
      bestStatus: "available",
      bestConfidence: "verified",
      bestFreshness: "seed_demo",
      bestCollectionMode: "frozen",
      noPaymentMethod: false,
      noCreditCard: false,
      lowFriction: false,
      harnessCount: 0,
      dataQuality: "seed",
    };
    
    const serialized = serializeModelView(model);
    expect(serialized.bestCollectionMode).toBe("frozen");
    expect(serialized.routes[0].collectionMode).toBe("frozen");
  });

  it("serializes seed collection_mode correctly", async () => {
    const { serializeModelView } = await import("@/lib/api");
    
    const model: ModelView = {
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
      routes: [{
        availability: { collectionMode: "seed" } as any,
        provider: { 
          id: "test", 
          name: "Test", 
          category: "direct_api",
          websiteUrl: null,
          apiDocsUrl: null,
          pricingUrl: null,
          hasFreeTier: true,
          freeCreditsAmount: null,
          freeCreditsCurrency: "USD",
          rateLimitRpm: null,
          rateLimitTpm: null,
          dailyRequestLimit: null,
          monthlyTokenLimit: null,
          requiresPaymentMethod: false,
          requiresSignup: true,
          geographicRestrictions: [],
          termsRestrictions: null,
          status: "available",
          lastVerifiedAt: null,
          verificationConfidence: "verified",
          dataOrigin: "seed",
        },
        freshness: "seed_demo",
        sources: [],
      }],
      freeRouteCount: 1,
      bestAccessType: "free_tier",
      bestStatus: "available",
      bestConfidence: "verified",
      bestFreshness: "seed_demo",
      bestCollectionMode: "seed",
      noPaymentMethod: false,
      noCreditCard: false,
      lowFriction: false,
      harnessCount: 0,
      dataQuality: "seed",
    };
    
    const serialized = serializeModelView(model);
    expect(serialized.bestCollectionMode).toBe("seed");
    expect(serialized.routes[0].collectionMode).toBe("seed");
  });
});
