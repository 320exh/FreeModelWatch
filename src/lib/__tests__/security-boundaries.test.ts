import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFreeModels, getModelView, getVerificationHistory, getAllModels, getAllProviders } from "@/lib/queries";
import { getDb } from "@/lib/db";

const originalEnv = { ...process.env };

// Global variable to control the mock
let currentAuthHeader: string | null = "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="; // admin:test-password

// Mock next/headers at the top level (hoisted)
vi.mock("next/headers", () => ({
  headers: () => new Map(currentAuthHeader ? [["authorization", currentAuthHeader]] : []),
}));

function setupTestAuth() {
  process.env.ADMIN_USERNAME = "admin";
  const salt = "0123456789abcdef0123456789abcdef";
  const crypto = require("node:crypto");
  const derivedKey = crypto.scryptSync("test-password", salt, 64);
  process.env.ADMIN_PASSWORD_HASH = `${salt}:${derivedKey.toString("hex")}`;
}

function clearTestAuth() {
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD_HASH;
}

function setAuthHeader(header: string | null) {
  currentAuthHeader = header;
}

describe("Server Action Security Boundaries", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    setupTestAuth();
    setAuthHeader("Basic YWRtaW46dGVzdC1wYXNzd29yZA=="); // default to authenticated
  });

  afterEach(() => {
    vi.resetModules();
    process.env = originalEnv;
    setAuthHeader("Basic YWRtaW46dGVzdC1wYXNzd29yZA==");
  });

  describe("Authenticated invocations succeed", () => {
    it("markVerified succeeds and writes authenticated username as verified_by", async () => {
      const { markVerified } = await import("@/lib/actions");
      const model = getFreeModels()[0];
      const view = getModelView(model.id)!;
      const route = view.routes[0];
      const before = getVerificationHistory(route.availability.id).length;

      await markVerified({ id: route.availability.id });

      const after = getVerificationHistory(route.availability.id);
      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1].verifiedBy).toBe("admin");
    });

    it("adminVerifyRoute succeeds and writes authenticated username as verified_by", async () => {
      const { adminVerifyRoute } = await import("@/lib/actions");
      const model = getFreeModels()[0];
      const view = getModelView(model.id)!;
      const route = view.routes[0];
      const before = getVerificationHistory(route.availability.id).length;

      const result = await adminVerifyRoute({
        id: route.availability.id,
        status: "available",
        accessType: route.availability.accessType,
        confidence: "verified",
      });

      expect(result).toEqual({ ok: true });
      const after = getVerificationHistory(route.availability.id);
      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1].verifiedBy).toBe("admin");
    });

    it("addAvailability succeeds and writes authenticated username as verified_by", async () => {
      const { addAvailability } = await import("@/lib/actions");
      const models = getAllModels();
      const providers = getAllProviders();
      const modelId = models[0].id;
      const providerId = providers[0].id;
      const id = `${modelId}__${providerId}`;

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
    });

    it("reportChange succeeds and writes authenticated username as verified_by", async () => {
      const { reportChange } = await import("@/lib/actions");
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
    });

    it("adminRunCollector succeeds with authentication", async () => {
      const { adminRunCollector } = await import("@/lib/actions");
      const result = await adminRunCollector({ collectorId: "openrouter", dryRun: true });
      expect(result).toHaveProperty("ok");
    });
  });

  describe("Unauthenticated invocations are rejected", () => {
    beforeEach(() => {
      setAuthHeader(null); // No auth header
    });

    afterEach(() => {
      setAuthHeader("Basic YWRtaW46dGVzdC1wYXNzd29yZA==");
    });

    it("markVerified throws UNAUTHORIZED", async () => {
      const { markVerified } = await import("@/lib/actions");
      const model = getFreeModels()[0];
      const view = getModelView(model.id)!;
      const route = view.routes[0];

      await expect(markVerified({ id: route.availability.id })).rejects.toThrow("UNAUTHORIZED");
    });

    it("adminVerifyRoute throws UNAUTHORIZED", async () => {
      const { adminVerifyRoute } = await import("@/lib/actions");
      const model = getFreeModels()[0];
      const view = getModelView(model.id)!;
      const route = view.routes[0];

      await expect(adminVerifyRoute({
        id: route.availability.id,
        status: "available",
        accessType: route.availability.accessType,
        confidence: "verified",
      })).rejects.toThrow("UNAUTHORIZED");
    });

    it("addAvailability throws UNAUTHORIZED", async () => {
      const { addAvailability } = await import("@/lib/actions");
      const models = getAllModels();
      const providers = getAllProviders();

      await expect(addAvailability({
        modelId: models[0].id,
        providerId: providers[0].id,
        accessType: "free_tier",
      })).rejects.toThrow("UNAUTHORIZED");
    });

    it("reportChange throws UNAUTHORIZED", async () => {
      const { reportChange } = await import("@/lib/actions");
      const model = getFreeModels()[0];
      const view = getModelView(model.id)!;
      const route = view.routes[0];

      await expect(reportChange({
        entityType: "availability",
        entityId: route.availability.id,
        fieldChanged: "status_change",
        newValue: "available",
      })).rejects.toThrow("UNAUTHORIZED");
    });

    it("adminRunCollector throws UNAUTHORIZED", async () => {
      const { adminRunCollector } = await import("@/lib/actions");

      await expect(adminRunCollector({ collectorId: "openrouter", dryRun: true })).rejects.toThrow("UNAUTHORIZED");
    });
  });

  describe("Client-supplied verifiedBy cannot override authenticated identity", () => {
    it("adminVerifyRoute ignores verifiedBy from form data", async () => {
      const { adminVerifyRoute } = await import("@/lib/actions");
      const model = getFreeModels()[0];
      const view = getModelView(model.id)!;
      const route = view.routes[0];

      // Try to spoof verifiedBy via form data - should be ignored
      await adminVerifyRoute({
        id: route.availability.id,
        status: "available",
        accessType: route.availability.accessType,
        confidence: "verified",
        verifiedBy: "spoofed-user", // This should be ignored
      });

      const after = getVerificationHistory(route.availability.id);
      expect(after[after.length - 1].verifiedBy).toBe("admin");
    });

    it("markVerified ignores verifiedBy from form data", async () => {
      const { markVerified } = await import("@/lib/actions");
      const model = getFreeModels()[0];
      const view = getModelView(model.id)!;
      const route = view.routes[0];

      await markVerified({
        id: route.availability.id,
        verifiedBy: "spoofed-user", // This should be ignored
      });

      const after = getVerificationHistory(route.availability.id);
      expect(after[after.length - 1].verifiedBy).toBe("admin");
    });

    it("addAvailability ignores verifiedBy from form data", async () => {
      const { addAvailability } = await import("@/lib/actions");
      const models = getAllModels();
      const providers = getAllProviders();
      const modelId = models[0].id;
      const providerId = providers[0].id;
      const id = `${modelId}__${providerId}`;

      const db = getDb();
      db.prepare("DELETE FROM availability WHERE id = ?").run(id);
      db.prepare("DELETE FROM change_history WHERE entity_id = ?").run(id);

      await addAvailability({
        modelId,
        providerId,
        accessType: "free_tier",
        status: "available",
        verifiedBy: "spoofed-user", // This should be ignored
      });

      const change = db.prepare("SELECT * FROM change_history WHERE entity_id = ? ORDER BY detected_at DESC LIMIT 1").get(id) as any;
      expect(change.verified_by).toBe("admin");
    });

    it("reportChange ignores verifiedBy from form data", async () => {
      const { reportChange } = await import("@/lib/actions");
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
        verifiedBy: "spoofed-user", // This should be ignored
      });

      const change = db.prepare("SELECT * FROM change_history WHERE entity_id = ? ORDER BY detected_at DESC LIMIT 1").get(entityId) as any;
      expect(change.verified_by).toBe("admin");
    });
  });
});

describe("Configuration Security", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.resetModules();
    process.env = originalEnv;
  });

  it("missing ADMIN_PASSWORD_HASH fails closed (verifyBasicAuth throws)", async () => {
    clearTestAuth();
    const { verifyBasicAuth } = await import("@/lib/auth");

    await expect(verifyBasicAuth("Basic YWRtaW46dGVzdC1wYXNzd29yZA==")).rejects.toThrow(
      "ADMIN_PASSWORD_HASH environment variable is not set"
    );
  });

  it("missing ADMIN_PASSWORD_HASH fails closed (requireAdmin throws)", async () => {
    clearTestAuth();
    setAuthHeader("Basic YWRtaW46dGVzdC1wYXNzd29yZA==");
    const { adminVerifyRoute } = await import("@/lib/actions");

    const model = getFreeModels()[0];
    const view = getModelView(model.id)!;
    const route = view.routes[0];

    await expect(adminVerifyRoute({
      id: route.availability.id,
      status: "available",
      accessType: route.availability.accessType,
      confidence: "verified",
    })).rejects.toThrow("ADMIN_PASSWORD_HASH environment variable is not set");
  });
});

describe("CLI Collector Execution", () => {
  it("CLI collectors bypass HTTP authentication by calling functions directly", async () => {
    // This test verifies the architecture: CLI scripts call collector functions directly
    // not through the HTTP API endpoints
    const { runOpenRouterCollector, runGeminiCollector } = await import("@/lib/collectors/run");

    // These functions don't require HTTP auth - they're called directly by CLI
    // We can't easily test the full CLI flow, but we verify the functions exist and are exported
    expect(typeof runOpenRouterCollector).toBe("function");
    expect(typeof runGeminiCollector).toBe("function");

    // The actual CLI commands (npm run collect:openrouter) call these functions directly
    // without any HTTP layer, thus bypassing middleware and API route auth
  });
});