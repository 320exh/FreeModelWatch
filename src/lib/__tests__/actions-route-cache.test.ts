import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as intelligence from "@/lib/intelligence";
import { getFreeModels, getModelView, getAllModels, getAllProviders } from "@/lib/queries";
import { getDb } from "@/lib/db";

// Mock next/headers to provide a valid auth header for requireAdmin()
vi.mock("next/headers", () => ({
  headers: () => new Map([["authorization", "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="]]), // admin:test-password
}));

import { markVerified, adminVerifyRoute, addAvailability, reportChange } from "@/lib/actions";

describe("server-action route-cache invalidation", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(intelligence, "invalidateRouteCache");
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it("markVerified invalidates the route cache on a successful mutation", async () => {
    const model = getFreeModels()[0];
    const route = getModelView(model.id)!.routes[0];
    await markVerified({ id: route.availability.id });
    expect(spy).toHaveBeenCalled();
  });

  it("adminVerifyRoute invalidates the route cache on a successful mutation", async () => {
    const model = getFreeModels()[0];
    const route = getModelView(model.id)!.routes[0];
    await adminVerifyRoute({
      id: route.availability.id,
      status: "available",
      accessType: route.availability.accessType,
      confidence: "verified",
    });
    expect(spy).toHaveBeenCalled();
  });

  it("addAvailability invalidates the route cache on a successful mutation", async () => {
    const modelId = getAllModels()[0].id;
    const providerId = getAllProviders()[0].id;
    const id = `${modelId}__${providerId}`;
    const db = getDb();
    db.prepare("DELETE FROM availability WHERE id = ?").run(id);
    db.prepare("DELETE FROM change_history WHERE entity_id = ?").run(id);

    await addAvailability({ modelId, providerId, accessType: "free_tier", status: "available" });
    expect(spy).toHaveBeenCalled();
  });

  it("reportChange does NOT invalidate the route cache (writes change_history only, not consumed by buildFreeAccessRoutes)", async () => {
    const model = getFreeModels()[0];
    const route = getModelView(model.id)!.routes[0];
    await reportChange({
      entityType: "availability",
      entityId: route.availability.id,
      fieldChanged: "status_change",
      newValue: "available",
      notes: "test report",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("markVerified does NOT invalidate when called with no availability id (guard, not a mutation)", async () => {
    await markVerified({});
    expect(spy).not.toHaveBeenCalled();
  });

  it("adminVerifyRoute does NOT invalidate when the availability id does not exist (failed path)", async () => {
    const result = await adminVerifyRoute({ id: "does-not-exist__missing" });
    expect(result).toHaveProperty("error");
    expect(spy).not.toHaveBeenCalled();
  });

  it("addAvailability does NOT invalidate when modelId is missing (guard, not a mutation)", async () => {
    await addAvailability({ providerId: "google" });
    expect(spy).not.toHaveBeenCalled();
  });
});
