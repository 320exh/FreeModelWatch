import { describe, it, expect, vi } from "vitest";
import { RateLimiter, createMemoryStore, extractClientIp, RATE_LIMIT_OPTIONS } from "@/lib/rate-limit";

function headersWith(...entries: [string, string][]): Headers {
  const h = new Headers();
  for (const [k, v] of entries) h.set(k, v);
  return h;
}

describe("RateLimiter (sliding window)", () => {
  it("allows requests below the limit", () => {
    const store = createMemoryStore();
    const clock = { now: () => 1_000_000 };
    const limiter = new RateLimiter({ max: 5, windowMs: 10_000, maxEntries: 100, sweepIntervalMs: 0 }, store, clock);
    for (let i = 0; i < 5; i++) {
      expect(limiter.limit("1.2.3.4").limited).toBe(false);
    }
  });

  it("blocks the (max + 1)-th request and reports Retry-After", () => {
    const store = createMemoryStore();
    const clock = { now: () => 1_000_000 };
    const limiter = new RateLimiter({ max: 5, windowMs: 10_000, maxEntries: 100, sweepIntervalMs: 0 }, store, clock);
    for (let i = 0; i < 5; i++) limiter.limit("1.2.3.4");
    const res = limiter.limit("1.2.3.4");
    expect(res.limited).toBe(true);
    expect(res.remaining).toBe(0);
    // Oldest timestamp 1_000_000; window ends at 1_010_000; now 1_000_000 -> 10s.
    expect(res.retryAfterSec).toBe(10);
  });

  it("returns 429 Retry-After of at least 1 second", () => {
    const store = createMemoryStore();
    const clock = { now: () => 1_009_900 };
    const limiter = new RateLimiter({ max: 1, windowMs: 10_000, maxEntries: 100, sweepIntervalMs: 0 }, store, clock);
    limiter.limit("1.2.3.4");
    const res = limiter.limit("1.2.3.4");
    expect(res.limited).toBe(true);
    expect(res.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("resets after the window expires (sliding window)", () => {
    const store = createMemoryStore();
    let t = 1_000_000;
    const clock = { now: () => t };
    const limiter = new RateLimiter({ max: 2, windowMs: 10_000, maxEntries: 100, sweepIntervalMs: 0 }, store, clock);
    expect(limiter.limit("1.2.3.4").limited).toBe(false);
    expect(limiter.limit("1.2.3.4").limited).toBe(false);
    expect(limiter.limit("1.2.3.4").limited).toBe(true); // limited at t=1_000_000

    t = 1_005_000; // 5s later: oldest request still in window -> still limited
    expect(limiter.limit("1.2.3.4").limited).toBe(true);

    t = 1_010_001; // 10s+ after the first request: window slides, allowed again
    expect(limiter.limit("1.2.3.4").limited).toBe(false);
  });

  it("tracks clients in separate buckets", () => {
    const store = createMemoryStore();
    const clock = { now: () => 1_000_000 };
    const limiter = new RateLimiter({ max: 2, windowMs: 10_000, maxEntries: 100, sweepIntervalMs: 0 }, store, clock);
    limiter.limit("1.1.1.1");
    limiter.limit("1.1.1.1");
    expect(limiter.limit("1.1.1.1").limited).toBe(true);
    expect(limiter.limit("2.2.2.2").limited).toBe(false);
    expect(limiter.limit("2.2.2.2").limited).toBe(false);
    expect(limiter.limit("2.2.2.2").limited).toBe(true);
  });

  it("evicts LRU entries beyond maxEntries", () => {
    const store = createMemoryStore();
    const clock = { now: () => 1_000_000 };
    const limiter = new RateLimiter({ max: 1, windowMs: 10_000, maxEntries: 3, sweepIntervalMs: 0 }, store, clock);
    for (let i = 0; i < 10; i++) {
      limiter.limit(`10.0.0.${i}`);
    }
    expect(store.size).toBeLessThanOrEqual(3);
  });

  it("sweep removes expired entries and trims stale timestamps", () => {
    const store = createMemoryStore();
    let t = 1_000_000;
    const clock = { now: () => t };
    const limiter = new RateLimiter({ max: 100, windowMs: 10_000, maxEntries: 1000, sweepIntervalMs: 0 }, store, clock);
    limiter.limit("a"); // at t=1_000_000
    limiter.limit("b"); // at t=1_000_000
    expect(store.size).toBe(2);

    t = 2_000_000; // well past the window
    limiter.sweep();
    expect(store.size).toBe(0);

    // partially expired: 2 old (1_000_000) + 1 fresh (1_005_000)
    t = 1_000_000;
    limiter.limit("c");
    limiter.limit("c");
    t = 1_005_000;
    limiter.limit("c"); // fresh
    expect((store.get("c") ?? []).length).toBe(3);
    // advance past the window of the two oldest entries (>=10s old)
    t = 1_010_001;
    limiter.sweep();
    expect((store.get("c") ?? []).length).toBe(1); // only the 1_005_000 timestamp remains
  });

  it("uses the default options (60 req / 10s)", () => {
    expect(RATE_LIMIT_OPTIONS.max).toBe(60);
    expect(RATE_LIMIT_OPTIONS.windowMs).toBe(10_000);
  });

  it("startSweep does not leak a timer in the test environment", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const limiter = new RateLimiter(RATE_LIMIT_OPTIONS, createMemoryStore());
    limiter.startSweep();
    if (process.env.NODE_ENV === "test") {
      expect(spy).not.toHaveBeenCalled();
    }
    limiter.stop();
    spy.mockRestore();
  });
});

describe("extractClientIp", () => {
  it("returns CF-Connecting-IP exclusively", () => {
    const h = headersWith(
      ["cf-connecting-ip", "203.0.113.7"],
      ["x-forwarded-for", "198.51.100.9"],
      ["x-real-ip", "192.0.2.4"]
    );
    expect(extractClientIp(h)).toBe("203.0.113.7");
  });

  it("returns the trimmed value", () => {
    expect(extractClientIp(headersWith(["cf-connecting-ip", "  203.0.113.7  "]))).toBe("203.0.113.7");
  });

  it("returns null when CF-Connecting-IP is absent (fails open)", () => {
    const h = headersWith(["x-forwarded-for", "198.51.100.9"]);
    expect(extractClientIp(h)).toBeNull();
  });

  it("returns null for an empty CF-Connecting-IP", () => {
    expect(extractClientIp(headersWith(["cf-connecting-ip", ""]))).toBeNull();
  });
});
