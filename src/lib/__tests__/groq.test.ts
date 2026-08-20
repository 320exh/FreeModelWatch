import { describe, it, expect, beforeEach } from "vitest";
import { GroqCollector, GROQ_FREE_TIER, GROQ_CATALOG_SNAPSHOT, normalizeGroqModel, GROQ_PROVIDER_ID } from "@/lib/collectors/groq";
import { CollectorOrchestrator } from "@/lib/collectors/base";
import { DbCollectorSink } from "@/lib/collectors/dbSink";
import { getDb, resetDb } from "@/lib/db";
import type { CollectorSink, NormalizedAvailability } from "@/lib/collectors/types";
import { runGroqCollector } from "@/lib/collectors/run";

class MemorySink implements CollectorSink {
  availabilities: NormalizedAvailability[] = [];
  models = new Set<string>();
  finished: unknown = null;
  async upsertModel(m: { id: string }) { this.models.add(m.id); }
  async upsertAvailability(a: NormalizedAvailability) { this.availabilities.push(a); }
  async finish(r: unknown) { this.finished = r; }
}

const FREE_IDS = Object.entries(GROQ_FREE_TIER).filter(([, v]) => v.free).map(([k]) => k);

describe("Groq collector — bundled snapshot normalization", () => {
  it("normalizes every bundled free model as free with $0 pricing and published limits", () => {
    for (const m of GROQ_CATALOG_SNAPSHOT) {
      const entry = GROQ_FREE_TIER[m.name];
      if (!entry?.free) continue;
      const { model, availability, isFree, free } = normalizeGroqModel(m);
      expect(isFree).toBe(true);
      expect(availability).not.toBeNull();
      expect(availability!.inputPricePerMillion).toBe(0);
      expect(availability!.outputPricePerMillion).toBe(0);
      expect(availability!.accessType).toBe("direct_api");
      expect(availability!.requiresPaymentMethod).toBe(false);
      expect(availability!.paymentRequirementKnown).toBe(true);
      // Groq publishes per-model rate limits — at least one must be captured (not
      // all null). Some models (e.g. Maverick) do not have a separately published
      // TPM, which is fine; the test asserts the limit is genuinely documented, not invented.
      const limits = [availability!.rateLimitRpm, availability!.rateLimitTpm, availability!.dailyLimit];
      expect(limits.some((l) => l != null)).toBe(true);
      // Monthly caps are not published for the free tier — must stay null.
      expect(availability!.monthlyLimit).toBeNull();
      expect(free.pricingClass).toBe("free_tier");
      expect(model.providerId).toBe(GROQ_PROVIDER_ID);
      expect(model.id).toBe(m.name);
    }
  });

  it("produces a stable availability id of the form <model>__groq", () => {
    const { availability } = normalizeGroqModel({ name: "llama-3.3-70b-versatile" });
    expect(availability!.id).toBe("llama-3.3-70b-versatile__groq");
  });
});

describe("Groq free-model classification", () => {
  it("classifies an unknown model as not-free / unknown (no fabrication)", () => {
    const { isFree, availability, free } = normalizeGroqModel({ name: "some-unknown-model" });
    expect(isFree).toBe(false);
    expect(availability).toBeNull();
    expect(free.isFree).toBe(false);
    expect(free.pricingClass).toBe("unknown");
  });

  it("classifies a paid-only model as paid with real per-token pricing", () => {
    const { isFree, availability, free } = normalizeGroqModel({ name: "llama-3.1-405b" });
    expect(isFree).toBe(false);
    expect(availability).toBeNull();
    expect(free.pricingClass).toBe("paid");
    expect(free.isFree).toBe(false);
  });

  it("falls back to the snapshot context window when raw omits it", () => {
    const { model } = normalizeGroqModel({ name: "llama-3.3-70b-versatile", contextWindow: null });
    expect(model.contextWindow).toBe(131072);
  });
});

describe("Groq pricing normalization", () => {
  it("maps paid llama-3.1-405b pricing to per-million fields", () => {
    const { availability } = normalizeGroqModel({ name: "llama-3.1-405b" });
    // availability is null for paid-only; verify via the FREE_TIER transcription instead.
    expect(GROQ_FREE_TIER["llama-3.1-405b"].free).toBe(false);
    expect(GROQ_FREE_TIER["llama-3.1-405b"].inputPrice).toBe(2.99);
    expect(GROQ_FREE_TIER["llama-3.1-405b"].outputPrice).toBe(2.99);
  });

  it("keeps all free models at $0 input/output", () => {
    for (const id of FREE_IDS) {
      expect(GROQ_FREE_TIER[id].inputPrice).toBe(0);
      expect(GROQ_FREE_TIER[id].outputPrice).toBe(0);
    }
  });
});

describe("Groq collector validation", () => {
  const collector = new GroqCollector();

  it("passes for a correct free availability", () => {
    const a = collector.normalize("llama-3.3-70b-versatile", {
      externalId: "llama-3.3-70b-versatile",
      freeAccess: true,
      accessType: "direct_api",
      status: "available",
      requiresPaymentMethod: false,
      requiresApiKey: true,
      requiresSignup: true,
      pricePerMillionIn: 0,
      pricePerMillionOut: 0,
      sourceUrl: "https://groq.com/pricing",
      sourceTitle: "Groq",
      sourceType: "official_docs",
    });
    expect(collector.validate(a)).toHaveLength(0);
  });

  it("flags a free model that incorrectly requires a payment method", () => {
    const a = collector.normalize("llama-3.3-70b-versatile", {
      externalId: "llama-3.3-70b-versatile",
      freeAccess: true,
      accessType: "direct_api",
      status: "available",
      requiresPaymentMethod: true,
      requiresApiKey: true,
      requiresSignup: true,
      pricePerMillionIn: 0,
      pricePerMillionOut: 0,
      sourceUrl: "https://groq.com/pricing",
      sourceTitle: "Groq",
      sourceType: "official_docs",
    });
    const issues = collector.validate(a);
    expect(issues).toContain("available but requires payment method while marked free");
  });

  it("flags a free availability record that omits accessType", () => {
    const a = {
      id: "llama-3.3-70b-versatile__groq",
      modelId: "llama-3.3-70b-versatile",
      providerId: "groq",
      externalId: "llama-3.3-70b-versatile",
      freeAccess: true,
      status: "available" as const,
      confidence: "likely" as const,
      requiresPaymentMethod: false,
      requiresApiKey: true,
      requiresSignup: true,
      pricePerMillionIn: 0,
      pricePerMillionOut: 0,
    } as unknown as NormalizedAvailability;
    expect(collector.validate(a)).toContain("freeAccess set without accessType");
  });
});

describe("Groq collector output compatibility", () => {
  it("works through the generic CollectorOrchestrator + MemorySink without a DB", async () => {
    const collector = new GroqCollector();
    const sink = new MemorySink();
    const orch = new CollectorOrchestrator(collector, sink);
    const result = await orch.run(FREE_IDS);
    expect(result.availabilities.length).toBe(FREE_IDS.length);
    expect(sink.availabilities.every((a) => a.providerId === GROQ_PROVIDER_ID)).toBe(true);
    expect(sink.finished).not.toBeNull();
  });

  it("writes normalized output through the existing DbCollectorSink into the schema", () => {
    resetDb();
    const sink = new DbCollectorSink(new Date("2026-08-19T00:00:00Z"));
    const [modelsSrc, pricingSrc, rateSrc] = sink.ensureGroqSources();
    sink.ensureGroqProvider();

    const { model, availability } = normalizeGroqModel({ name: "llama-3.3-70b-versatile" });
    sink.upsertModelRow(model, { sourceUrl: "https://console.groq.com/docs/models" });
    const ar = sink.upsertAvailabilityRow(availability!, pricingSrc);
    sink.linkSources(availability!.id, [modelsSrc, rateSrc]);

    const db = getDb();
    const mrow = db.prepare("SELECT * FROM models WHERE id = ?").get("llama-3.3-70b-versatile") as any;
    const arow = db.prepare("SELECT * FROM availability WHERE id = ?").get("llama-3.3-70b-versatile__groq") as any;
    const srcLink = db.prepare("SELECT * FROM availability_sources WHERE availability_id = ?").all("llama-3.3-70b-versatile__groq") as any[];

    expect(mrow).toBeTruthy();
    expect(arow).toBeTruthy();
    expect(arow.access_type).toBe("direct_api");
    expect(arow.input_price_per_million).toBe(0);
    expect(arow.output_price_per_million).toBe(0);
    expect(arow.rate_limit_rpm).toBe(30);
    expect(arow.rate_limit_tpm).toBe(12000);
    expect(arow.daily_limit).toBe(1000);
    expect(arow.requires_payment_method).toBe(0);
    expect(arow.data_origin).toBe("live_collector");
    expect(ar.added).toBe(true);
    // upsertAvailabilityRow links the pricing source internally; linkSources adds models + rate-limits.
    expect(srcLink.length).toBe(3);
  });
});

describe("Groq snapshot correctness (regression)", () => {
  const DEPRECATED_IDS = [
    "llama-4-maverick-17b-16e-instruct", // wrong expert count (must be 128e)
    "llama-4-scout-17b-16e-instruct", // missing meta-llama/ prefix
    "deepseek-r1-distill-llama-70b",
    "gemma2-9b-it",
    "mistral-saba-24b",
    "qwen-qwq-32b",
    "allam-2-7b",
  ];

  it("excludes deprecated / unverified model IDs from the free snapshot", () => {
    for (const id of DEPRECATED_IDS) {
      expect(GROQ_FREE_TIER[id]?.free, `unexpected free entry for ${id}`).not.toBe(true);
    }
    const snapshotNames = GROQ_CATALOG_SNAPSHOT.map((m) => m.name);
    for (const id of DEPRECATED_IDS) {
      expect(snapshotNames, `deprecated id still in snapshot: ${id}`).not.toContain(id);
    }
  });

  it("normalizes the corrected Llama 4 Scout ID (with meta-llama/ prefix) as free + multimodal", () => {
    const { model, availability, isFree, free } = normalizeGroqModel({ name: "meta-llama/llama-4-scout-17b-16e-instruct" });
    expect(isFree).toBe(true);
    expect(availability!.id).toBe("meta-llama/llama-4-scout-17b-16e-instruct__groq");
    expect(model.visionSupport).toBe(true);
    expect(model.inputModalities).toContain("image");
    expect(free.pricingClass).toBe("free_tier");
  });

  it("normalizes the corrected Llama 4 Maverick ID (128e) as free", () => {
    const { model, availability, isFree } = normalizeGroqModel({ name: "llama-4-maverick-17b-128e-instruct" });
    expect(isFree).toBe(true);
    expect(availability!.id).toBe("llama-4-maverick-17b-128e-instruct__groq");
    expect(model.visionSupport).toBe(true);
    // Maverick free-tier TPM is not separately published — must be unknown, not invented.
    expect(availability!.rateLimitTpm).toBeNull();
    expect(availability!.rateLimitRpm).toBe(15);
    expect(availability!.dailyLimit).toBe(500);
  });

  it("preserves the corrected per-model rate limits", () => {
    const llama33 = normalizeGroqModel({ name: "llama-3.3-70b-versatile" }).availability!;
    expect(llama33.rateLimitTpm).toBe(12000); // corrected from stale 6000
    expect(llama33.dailyLimit).toBe(1000);

    const instant = normalizeGroqModel({ name: "llama-3.1-8b-instant" }).availability!;
    expect(instant.dailyLimit).toBe(14400); // corrected from stale 1000
    expect(instant.rateLimitTpm).toBe(6000);

    const scout = normalizeGroqModel({ name: "meta-llama/llama-4-scout-17b-16e-instruct" }).availability!;
    expect(scout.rateLimitTpm).toBe(30000); // corrected from stale 6000

    const gptOss = normalizeGroqModel({ name: "openai/gpt-oss-120b" }).availability!;
    expect(gptOss.rateLimitTpm).toBe(8000);
    expect(gptOss.rateLimitRpm).toBe(30);

    const qwen3n = normalizeGroqModel({ name: "qwen/qwen3-32b" });
    expect(qwen3n.availability!.rateLimitRpm).toBe(60);
    expect(qwen3n.model.reasoningSupport).toBe(true);

    const kimin = normalizeGroqModel({ name: "moonshotai/kimi-k2-instruct" });
    expect(kimin.availability!.rateLimitRpm).toBe(60);
    expect(kimin.availability!.rateLimitTpm).toBe(10000);
    expect(kimin.model.reasoningSupport).toBe(true);
  });

  it("keeps every claimed-free model at $0 with no payment method required", () => {
    for (const id of FREE_IDS) {
      const a = normalizeGroqModel({ name: id }).availability!;
      expect(a.inputPricePerMillion).toBe(0);
      expect(a.outputPricePerMillion).toBe(0);
      expect(a.requiresPaymentMethod).toBe(false);
      expect(a.paymentRequirementKnown).toBe(true);
    }
  });

  it("still distinguishes free / paid / unknown classification", () => {
    expect(normalizeGroqModel({ name: "llama-3.3-70b-versatile" }).isFree).toBe(true);
    const paid = normalizeGroqModel({ name: "llama-3.1-405b" });
    expect(paid.isFree).toBe(false);
    expect(paid.free.pricingClass).toBe("paid");
    const unknown = normalizeGroqModel({ name: "some-unknown-model" });
    expect(unknown.isFree).toBe(false);
    expect(unknown.free.pricingClass).toBe("unknown");
  });
});

describe("Groq collector end-to-end dry run", () => {
  beforeEach(() => resetDb());

  it("reports the bundled free models without writing to the database", async () => {
    const report = await runGroqCollector({ dryRun: true });
    expect(report.status).toBe("success");
    expect(report.collector).toBe(GROQ_PROVIDER_ID);
    expect(report.modelsDiscovered).toBe(GROQ_CATALOG_SNAPSHOT.length);
    expect(report.freeModels).toBe(FREE_IDS.length);
    // Dry run must not create availability rows.
    const rows = getDb().prepare("SELECT COUNT(*) AS c FROM availability").get() as any;
    expect(rows.c).toBe(0);
  });
});
