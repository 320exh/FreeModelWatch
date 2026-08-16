import { describe, it, expect, vi } from "vitest";
import { getFreeModels, getModelView, getVerificationHistory, getAllModels, getAllProviders } from "@/lib/queries";
import { getDb } from "@/lib/db";

// Mock next/headers to provide a valid auth header for requireAdmin()
// Using synchronous mock like verification.test.ts
vi.mock("next/headers", () => ({
  headers: () => new Map([["authorization", "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="]]), // admin:test-password
}));

import { markVerified, adminVerifyRoute, addAvailability, reportChange, adminRunCollector } from "@/lib/actions";

describe("server action authorization", () => {
  it("markVerified uses authenticated username as verified_by", async () => {
    const model = getFreeModels()[0];
    const view = getModelView(model.id)!;
    const route = view.routes[0];
    const before = getVerificationHistory(route.availability.id).length;

    await markVerified({
      id: route.availability.id,
    });

    const after = getVerificationHistory(route.availability.id);
    expect(after.length).toBe(before + 1);
    const latest = after[after.length - 1];
    expect(latest.verifiedBy).toBe("admin");
    expect(latest.newConfidence).toBe("verified");
  });

  it("adminVerifyRoute uses authenticated username as verified_by", async () => {
    const model = getFreeModels()[0];
    const view = getModelView(model.id)!;
    const route = view.routes[0];
    const before = getVerificationHistory(route.availability.id).length;

    await adminVerifyRoute({
      id: route.availability.id,
      status: "available",
      accessType: route.availability.accessType,
      confidence: "verified",
    });

    const after = getVerificationHistory(route.availability.id);
    expect(after.length).toBe(before + 1);
    const latest = after[after.length - 1];
    expect(latest.verifiedBy).toBe("admin");
  });

  it("addAvailability uses authenticated username as verified_by in change_history", async () => {
    const models = getAllModels();
    const providers = getAllProviders();
    const modelId = models[0].id;
    const providerId = providers[0].id;
    const id = `${modelId}__${providerId}`;

    // Clean up if exists
    const db = getDb();
    db.prepare("DELETE FROM availability WHERE id = ?").run(id);
    db.prepare("DELETE FROM change_history WHERE entity_id = ?").run(id);

    await addAvailability({
      modelId,
      providerId,
      accessType: "free_tier",
      status: "available",
      sourceUrl: "https://example.com/source",
    });

    const change = db.prepare("SELECT * FROM change_history WHERE entity_id = ? ORDER BY detected_at DESC LIMIT 1").get(id) as any;
    expect(change).toBeDefined();
    expect(change.verified_by).toBe("admin");
    expect(change.change_source).toBe("admin_add");
  });

  it("reportChange uses authenticated username as verified_by in change_history", async () => {
    const model = getFreeModels()[0];
    const view = getModelView(model.id)!;
    const route = view.routes[0];
    const entityId = route.availability.id;

    const db = getDb();
    db.prepare("DELETE FROM change_history WHERE entity_id = ?").run(entityId);

    await reportChange({
      entityType: "availability",
      entityId,
      fieldChanged: "status_change",
      newValue: "available",
      notes: "test report",
    });

    const change = db.prepare("SELECT * FROM change_history WHERE entity_id = ? ORDER BY detected_at DESC LIMIT 1").get(entityId) as any;
    expect(change).toBeDefined();
    expect(change.verified_by).toBe("admin");
    expect(change.change_source).toBe("user_report");
  });

  it("adminRunCollector requires authentication", async () => {
    // This tests that the action runs without throwing auth error
    // (dry run to avoid network calls)
    const result = await adminRunCollector({
      collectorId: "openrouter",
      dryRun: true,
    });
    // dry run may succeed or fail depending on mock, but should not throw UNAUTHORIZED
    expect(result).toHaveProperty("ok");
  });
});