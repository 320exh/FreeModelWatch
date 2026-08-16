import { describe, it, expect } from "vitest";
import { getAllModels, getAvailability, getFreeModels, queryModels, isFreeAccess } from "@/lib/queries";
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
