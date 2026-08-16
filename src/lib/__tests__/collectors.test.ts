import { describe, it, expect } from "vitest";
import { OpenAICollector } from "@/lib/collectors/examples/openai";
import { CollectorOrchestrator } from "@/lib/collectors/base";
import type { CollectorResult, CollectorSink, NormalizedAvailability } from "@/lib/collectors/types";

class MemorySink implements CollectorSink {
  availabilities: NormalizedAvailability[] = [];
  models = new Set<string>();
  finished: CollectorResult | null = null;
  async upsertModel(m: { id: string }) { this.models.add(m.id); }
  async upsertAvailability(a: NormalizedAvailability) { this.availabilities.push(a); }
  async finish(r: CollectorResult) { this.finished = r; }
}

describe("collector framework", () => {
  it("normalizes and validates without writing to the DB", async () => {
    const collector = new OpenAICollector();
    const sink = new MemorySink();
    const orch = new CollectorOrchestrator(collector, sink);
    const result = await orch.run(["gpt-4o-mini"]);

    expect(result.availabilities.length).toBeGreaterThan(0);
    const mini = result.availabilities.find((a) => a.id === "openai__gpt-4o-mini");
    expect(mini).toBeDefined();
    expect(mini!.accessType).toBe("free_tier");
    // gpt-4o-mini has a quota unit, so validation passes
    expect(collector.validate(mini!)).toHaveLength(0);
    expect(sink.finished).not.toBeNull();
  });

  it("flags validation issues when quota value lacks a unit", () => {
    const collector = new OpenAICollector();
    const bad = collector.normalize("gpt-4o-mini", {
      externalId: "gpt-4o-mini",
      freeAccess: true,
      accessType: "free_tier",
      status: "available",
      freeQuotaValue: 100,
      freeQuotaUnit: null,
    });
    expect(collector.validate(bad)).toContain("freeQuotaValue without unit");
  });
});
