import { describe, it, expect } from "vitest";
import { getAllModels, getModelView, getFreeModels } from "@/lib/queries";
import { serializeModelView, serializeSource, serializeScoredModel } from "@/lib/api";
import type { ScoredModel } from "@/lib/queries";

describe("API serialization", () => {
  it("exposes freshness and per-route sources on a model view", () => {
    const model = getAllModels()[0];
    const view = getModelView(model.id)!;
    const out = serializeModelView(view);

    expect(out).toHaveProperty("bestFreshness");
    expect(out).toHaveProperty("dataQuality");
    expect(Array.isArray(out.routes)).toBe(true);
    for (const r of out.routes) {
      expect(r).toHaveProperty("freshness");
      expect(Array.isArray(r.sources)).toBe(true);
    }
  });

  it("serializeSource includes reliability fields", () => {
    const free = getFreeModels();
    const view = getModelView(free[0].id)!;
    const src = view.routes[0].sources[0];
    if (src) {
      const s = serializeSource(src);
      expect(s).toHaveProperty("reliability");
      expect(s).toHaveProperty("lastCheckedAt");
    }
  });

  it("serializeScoredModel carries score breakdown", () => {
    const view = getModelView(getAllModels()[0].id)!;
    const scored: ScoredModel = {
      view,
      score: {
        total: 0.8, capability: 0.5, freeAccess: 0.5, reliability: 0.5, freshness: 0.5, availability: 0.5,
      },
    };
    const out = serializeScoredModel(scored);
    expect(out.score.total).toBe(0.8);
    expect(out.score).toHaveProperty("freshness");
  });
});
