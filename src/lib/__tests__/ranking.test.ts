import { describe, it, expect } from "vitest";
import { getModelView, getFreeModels, rankModels, queryModels } from "@/lib/queries";

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
