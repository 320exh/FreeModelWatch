import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

type MiddlewareFn = (req: NextRequest) => Promise<Response>;

let middlewareFn: MiddlewareFn;

async function callMiddleware(pathname: string, opts: {
  ip?: string | null;
  extraHeaders?: Record<string, string>;
  authHeader?: string;
} = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.ip !== undefined && opts.ip !== null) headers["cf-connecting-ip"] = opts.ip;
  if (opts.authHeader) headers["authorization"] = opts.authHeader;
  Object.assign(headers, opts.extraHeaders ?? {});
  const req = new NextRequest(`https://freeai.today${pathname}`, { method: "GET", headers });
  return middlewareFn(req);
}

const PUBLIC_PATHS = [
  "/api/changes",
  "/api/providers",
  "/api/providers/abc123/free-models",
  "/api/models/free",
  "/api/models/abc123",
  "/api/harnesses/abc123/free-models",
];

describe("middleware", () => {
  beforeEach(async () => {
    // Vitest sets NODE_ENV=test itself, which makes RateLimiter.startSweep()
    // a no-op (no dangling timer). Do NOT assign process.env.NODE_ENV here —
    // it is a read-only literal type under the project's tsconfig and the
    // production build type-checks these test files.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    process.env.ADMIN_USERNAME = "admin";
    const salt = "0123456789abcdef0123456789abcdef";
    const derivedKey = crypto.scryptSync("test-password", salt, 64);
    process.env.ADMIN_PASSWORD_HASH = `${salt}:${derivedKey.toString("hex")}`;
    // Import once per test so the module-level limiter is isolated per test
    // but shared across calls within the test (state must accumulate).
    vi.resetModules();
    const mod = await import("@/middleware");
    middlewareFn = mod.middleware;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("allows public requests below the limit", async () => {
    for (let i = 0; i < 50; i++) {
      const res = await callMiddleware("/api/changes", { ip: "203.0.113.7" });
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with JSON body and Retry-After once the limit is exceeded", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 60; i++) {
      expect((await callMiddleware("/api/changes", { ip })).status).toBe(200);
    }
    const rejected = await callMiddleware("/api/changes", { ip });
    expect(rejected.status).toBe(429);
    const body = await rejected.json();
    expect(body).toEqual({ error: "rate limit exceeded", retryAfter: expect.any(Number) });
    expect(typeof rejected.headers.get("Retry-After")).toBe("string");
    expect(Number(rejected.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("shares the limit across all covered public endpoints for the same IP", async () => {
    const ip = "203.0.113.7";
    const paths = [
      "/api/changes",
      "/api/providers",
      "/api/providers/abc/free-models",
      "/api/models/free",
      "/api/models/abc",
      "/api/harnesses/abc/free-models",
    ];
    let count = 0;
    for (const p of paths) {
      for (let i = 0; i < 10; i++) {
        expect((await callMiddleware(p, { ip })).status).toBe(200);
        count++;
      }
    }
    expect(count).toBe(60);
    // The 61st request from the same IP, on any covered endpoint, is limited.
    const blocked = await callMiddleware("/api/changes", { ip });
    expect(blocked.status).toBe(429);
  });

  it("keeps separate client IPs in separate buckets", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await callMiddleware("/api/changes", { ip: "203.0.113.7" })).status).toBe(200);
    }
    expect((await callMiddleware("/api/changes", { ip: "203.0.113.7" })).status).toBe(429);
    expect((await callMiddleware("/api/changes", { ip: "198.51.100.9" })).status).toBe(200);
  });

  it("limits based on CF-Connecting-IP even when X-Forwarded-For is spoofed", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 60; i++) {
      await callMiddleware("/api/changes", { ip, extraHeaders: { "x-forwarded-for": "1.2.3.4" } });
    }
    const blocked = await callMiddleware("/api/changes", { ip, extraHeaders: { "x-forwarded-for": "9.9.9.9" } });
    expect(blocked.status).toBe(429);
  });

  it("trusts ONLY CF-Connecting-IP and fails open when it is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await callMiddleware("/api/changes", {
      ip: null,
      extraHeaders: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" },
    });
    expect(res.status).toBe(200); // fails open, not limited
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not rate-limit excluded admin/verification endpoints", async () => {
    const paths = ["/api/verification-queue", "/api/admin/collect/gemini", "/api/admin/collect/openrouter"];
    for (const p of paths) {
      for (let i = 0; i < 80; i++) {
        const res = await callMiddleware(p, { ip: "203.0.113.7" });
        expect(res.status).toBe(200); // never throttled (auth handles these)
      }
    }
  });

  it("preserves /admin/* authentication (rejects without credentials)", async () => {
    const res = await callMiddleware("/admin/secret", { ip: "203.0.113.7" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="FreeAI.today Admin"');
  });

  it("suppresses WWW-Authenticate for fetch-style requests (router prefetches) so public pages never trigger the native sign-in dialog", async () => {
    const res = await callMiddleware("/admin", {
      ip: "203.0.113.7",
      extraHeaders: { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "rsc": "1" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("still challenges real document navigations (sec-fetch-mode navigate)", async () => {
    const res = await callMiddleware("/admin", {
      ip: "203.0.113.7",
      extraHeaders: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="FreeAI.today Admin"');
  });

  it("still authenticates fetch-style requests when valid credentials are present", async () => {
    const validAuth = "Basic " + Buffer.from("admin:test-password").toString("base64");
    const res = await callMiddleware("/admin", {
      ip: "203.0.113.7",
      authHeader: validAuth,
      extraHeaders: { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-verified-by")).toBe("admin");
  });

  it("preserves /admin/* authentication (accepts valid credentials)", async () => {
    const validAuth = "Basic " + Buffer.from("admin:test-password").toString("base64");
    const res = await callMiddleware("/admin/secret", { ip: "203.0.113.7", authHeader: validAuth });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-verified-by")).toBe("admin");
  });

  it("does not apply rate limiting to admin pages", async () => {
    const validAuth = "Basic " + Buffer.from("admin:test-password").toString("base64");
    for (let i = 0; i < 80; i++) {
      const res = await callMiddleware("/admin/secret", { ip: "203.0.113.7", authHeader: validAuth });
      expect(res.status).toBe(200);
    }
  });

  it("matches the six verified public endpoints (does not error on them)", async () => {
    for (const p of PUBLIC_PATHS) {
      const res = await callMiddleware(p, { ip: "203.0.113.7" });
      expect([200, 429]).toContain(res.status); // within limiter bounds, never 404/500
    }
  });
});
