import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the collector runs to avoid network calls
vi.mock("@/lib/collectors/run", () => ({
  runOpenRouterCollector: vi.fn().mockResolvedValue({
    status: "success",
    dryRun: true,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    collector: "openrouter",
    modelsDiscovered: 0,
    freeModels: 0,
    newModels: [],
    existingModels: 0,
    changedModels: [],
    newFreeRoutes: [],
    changedFreeRoutes: [],
    reactivatedFreeRoutes: [],
    removedFreeRoutes: [],
    errors: [],
    warnings: [],
    errorMessage: null,
    modelsAdded: 0,
    modelsChanged: 0,
    modelsRemoved: 0,
    freeRoutesAdded: 0,
    freeRoutesRemoved: 0,
  }),
  runGeminiCollector: vi.fn().mockResolvedValue({
    status: "success",
    dryRun: true,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    collector: "gemini",
    modelsDiscovered: 0,
    freeModels: 0,
    newModels: [],
    existingModels: 0,
    changedModels: [],
    newFreeRoutes: [],
    changedFreeRoutes: [],
    reactivatedFreeRoutes: [],
    removedFreeRoutes: [],
    errors: [],
    warnings: [],
    errorMessage: null,
    modelsAdded: 0,
    modelsChanged: 0,
    modelsRemoved: 0,
    freeRoutesAdded: 0,
    freeRoutesRemoved: 0,
  }),
}));

vi.mock("@/lib/queries", () => ({
  getLastCollectorRuns: vi.fn().mockReturnValue([]),
}));

import { verifyBasicAuth, unauthorizedResponse } from "@/lib/auth";

describe("API route authentication", () => {
  const validAuthHeader = "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="; // admin:test-password

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up test auth env
    process.env.ADMIN_USERNAME = "admin";
    const salt = "0123456789abcdef0123456789abcdef";
    const crypto = require("node:crypto");
    const derivedKey = crypto.scryptSync("test-password", salt, 64);
    process.env.ADMIN_PASSWORD_HASH = `${salt}:${derivedKey.toString("hex")}`;
  });

  describe("verifyBasicAuth integration", () => {
    it("accepts valid credentials", async () => {
      const username = await verifyBasicAuth(validAuthHeader);
      expect(username).toBe("admin");
    });

    it("rejects invalid password", async () => {
      const invalidAuth = "Basic YWRtaW46d3Jvbmc="; // admin:wrong
      const username = await verifyBasicAuth(invalidAuth);
      expect(username).toBeNull();
    });

    it("rejects invalid username", async () => {
      const invalidAuth = "Basic d3Jvbmc6dGVzdC1wYXNzd29yZA=="; // wrong:test-password
      const username = await verifyBasicAuth(invalidAuth);
      expect(username).toBeNull();
    });

    it("rejects missing header", async () => {
      const username = await verifyBasicAuth(null);
      expect(username).toBeNull();
    });

    it("rejects non-Basic auth", async () => {
      const username = await verifyBasicAuth("Bearer token123");
      expect(username).toBeNull();
    });
  });

  describe("unauthorizedResponse", () => {
    it("returns 401 with WWW-Authenticate header", () => {
      const response = unauthorizedResponse();
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="FreeModelWatch Admin"');
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });
});

// Note: Full integration tests for the API route handlers would require
// a more complex test setup with NextRequest/NextResponse mocking.
// The unit tests above verify the auth utilities work correctly.
// The middleware and route handlers use these same utilities.