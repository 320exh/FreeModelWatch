import { describe, it, expect } from "vitest";
import { getAllModels, getAvailability, getFreeModels, queryModels, isFreeAccess, isRouteFree, getCrossProviderRoutes, freeRoutePriceLabel } from "@/lib/queries";
import { getDb } from "@/lib/db";
import type { Availability } from "@/lib/types";

const av = (over: Partial<Availability>): Availability =>
  ({ id: "x", modelId: "m", providerId: "p", harnessId: null, accessType: "free_tier", freeQuotaValue: null, freeQuotaUnit: null, freeQuotaPeriod: null, rateLimitRpm: null, rateLimitTpm: null, dailyLimit: null, monthlyLimit: null, inputPricePerMillion: null, outputPricePerMillion: null, currency: "USD", requiresApiKey: false, requiresPaymentMethod: false, requiresSignup: false, geographicRestrictions: [], apiFormat: null, customEndpointUrl: null, status: "available", isActive: true, sourceUrl: null, sourceTitle: null, sourceType: null, lastVerifiedAt: null, verificationMethod: null, verificationConfidence: "unverified", verificationNotes: null, ...over }) as Availability;

describe("free-access classification", () => {
  it("only returns free routes from getAvailability filtered by isFreeAccess", () => {
    const all = getAvailability({});
    const free = all.filter(isFreeAccess);
    expect(free.length).toBeGreaterThan(0);
    for (const a of free) {
      expect(isFreeAccess(a)).toBe(true);
    }
  });

  it("treats paid/limited/unavailable as not free", () => {
    expect(isFreeAccess(av({ accessType: "free_tier", status: "available" }))).toBe(true);
    expect(isFreeAccess(av({ accessType: "free_with_limits", status: "limited" }))).toBe(true);
    expect(isFreeAccess(av({ accessType: "free_credits", status: "available" }))).toBe(true);
    expect(isFreeAccess(av({ accessType: "free_tier", status: "unavailable" }))).toBe(false);
    expect(isFreeAccess(av({ accessType: "community_unofficial", status: "unavailable" }))).toBe(false);
  });

  it("getFreeModels returns models that have at least one free route", () => {
    const freeModels = getFreeModels();
    const allModels = getAllModels();
    expect(freeModels.length).toBeGreaterThan(0);
    expect(freeModels.length).toBeLessThanOrEqual(allModels.length);
  });

  it("queryModels honors access filter", () => {
    const filtered = queryModels({ access: ["completely_free"] });
    for (const m of filtered) {
      expect(m.routes.some((r) => r.availability.accessType === "completely_free")).toBe(true);
    }
  });

  it("queryModels honors verified filter", () => {
    const verified = queryModels({ verified: ["verified"] });
    for (const m of verified) {
      expect(m.routes.some((r) => r.availability.verificationConfidence === "verified")).toBe(true);
    }
  });
});

describe("M4: canonical free-access classification (isRouteFree + freeRoutePriceLabel)", () => {
  it("free_local with null prices is free (not Paid)", () => {
    expect(isRouteFree("free_local", null, null)).toBe(true);
    expect(freeRoutePriceLabel("free_local", null, null)).toBe("Free $0");
  });

  it("completely_free with null prices is free (no $null/M)", () => {
    expect(isRouteFree("completely_free", null, null)).toBe(true);
    expect(freeRoutePriceLabel("completely_free", null, null)).toBe("Free $0");
  });

  it("paid route (non-free access type with price) is Paid", () => {
    expect(isRouteFree("community_unofficial", 2, 2)).toBe(false);
    expect(freeRoutePriceLabel("community_unofficial", 2, 2)).toBe("Paid");
  });

  it("genuinely priced free route preserves $X/M in display", () => {
    expect(isRouteFree("free_tier", 0.5, 0.5)).toBe(true);
    expect(freeRoutePriceLabel("free_tier", 0.5, 0.5)).toBe("$0.5/M in");
  });

  it("getCrossProviderRoutes classifies a free_local + null-price row as free", () => {
    const row = (getDb().prepare("SELECT id, provider_id FROM models LIMIT 1").get()) as {
      id: string;
      provider_id: string;
    };
    const availabilityId = `m4test__${row.id}`;
    getDb()
      .prepare(
        `INSERT INTO availability (id, model_id, provider_id, access_type, status, requires_payment_method, requires_api_key, requires_signup, source_url, source_title, source_type, data_origin, last_verified_at, verification_confidence)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        availabilityId,
        row.id,
        row.provider_id,
        "free_local",
        "available",
        0,
        0,
        0,
        "https://example.com/m4",
        "m4",
        "other",
        "live",
        new Date().toISOString().slice(0, 10),
        "verified",
      );
    const routes = getCrossProviderRoutes(row.id);
    const r = routes.find((x) => x.availabilityId === availabilityId);
    expect(r).toBeDefined();
    expect(r!.isFree).toBe(true);
  });
});
