import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GroqCollector,
  GROQ_FREE_TIER,
  GROQ_CATALOG_SNAPSHOT,
  normalizeGroqModel,
  GROQ_PROVIDER_ID,
  parseGroqFreePlanHtml,
  fetchGroqCatalogJson,
  fetchGroqFreePlanHtml,
  type GroqCatalogModel,
  type GroqFreePlanEntry,
} from "@/lib/collectors/groq";
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
    const { availability } = normalizeGroqModel({ name: "openai/gpt-oss-120b" });
    expect(availability!.id).toBe("openai/gpt-oss-120b__groq");
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
    const { model } = normalizeGroqModel({ name: "openai/gpt-oss-120b", contextWindow: null });
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

    const { model, availability } = normalizeGroqModel({ name: "openai/gpt-oss-120b" });
    sink.upsertModelRow(model, { sourceUrl: "https://console.groq.com/docs/models" });
    const ar = sink.upsertAvailabilityRow(availability!, pricingSrc);
    sink.linkSources(availability!.id, [modelsSrc, rateSrc]);

    const db = getDb();
    const mrow = db.prepare("SELECT * FROM models WHERE id = ?").get("openai/gpt-oss-120b") as any;
    const arow = db.prepare("SELECT * FROM availability WHERE id = ?").get("openai/gpt-oss-120b__groq") as any;
    const srcLink = db.prepare("SELECT * FROM availability_sources WHERE availability_id = ?").all("openai/gpt-oss-120b__groq") as any[];

    expect(mrow).toBeTruthy();
    expect(arow).toBeTruthy();
    expect(arow.access_type).toBe("direct_api");
    expect(arow.input_price_per_million).toBe(0);
    expect(arow.output_price_per_million).toBe(0);
    expect(arow.rate_limit_rpm).toBe(30);
    expect(arow.rate_limit_tpm).toBe(8000);
    expect(arow.daily_limit).toBe(1000);
    expect(arow.requires_payment_method).toBe(0);
    expect(arow.data_origin).toBe("live_collector");
    expect(ar.added).toBe(true);
    // upsertAvailabilityRow links the pricing source internally; linkSources adds models + rate-limits.
    expect(srcLink.length).toBe(3);
  });
});

describe("Groq snapshot correctness (regression)", () => {
  // Models that must NEVER appear as free (or in the snapshot): either they are
  // wrong/incorrect IDs that were corrected elsewhere, or they are absent from
  // Groq's CURRENT official free-plan rate-limits table (2026-08-20) and so
  // cannot be claimed free without fabrication.
  const EXCLUDED_IDS = [
    // Old/incorrect IDs — these were on the free tier before 2026-08-20 but are
    // now removed (or were wrong IDs); must never reappear as free / in snapshot.
    "llama-4-maverick-17b-16e-instruct", // wrong expert count (must be 128e)
    "llama-4-scout-17b-16e-instruct", // missing meta-llama/ prefix
    "meta-llama/llama-4-scout-17b-16e-instruct", // Llama 4 Scout removed from free tier (2026-08-20)
    "llama-4-maverick-17b-128e-instruct", // Llama 4 Maverick removed from free tier (2026-08-20)
    "llama-3.1-8b-instant", // removed from free tier (2026-08-20)
    "llama-3.3-70b-versatile", // removed from free tier (2026-08-20)
    "qwen/qwen3-32b", // removed from free tier (2026-08-20)
    "moonshotai/kimi-k2-instruct", // removed from free tier (2026-08-20)
    // Not present in Groq's current official free-plan table — must stay excluded:
    "deepseek-r1-distill-llama-70b",
    "gemma-2-9b",
    "gemma2-9b-it",
    "mistral-saba-24b",
    "qwen-qwq-32b",
    "mixtral-8x7b",
    "mixtral-8x7b-32768",
    "llama-3.2-11b-vision",
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision",
    "llama-3.2-90b-vision-preview",
  ];

  it("excludes deprecated / unverified model IDs from the free snapshot", () => {
    for (const id of EXCLUDED_IDS) {
      expect(GROQ_FREE_TIER[id]?.free, `unexpected free entry for ${id}`).not.toBe(true);
    }
    const snapshotNames = GROQ_CATALOG_SNAPSHOT.map((m) => m.name);
    for (const id of EXCLUDED_IDS) {
      expect(snapshotNames, `excluded id still in snapshot: ${id}`).not.toContain(id);
    }
  });

  it("classifies allam-2-7b (in catalog but absent from Free Plan) as unknown — never free", () => {
    const { isFree, availability, free } = normalizeGroqModel({ name: "allam-2-7b" });
    expect(isFree).toBe(false);
    expect(availability).toBeNull();
    expect(free.pricingClass).toBe("unknown");
  });

  it("keeps qwen/qwen3.6-27b as a confirmed free model", () => {
    const { isFree, availability, free } = normalizeGroqModel({ name: "qwen/qwen3.6-27b" });
    expect(isFree).toBe(true);
    expect(availability!.id).toBe("qwen/qwen3.6-27b__groq");
    expect(availability!.rateLimitRpm).toBe(30);
    expect(availability!.rateLimitTpm).toBe(8000);
    expect(availability!.dailyLimit).toBe(1000);
    expect(free.pricingClass).toBe("free_tier");
  });

  it("normalizes groq/compound as a free model with published limits", () => {
    const { model, availability, isFree, free } = normalizeGroqModel({ name: "groq/compound" });
    expect(isFree).toBe(true);
    expect(availability!.id).toBe("groq/compound__groq");
    expect(availability!.rateLimitRpm).toBe(30);
    expect(availability!.rateLimitTpm).toBe(70000);
    expect(availability!.dailyLimit).toBe(250);
    expect(free.pricingClass).toBe("free_tier");
  });

  it("normalizes whisper-large-v3 as a free transcription model with published limits", () => {
    const { model, availability, isFree } = normalizeGroqModel({ name: "whisper-large-v3" });
    expect(isFree).toBe(true);
    expect(availability!.id).toBe("whisper-large-v3__groq");
    expect(availability!.rateLimitRpm).toBe(20);
    expect(availability!.rateLimitTpm).toBe(7200);
    expect(availability!.dailyLimit).toBe(2000);
  });

  it("preserves the per-model free-tier rate limits", () => {
    const compound = normalizeGroqModel({ name: "groq/compound" }).availability!;
    expect(compound.rateLimitRpm).toBe(30);
    expect(compound.rateLimitTpm).toBe(70000);
    expect(compound.dailyLimit).toBe(250);

    const orpheus = normalizeGroqModel({ name: "canopylabs/orpheus-v1-english" }).availability!;
    expect(orpheus.rateLimitRpm).toBe(10);
    expect(orpheus.rateLimitTpm).toBe(1200);
    expect(orpheus.dailyLimit).toBe(100);

    const guard = normalizeGroqModel({ name: "meta-llama/llama-prompt-guard-2-22m" }).availability!;
    expect(guard.rateLimitRpm).toBe(30);
    expect(guard.rateLimitTpm).toBe(15000);
    expect(guard.dailyLimit).toBe(14400);

    const gptOss = normalizeGroqModel({ name: "openai/gpt-oss-120b" }).availability!;
    expect(gptOss.rateLimitTpm).toBe(8000);
    expect(gptOss.rateLimitRpm).toBe(30);

    const qwen = normalizeGroqModel({ name: "qwen/qwen3.6-27b" });
    expect(qwen.availability!.rateLimitRpm).toBe(30);
    expect(qwen.availability!.rateLimitTpm).toBe(8000);
  });

  it("includes openai/gpt-oss-20b as a verified free model with official limits", () => {
    const { model, availability, isFree, free } = normalizeGroqModel({ name: "openai/gpt-oss-20b" });
    expect(isFree).toBe(true);
    expect(availability!.id).toBe("openai/gpt-oss-20b__groq");
    // Verified against Groq's current official free-plan rate-limits table (2026-08-20).
    expect(availability!.rateLimitRpm).toBe(30);
    expect(availability!.rateLimitTpm).toBe(8000);
    expect(availability!.dailyLimit).toBe(1000);
    expect(model.contextWindow).toBe(131072);
    expect(model.reasoningSupport).toBe(true);
    expect(availability!.inputPricePerMillion).toBe(0);
    expect(availability!.outputPricePerMillion).toBe(0);
    expect(availability!.requiresPaymentMethod).toBe(false);
    expect(free.pricingClass).toBe("free_tier");
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
    expect(normalizeGroqModel({ name: "openai/gpt-oss-20b" }).isFree).toBe(true);
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

// ---------------------------------------------------------------------------
// Hybrid two-source discovery (live catalog ∩ official Free Plan doc)
// ---------------------------------------------------------------------------

const FREE_PLAN_HTML = `
<html><body>
<h2>Free Plan</h2>
<table>
  <tr><th>Model</th><th>RPM</th><th>TPM</th><th>RPD</th><th>Context Window</th></tr>
  <tr><td>openai/gpt-oss-20b</td><td>30</td><td>8K</td><td>1,000</td><td>128K</td></tr>
  <tr><td>openai/gpt-oss-120b</td><td>30</td><td>8000</td><td>1000</td><td>131072</td></tr>
  <tr><td>qwen/qwen3.6-27b</td><td>60</td><td>6000</td><td>1000</td><td>131072</td></tr>
</table>
<h2>Developer Plan</h2>
<table>
  <tr><th>Model</th><th>RPM</th><th>TPM</th></tr>
  <tr><td>llama-3.1-405b</td><td>30</td><td>6000</td></tr>
</table>
</body></html>`;

describe("parseGroqFreePlanHtml", () => {
  it("extracts Free Plan rows (scoped past the Developer Plan) with K/M suffixes + context window", () => {
    const res = parseGroqFreePlanHtml(FREE_PLAN_HTML);
    expect(res.status).toBe("parsed");
    const ids = res.entries.map((e) => e.id).sort();
    expect(ids).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"].sort());
    const oss20 = res.entries.find((e) => e.id === "openai/gpt-oss-20b")!;
    expect(oss20.rpm).toBe(30);
    expect(oss20.tpm).toBe(8000);
    expect(oss20.rpd).toBe(1000);
    expect(oss20.contextWindow).toBe(128000);
    expect(oss20.status).toBe("free");
    // Developer Plan rows must NOT leak into the Free Plan parse.
    expect(res.entries.find((e) => e.id === "llama-3.1-405b")).toBeUndefined();
  });

  it("returns 'failed' for empty HTML", () => {
    expect(parseGroqFreePlanHtml("").status).toBe("failed");
    expect(parseGroqFreePlanHtml("   ").status).toBe("failed");
  });

  it("returns 'empty' when no limit rows are present", () => {
    const html = `<h2>Free Plan</h2><table><tr><th>Model</th><th>RPM</th></tr></table>`;
    const res = parseGroqFreePlanHtml(html);
    expect(res.status).toBe("empty");
    expect(res.entries).toHaveLength(0);
  });

  it("parses numeric cells with commas / K / M suffixes", () => {
    const html = `<h2>Free Plan</h2><table>
      <tr><th>Model</th><th>RPM</th><th>TPM</th><th>RPD</th></tr>
      <tr><td>big/model</td><td>5</td><td>500K</td><td>2M</td></tr></table>`;
    const res = parseGroqFreePlanHtml(html);
    expect(res.status).toBe("parsed");
    const e = res.entries[0];
    expect(e.rpm).toBe(5);
    expect(e.tpm).toBe(500000);
    expect(e.rpd).toBe(2000000);
  });
});

describe("fetchGroqCatalogJson", () => {
  it("maps /v1/models data into GroqCatalogModel[]", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-oss-20b", active: true, context_window: 131072 }] }),
    }) as unknown as typeof fetch;
    const res = await fetchGroqCatalogJson("key", fetchMock);
    expect(res.status).toBe("ok");
    expect(res.models).toHaveLength(1);
    expect(res.models[0].id).toBe("openai/gpt-oss-20b");
    expect(res.models[0].active).toBe(true);
    expect(res.models[0].context_window).toBe(131072);
  });

  it("returns an error on non-OK HTTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    const res = await fetchGroqCatalogJson("bad", fetchMock);
    expect(res.status).toBe("error");
    expect(res.models).toHaveLength(0);
    expect(res.error).toContain("401");
  });
});

describe("fetch functions (network isolation)", () => {
  it("fetchGroqFreePlanHtml returns HTML text on OK", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html>free plan</html>",
    }) as unknown as typeof fetch;
    const res = await fetchGroqFreePlanHtml(fetchMock);
    expect(res.status).toBe("ok");
    expect(res.html).toContain("free plan");
  });

  it("fetchGroqFreePlanHtml returns an error on non-OK HTTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const res = await fetchGroqFreePlanHtml(fetchMock);
    expect(res.status).toBe("error");
  });
});

describe("GroqCollector hybrid classification (live mode)", () => {
  it("confirms free when model is in catalog (active) AND Free Plan", () => {
    const c = new GroqCollector();
    c.setState(
      [{ id: "openai/gpt-oss-20b", active: true, context_window: 131072 } as GroqCatalogModel],
      [{ id: "openai/gpt-oss-20b", rpm: 30, tpm: 8000, rpd: 1000, status: "free", confidence: "verified" } as GroqFreePlanEntry],
    );
    const { isFree, availability, free } = c.normalizeRecord({ name: "openai/gpt-oss-20b" });
    expect(isFree).toBe(true);
    expect(availability!.rateLimitRpm).toBe(30);
    expect(availability!.rateLimitTpm).toBe(8000);
    expect(availability!.dailyLimit).toBe(1000);
    expect(availability!.confidence).toBe("verified");
    expect(free.pricingClass).toBe("free_tier");
  });

  it("classifies a catalog model absent from Free Plan as 'unknown' (never free, never paid)", () => {
    const c = new GroqCollector();
    c.setState(
      [{ id: "some-other", active: true, context_window: 8192 } as GroqCatalogModel],
      [{ id: "openai/gpt-oss-20b", rpm: 30, tpm: 8000, rpd: 1000, status: "free", confidence: "verified" } as GroqFreePlanEntry],
    );
    const { isFree, availability, free } = c.normalizeRecord({ name: "some-other" });
    expect(isFree).toBe(false);
    expect(availability).toBeNull();
    expect(free.pricingClass).toBe("unknown");
  });

  it("treats an inactive catalog model as stale/removed (not emitted)", () => {
    const c = new GroqCollector();
    c.setState(
      [{ id: "gone-model", active: false } as GroqCatalogModel],
      [{ id: "gone-model", rpm: 30, tpm: null, rpd: 1000, status: "free", confidence: "verified" } as GroqFreePlanEntry],
    );
    expect(c.getCatalogModels().map((m) => m.name)).not.toContain("gone-model");
  });

  it("marks a Free Plan entry explicitly 'paid' as paid (not free)", () => {
    const c = new GroqCollector();
    c.setState(
      [{ id: "expensive", active: true } as GroqCatalogModel],
      [{ id: "expensive", rpm: null, tpm: null, rpd: null, status: "paid", confidence: "verified" } as GroqFreePlanEntry],
    );
    const { isFree, free } = c.normalizeRecord({ name: "expensive" });
    expect(isFree).toBe(false);
    expect(free.pricingClass).toBe("paid");
  });

  it("distinguishes qwen/qwen3-32b (unknown) from qwen/qwen3.6-27b (free)", () => {
    const c = new GroqCollector();
    c.setState(
      [
        { id: "qwen/qwen3-32b", active: true } as GroqCatalogModel,
        { id: "qwen/qwen3.6-27b", active: true } as GroqCatalogModel,
      ],
      [{ id: "qwen/qwen3.6-27b", rpm: 30, tpm: 6000, rpd: 1000, status: "free", confidence: "verified" } as GroqFreePlanEntry],
    );
    expect(c.normalizeRecord({ name: "qwen/qwen3-32b" }).isFree).toBe(false);
    expect(c.normalizeRecord({ name: "qwen/qwen3.6-27b" }).isFree).toBe(true);
  });

  it("discover() returns live catalog listings when keyed, frozen snapshot otherwise", async () => {
    const live = new GroqCollector();
    live.setState(
      [
        { id: "a", active: true } as GroqCatalogModel,
        { id: "b", active: true } as GroqCatalogModel,
      ],
      [],
    );
    expect((await live.discover()).map((d) => d.externalId).sort()).toEqual(["a", "b"]);

    const frozen = new GroqCollector();
    expect((await frozen.discover()).length).toBe(GROQ_CATALOG_SNAPSHOT.length);
  });

  it("emits only confirmed-free models through the orchestrator (unknown excluded)", async () => {
    const c = new GroqCollector();
    c.setState(
      [
        { id: "openai/gpt-oss-20b", active: true, context_window: 131072 } as GroqCatalogModel,
        { id: "other-catalog-model", active: true } as GroqCatalogModel,
      ],
      [{ id: "openai/gpt-oss-20b", rpm: 30, tpm: 8000, rpd: 1000, status: "free", confidence: "verified" } as GroqFreePlanEntry],
    );
    const sink = new MemorySink();
    const orch = new CollectorOrchestrator(c, sink);
    const result = await orch.run(["openai/gpt-oss-20b", "other-catalog-model"]);
    expect(result.availabilities.length).toBe(1);
    expect(result.availabilities[0].modelId).toBe("openai/gpt-oss-20b");
  });
});

describe("GroqCollector.prepareLive (mocked fetch)", () => {
  function makeFetch(catalogJson: unknown, freeHtml: string, catalogOk = true, docOk = true) {
    return vi.fn((url: string) => {
      if (url.includes("/models")) {
        return Promise.resolve(catalogOk ? { ok: true, json: async () => catalogJson } : { ok: false, status: 401 });
      }
      if (url.includes("rate-limits")) {
        return Promise.resolve(docOk ? { ok: true, text: async () => freeHtml } : { ok: false, status: 500 });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof fetch;
  }

  it("succeeds and exposes catalog + parsed Free Plan", async () => {
    const c = new GroqCollector();
    const f = makeFetch({ data: [{ id: "openai/gpt-oss-20b", active: true, context_window: 131072 }] }, FREE_PLAN_HTML);
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("ok");
    expect(c.getCatalogModels().map((m) => m.name)).toContain("openai/gpt-oss-20b");
    expect(c.normalizeRecord({ name: "openai/gpt-oss-20b" }).isFree).toBe(true);
  });

  it("fails when the catalog fetch fails (does not emit partial data)", async () => {
    const c = new GroqCollector();
    const f = makeFetch({}, FREE_PLAN_HTML, false, true);
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("error");
    expect(res.error).toContain("catalog");
  });

  it("fails when the Free Plan doc fetch fails", async () => {
    const c = new GroqCollector();
    const f = makeFetch({ data: [{ id: "openai/gpt-oss-20b", active: true }] }, "", true, false);
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("error");
    expect(res.error).toContain("doc");
  });
});

// ---------------------------------------------------------------------------
// Regression: real Groq Rate Limits page structure (validation gate findings)
// ---------------------------------------------------------------------------

// Mirrors the ACTUAL served HTML: the Free/Developer plan selectors are adjacent
// tab buttons, the column header row lives in one <table>, and the model <tbody>
// rows live in a SEPARATE <table>. A trailing doc table (Header/Value/Notes)
// must never be mistaken for model rows.
const REAL_STRUCTURE_HTML = `
<table>
  <thead>
    <tr><th colSpan="6"><nav><ul>
      <li><button type="button">Free Plan Limits</button></li>
      <li><button type="button">Developer Plan Limits</button></li>
    </ul></nav></th><th></th></tr>
    <tr><th>MODEL ID</th><th>RPM</th><th>RPD</th><th>TPM</th><th>TPD</th><th>ASH</th><th>ASD</th></tr>
  </thead>
</table>
<table>
  <tbody>
    <tr><td><div>openai/gpt-oss-20b</div></td><td>30</td><td>1,000</td><td>8K</td><td>3.6K</td><td>-</td><td>-</td></tr>
    <tr><td><div>qwen/qwen3.6-27b</div></td><td>60</td><td>1000</td><td>6K</td><td>3.6K</td><td>-</td><td>-</td></tr>
    <tr><td><div>whisper-large-v3</div></td><td>100</td><td>2000</td><td>10K</td><td>50K</td><td>-</td><td>-</td></tr>
  </tbody>
</table>
<table>
  <thead><tr><th>Header</th><th>Value</th><th>Notes</th></tr></thead>
  <tbody><tr><td>retry-after</td><td>2</td><td>In seconds</td></tr></tbody>
</table>`;

describe("parseGroqFreePlanHtml — real page structure", () => {
  it("extracts Free Plan rows even though the tab buttons are adjacent", () => {
    const res = parseGroqFreePlanHtml(REAL_STRUCTURE_HTML);
    expect(res.status).toBe("parsed");
    const ids = res.entries.map((e) => e.id).sort();
    expect(ids).toEqual(["openai/gpt-oss-20b", "qwen/qwen3.6-27b", "whisper-large-v3"].sort());
  });

  it("does NOT return empty merely because Free/Developer tab labels are adjacent", () => {
    const res = parseGroqFreePlanHtml(REAL_STRUCTURE_HTML);
    expect(res.status).not.toBe("empty");
  });

  it("parses K/M-suffixed and comma-formatted limits from the real structure", () => {
    const res = parseGroqFreePlanHtml(REAL_STRUCTURE_HTML);
    const oss20 = res.entries.find((e) => e.id === "openai/gpt-oss-20b")!;
    expect(oss20.rpm).toBe(30);
    expect(oss20.tpm).toBe(8000);
    expect(oss20.rpd).toBe(1000);
    const whisper = res.entries.find((e) => e.id === "whisper-large-v3")!;
    expect(whisper.rpm).toBe(100);
    expect(whisper.tpm).toBe(10000);
  });

  it("excludes doc tables (Header/Value/Notes) after the model table", () => {
    const res = parseGroqFreePlanHtml(REAL_STRUCTURE_HTML);
    expect(res.entries.find((e) => e.id === "retry-after")).toBeUndefined();
    expect(res.entries.find((e) => e.id === "Header")).toBeUndefined();
  });
});

describe("parseGroqFreePlanHtml — empty / malformed must be failures", () => {
  // Header present and some rows parsed, but the document ends without a
  // closing </tbody>/</table> boundary — i.e. a truncated network response.
  const TRUNCATED_HTML = `
    <table>
      <thead><tr><th>MODEL ID</th><th>RPM</th><th>RPD</th><th>TPM</th></tr></thead>
      <tbody>
        <tr><td>openai/gpt-oss-20b</td><td>30</td><td>1000</td><td>8000</td></tr>
        <tr><td>qwen/qwen3.6-27b</td><td>60</td><td>1000</td><td>6000</td></tr>
  `;

  it("treats a header with no model rows as empty (a failure condition)", () => {
    const html = `<table><thead><tr><th>MODEL ID</th><th>RPM</th><th>RPD</th><th>TPM</th></tr></thead></table>`;
    expect(parseGroqFreePlanHtml(html).status).toBe("empty");
  });

  it("treats a truncated (unclosed) Free Plan table as partial, not verified", () => {
    const res = parseGroqFreePlanHtml(TRUNCATED_HTML);
    expect(res.status).toBe("partial");
    expect(res.entries).toHaveLength(0); // untrusted → discarded
  });

  it("treats a table with no recognizable Free Plan header as failed", () => {
    const html = `<table><tbody><tr><td>some-model</td><td>5</td><td>6</td></tr></tbody></table>`;
    const res = parseGroqFreePlanHtml(html);
    expect(res.status).toBe("failed");
  });

  it("treats entirely empty HTML as failed", () => {
    expect(parseGroqFreePlanHtml("").status).toBe("failed");
    expect(parseGroqFreePlanHtml("   ").status).toBe("failed");
  });
});

describe("GroqCollector.prepareLive — failure safety (no empty live set)", () => {
  function makeFetch(catalogJson: unknown, freeHtml: string, catalogOk = true, docOk = true) {
    return vi.fn((url: string) => {
      if (url.includes("/models")) {
        return Promise.resolve(catalogOk ? { ok: true, json: async () => catalogJson } : { ok: false, status: 401 });
      }
      if (url.includes("rate-limits")) {
        return Promise.resolve(docOk ? { ok: true, text: async () => freeHtml } : { ok: false, status: 500 });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof fetch;
  }

  it("cannot enter live mode when the Free Plan parse is empty", async () => {
    const c = new GroqCollector();
    const f = makeFetch({ data: [{ id: "openai/gpt-oss-20b", active: true }] }, `<table><thead><tr><th>MODEL ID</th><th>RPM</th><th>RPD</th><th>TPM</th></tr></thead></table>`);
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("error");
    expect(res.error).toContain("empty");
    // Not activated — must not run with an empty free set.
    expect(c.isLive()).toBe(false);
  });

  it("cannot enter live mode when the Free Plan header is unrecognizable", async () => {
    const c = new GroqCollector();
    const f = makeFetch({ data: [{ id: "openai/gpt-oss-20b", active: true }] }, `<table><tbody><tr><td>x</td><td>1</td></tr></tbody></table>`);
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("error");
    expect(c.isLive()).toBe(false);
  });

  it("cannot enter live mode when the Free Plan table is truncated/partial", async () => {
    const c = new GroqCollector();
    const f = makeFetch(
      { data: [{ id: "openai/gpt-oss-20b", active: true }] },
      `
      <table>
        <thead><tr><th>MODEL ID</th><th>RPM</th><th>RPD</th><th>TPM</th></tr></thead>
        <tbody>
          <tr><td>openai/gpt-oss-20b</td><td>30</td><td>1000</td><td>8000</td></tr>
          <tr><td>qwen/qwen3.6-27b</td><td>60</td><td>1000</td><td>6000</td></tr>
    `,
    );
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("error");
    expect(res.error).toContain("partial");
    expect(c.isLive()).toBe(false);
    // Frozen snapshot remains the source of truth — no under-reporting.
    expect(c.getCatalogModels().length).toBe(GROQ_CATALOG_SNAPSHOT.length);
    expect(c.normalizeRecord({ name: "openai/gpt-oss-20b" }).availability!.confidence).toBe("likely");
  });

  it("preserves the frozen snapshot when the Free Plan parse fails (no wipe)", async () => {
    const c = new GroqCollector();
    const f = makeFetch({ data: [{ id: "openai/gpt-oss-20b", active: true }] }, `<table><thead><tr><th>MODEL ID</th><th>RPM</th><th>RPD</th><th>TPM</th></tr></thead></table>`);
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("error");
    // Fallback path still yields the bundled snapshot and its free classifications.
    expect(c.getCatalogModels().length).toBe(GROQ_CATALOG_SNAPSHOT.length);
    const frozen = c.normalizeRecord({ name: "openai/gpt-oss-20b" });
    expect(frozen.isFree).toBe(true);
    expect(frozen.availability!.confidence).toBe("likely"); // degraded vs "verified"
  });

  it("activates live mode only on a fully parsed Free Plan table, with verified confidence", async () => {
    const c = new GroqCollector();
    const f = makeFetch(
      { data: [{ id: "openai/gpt-oss-20b", active: true, context_window: 131072 }, { id: "other", active: true }] },
      REAL_STRUCTURE_HTML,
    );
    const res = await c.prepareLive("key", f);
    expect(res.status).toBe("ok");
    expect(c.isLive()).toBe(true);
    expect(c.getCatalogModels().map((m) => m.name)).toContain("openai/gpt-oss-20b");
    const live = c.normalizeRecord({ name: "openai/gpt-oss-20b" });
    expect(live.isFree).toBe(true);
    expect(live.availability!.confidence).toBe("verified"); // upgraded on successful parse
  });
});
