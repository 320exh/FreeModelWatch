import { describe, it, expect, beforeEach, vi } from "vitest";
import { DbCollectorSink } from "@/lib/collectors/dbSink";
import { getDb } from "@/lib/db";
import * as intelligence from "@/lib/intelligence";
import type { NormalizedAvailabilityRow } from "@/lib/collectors/openrouter";

function baseAvail(overrides: Partial<NormalizedAvailabilityRow> = {}): NormalizedAvailabilityRow {
  return {
    id: "test__google",
    modelId: "test",
    providerId: "google",
    accessType: "direct_api",
    status: "available",
    confidence: "likely",
    isFree: true,
    pricingClass: "free_tier",
    free: { isFree: true, pricingClass: "free_tier", accessType: "direct_api", reason: "free tier" },
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    rateLimitRpm: null,
    rateLimitTpm: null,
    dailyLimit: null,
    monthlyLimit: null,
    requiresApiKey: true,
    requiresPaymentMethod: false,
    paymentRequirementKnown: true,
    requiresSignup: true,
    expiresAt: null,
    sourceUrl: "https://example.com",
    sourceType: "official_docs",
    sourceTitle: "Example",
    apiFormat: "gemini",
    ...overrides,
  } as NormalizedAvailabilityRow;
}

function insertRow(values: Record<string, unknown>) {
  const cols = ["id", "model_id", "provider_id", "access_type", "status", "is_active", "data_origin", "verification_confidence", "verification_method", "verified_by", "last_verified_at"];
  const db = getDb();
  db.prepare(`INSERT INTO availability (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(
    ...cols.map((c) => values[c] ?? null)
  );
}

function getRow(id: string) {
  return getDb().prepare("SELECT * FROM availability WHERE id = ?").get(id) as any;
}

describe("DbCollectorSink provenance preservation (Decision 3, §14c)", () => {
  let sink: DbCollectorSink;
  beforeEach(() => {
    sink = new DbCollectorSink(new Date("2026-08-16T00:00:00Z"));
  });

  it("preserves a human-verified (production) row instead of downgrading it", () => {
    insertRow({
      id: "prod__google", model_id: "prod", provider_id: "google", access_type: "free_tier",
      status: "available", is_active: 1, data_origin: "production", verification_confidence: "verified",
      verification_method: "manual", verified_by: "admin", last_verified_at: "2026-01-01",
    });

    sink.upsertAvailabilityRow(baseAvail({ id: "prod__google", modelId: "prod", confidence: "likely" }), "src-x");

    const row = getRow("prod__google");
    expect(row.data_origin).toBe("production");
    expect(row.verification_confidence).toBe("verified");
    expect(row.verification_method).toBe("manual");
    expect(row.verified_by).toBe("admin");
    // Observed facts are still updated.
    expect(row.status).toBe("available");
  });

  it("promotes a seed row to live_collector and keeps the higher confidence", () => {
    insertRow({
      id: "seed__google", model_id: "seed", provider_id: "google", access_type: "free_tier",
      status: "available", is_active: 1, data_origin: "seed", verification_confidence: "verified",
      verification_method: "manual", verified_by: null, last_verified_at: "2026-01-01",
    });

    sink.upsertAvailabilityRow(baseAvail({ id: "seed__google", modelId: "seed", confidence: "likely" }), "src-x");

    const row = getRow("seed__google");
    expect(row.data_origin).toBe("live_collector");
    expect(row.verification_confidence).toBe("verified"); // higher of verified/likely
    expect(row.verification_method).toBe("collector");
  });

  it("upgrades confidence when the collector is more confident than a low seed", () => {
    insertRow({
      id: "low__google", model_id: "low", provider_id: "google", access_type: "free_tier",
      status: "available", is_active: 1, data_origin: "seed", verification_confidence: "unverified",
      verification_method: "manual", verified_by: null, last_verified_at: "2026-01-01",
    });

    sink.upsertAvailabilityRow(baseAvail({ id: "low__google", modelId: "low", confidence: "likely" }), "src-x");

    expect(getRow("low__google").verification_confidence).toBe("likely");
  });

  it("markRemoved preserves production attestation while deactivating", () => {
    insertRow({
      id: "prodrem__google", model_id: "prodrem", provider_id: "google", access_type: "free_tier",
      status: "available", is_active: 1, data_origin: "production", verification_confidence: "verified",
      verification_method: "manual", verified_by: "admin", last_verified_at: "2026-01-01",
    });

    const removed = sink.markRemoved("prodrem__google");
    expect(removed).toBe(true);

    const row = getRow("prodrem__google");
    expect(row.is_active).toBe(0);
    expect(row.status).toBe("unavailable");
    expect(row.data_origin).toBe("production");
    expect(row.verification_method).toBe("manual");
  });

  it("markRemoved keeps live_collector attestation for non-production rows", () => {
    insertRow({
      id: "liverem__google", model_id: "liverem", provider_id: "google", access_type: "free_tier",
      status: "available", is_active: 1, data_origin: "live_collector", verification_confidence: "likely",
      verification_method: "collector", verified_by: null, last_verified_at: "2026-01-01",
    });

    sink.markRemoved("liverem__google");
    expect(getRow("liverem__google").data_origin).toBe("live_collector");
  });

  it("stores a collector-asserted 'verified' confidence on first import", () => {
    sink.upsertAvailabilityRow(baseAvail({ id: "v__google", modelId: "v", confidence: "verified" }), "src-x");
    expect(getRow("v__google").verification_confidence).toBe("verified");
  });
});

describe("DbCollectorSink route-cache invalidation (write path)", () => {
  it("invalidates the derived free-route cache on availability upsert and removal", () => {
    const spy = vi.spyOn(intelligence, "invalidateRouteCache");
    const sink = new DbCollectorSink(new Date("2026-08-16T00:00:00Z"));

    // New availability row -> write path -> cache invalidated.
    sink.upsertAvailabilityRow(baseAvail({ id: "cache__google", modelId: "cache" }), "src-x");
    expect(spy).toHaveBeenCalled();

    spy.mockClear();
    sink.markRemoved("cache__google");
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it("invalidates the cache when a model row is added", () => {
    const spy = vi.spyOn(intelligence, "invalidateRouteCache");
    const sink = new DbCollectorSink(new Date("2026-08-16T00:00:00Z"));
    sink.upsertModelRow({
      id: "cachemodel", name: "Cache Model", providerId: "google", author: "google", family: "x",
      version: null, releaseDate: null, contextWindow: null, maxOutputTokens: null, inputModalities: [],
      outputModalities: [], visionSupport: false, toolCalling: false, structuredOutput: false,
      reasoningSupport: false, isOpenSource: false, description: null, officialPageUrl: null,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
