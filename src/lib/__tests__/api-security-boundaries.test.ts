import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const originalEnv = { ...process.env };

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

const validAuthHeader = "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="; // admin:test-password

function createRequest(overrides: { method?: string; origin?: string; referer?: string; auth?: string } = {}): NextRequest {
  const url = "https://example.com/api/admin/collect/openrouter?dryRun=1";
  const headers = new Headers();
  headers.set("host", "example.com");
  if (overrides.origin) headers.set("origin", overrides.origin);
  if (overrides.referer) headers.set("referer", overrides.referer);
  if (overrides.auth) headers.set("authorization", overrides.auth);
  return new NextRequest(url, { method: overrides.method || "POST", headers });
}

describe("API Route Security Boundaries", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    setupTestAuth();

    // Mock collector runs
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
  });

  afterEach(() => {
    vi.resetModules();
    process.env = originalEnv;
  });

  describe("POST /api/admin/collect/openrouter", () => {
    it("rejects request without credentials (401)", async () => {
      const { POST } = await import("@/app/api/admin/collect/openrouter/route");
      const req = createRequest({ auth: undefined });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects request with invalid credentials (401)", async () => {
      const { POST } = await import("@/app/api/admin/collect/openrouter/route");
      const req = createRequest({ auth: "Basic d3Jvbmc6d3Jvbmc=" }); // wrong:wrong
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects request with valid credentials but missing Origin/Referer (CSRF 403)", async () => {
      const { POST } = await import("@/app/api/admin/collect/openrouter/route");
      const req = createRequest({ auth: validAuthHeader }); // no origin/referer
      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("CSRF");
    });

    it("rejects request with cross-origin Origin header (CSRF 403)", async () => {
      const { POST } = await import("@/app/api/admin/collect/openrouter/route");
      const req = createRequest({
        auth: validAuthHeader,
        origin: "https://evil.com",
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("CSRF");
    });

    it("accepts request with valid credentials and same-origin Origin header", async () => {
      const { POST } = await import("@/app/api/admin/collect/openrouter/route");
      const req = createRequest({
        auth: validAuthHeader,
        origin: "https://example.com",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("accepts request with valid credentials and same-origin Referer header", async () => {
      const { POST } = await import("@/app/api/admin/collect/openrouter/route");
      const req = createRequest({
        auth: validAuthHeader,
        referer: "https://example.com/admin",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("GET request (read-only) works without credentials", async () => {
      const { GET } = await import("@/app/api/admin/collect/openrouter/route");
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/admin/collect/gemini", () => {
    it("rejects request without credentials (401)", async () => {
      const { POST } = await import("@/app/api/admin/collect/gemini/route");
      const req = createRequest({ auth: undefined });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects request with invalid credentials (401)", async () => {
      const { POST } = await import("@/app/api/admin/collect/gemini/route");
      const req = createRequest({ auth: "Basic d3Jvbmc6d3Jvbmc=" });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects request with valid credentials but missing Origin/Referer (CSRF 403)", async () => {
      const { POST } = await import("@/app/api/admin/collect/gemini/route");
      const req = createRequest({ auth: validAuthHeader });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("CSRF");
    });

    it("rejects request with cross-origin Origin header (CSRF 403)", async () => {
      const { POST } = await import("@/app/api/admin/collect/gemini/route");
      const req = createRequest({
        auth: validAuthHeader,
        origin: "https://evil.com",
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("CSRF");
    });

    it("accepts request with valid credentials and same-origin Origin header", async () => {
      const { POST } = await import("@/app/api/admin/collect/gemini/route");
      const req = createRequest({
        auth: validAuthHeader,
        origin: "https://example.com",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("accepts request with valid credentials and same-origin Referer header", async () => {
      const { POST } = await import("@/app/api/admin/collect/gemini/route");
      const req = createRequest({
        auth: validAuthHeader,
        referer: "https://example.com/admin",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("GET request (read-only) works without credentials", async () => {
      const { GET } = await import("@/app/api/admin/collect/gemini/route");
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });
});

describe("Middleware Security Boundaries", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    setupTestAuth();
  });

  afterEach(() => {
    vi.resetModules();
    process.env = originalEnv;
  });

  function createMiddlewareRequest(path: string, authHeader?: string) {
    const url = `https://example.com${path}`;
    const headers = new Headers();
    headers.set("host", "example.com");
    if (authHeader) headers.set("authorization", authHeader);
    return new NextRequest(url, { method: "GET", headers });
  }

  it("/admin without credentials returns 401", async () => {
    const { middleware } = await import("@/middleware");
    const req = createMiddlewareRequest("/admin");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("/admin/ without credentials returns 401", async () => {
    const { middleware } = await import("@/middleware");
    const req = createMiddlewareRequest("/admin/");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("/admin/verify without credentials returns 401", async () => {
    const { middleware } = await import("@/middleware");
    const req = createMiddlewareRequest("/admin/verify");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("/admin/nested/path without credentials returns 401", async () => {
    const { middleware } = await import("@/middleware");
    const req = createMiddlewareRequest("/admin/some/nested/path");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("/admin with valid credentials allows request", async () => {
    const { middleware } = await import("@/middleware");
    const req = createMiddlewareRequest("/admin", validAuthHeader);
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-verified-by")).toBe("admin");
  });

  it("/admin/ with valid credentials allows request", async () => {
    const { middleware } = await import("@/middleware");
    const req = createMiddlewareRequest("/admin/", validAuthHeader);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("/admin with invalid credentials returns 401", async () => {
    const { middleware } = await import("@/middleware");
    const req = createMiddlewareRequest("/admin", "Basic d3Jvbmc6d3Jvbmc=");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("non-admin paths are not affected by middleware matcher", async () => {
    // The middleware matcher is /admin/:path*, so it only runs for /admin* paths
    // When we test the middleware function directly with a non-admin path,
    // it still runs (because we're calling it directly), but in production
    // Next.js only invokes it for matching paths.
    // This test verifies the matcher config is correct.
    const { config } = await import("@/middleware");
    expect(config.matcher).toEqual(["/admin/:path*"]);
  });
});