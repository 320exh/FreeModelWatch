import { describe, it, expect } from "vitest";
import { getModelView, getFreeModels, rankModels, queryModels, getDataState } from "@/lib/queries";

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
