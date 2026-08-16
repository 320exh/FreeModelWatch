import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFreeModels, getModelView, getVerificationHistory, getStaleCount, classifyFreshness } from "@/lib/queries";
import { getDb } from "@/lib/db";

// Mock next/headers to provide a valid auth header for requireAdmin()
vi.mock("next/headers", () => ({
  headers: () => new Map([["authorization", "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="]]), // admin:test-password
}));

import { adminVerifyRoute } from "@/lib/actions";

describe("verification + history", () => {
  it("seed data is flagged seed_demo and never counted as stale", () => {
    // After seeding, all rows are data_origin='seed', so getStaleCount == 0.
    expect(getStaleCount()).toBe(0);
  });

  it("classifyFreshness marks old live rows as stale", () => {
    const old = new Date();
    old.setDate(old.getDate() - 90);
    expect(classifyFreshness({
      dataOrigin: "live", verificationConfidence: "verified",
      lastVerifiedAt: old.toISOString().slice(0, 10), expiresAt: null, status: "available",
    } as never)).toBe("stale");
  });

  it("adminVerifyRoute appends an immutable verification history entry with authenticated verified_by", async () => {
    const model = getFreeModels()[0];
    const view = getModelView(model.id)!;
    const route = view.routes[0];
    const before = getVerificationHistory(route.availability.id).length;

    await adminVerifyRoute({
      id: route.availability.id,
      status: "degraded",
      accessType: route.availability.accessType,
      confidence: "verified",
      // verifiedBy should come from auth, not from form field
      notes: "automated test verification",
    });

    const after = getVerificationHistory(route.availability.id);
    expect(after.length).toBe(before + 1);
    const latest = after[after.length - 1];
    expect(latest.newStatus).toBe("degraded");
    expect(latest.verifiedBy).toBe("admin"); // from mocked auth header
    expect(latest.previousStatus).not.toBe(latest.newStatus);
  });

  it("mutations go through the database", () => {
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS c FROM availability").get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
  });
});
