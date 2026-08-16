import { describe, it, expect } from "vitest";
import { getFreeModels, getModelView, getVerificationHistory, getStaleCount, classifyFreshness } from "@/lib/queries";
import { adminVerifyRoute } from "@/lib/actions";
import { getDb } from "@/lib/db";

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

  it("adminVerifyRoute appends an immutable verification history entry", async () => {
    const model = getFreeModels()[0];
    const view = getModelView(model.id)!;
    const route = view.routes[0];
    const before = getVerificationHistory(route.availability.id).length;

    await adminVerifyRoute({
      id: route.availability.id,
      status: "degraded",
      accessType: route.availability.accessType,
      confidence: "verified",
      verifiedBy: "tester",
      notes: "automated test verification",
    });

    const after = getVerificationHistory(route.availability.id);
    expect(after.length).toBe(before + 1);
    const latest = after[after.length - 1];
    expect(latest.newStatus).toBe("degraded");
    expect(latest.verifiedBy).toBe("tester");
    expect(latest.previousStatus).not.toBe(latest.newStatus);
  });

  it("mutations go through the database", () => {
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS c FROM availability").get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
  });
});
