/**
 * Bounded in-memory sliding-window rate limiter.
 *
 * Single-instance by design. The current deployment is one `next start`
 * process on a single Oracle Always Free VM, so the counter map lives in that
 * process's memory and is NOT shared across instances.
 *
 * If this app is ever run as multiple `next start` processes (horizontal
 * scaling, multiple replicas, or serverless), each instance counts
 * independently: the effective per-client limit multiplies by the instance
 * count, and a client spread across instances is not throttled. To support
 * that scenario, provide a shared `RateLimitStore` implementation (e.g. an
 * Upstash Redis or DatabaseSync-backed store) — no other call-site changes
 * are required. Do NOT add an external dependency here without revisiting
 * this decision with the user.
 */

export interface RateLimitOptions {
  /** Maximum requests allowed per window per client. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum number of distinct clients tracked (bounded memory). */
  maxEntries: number;
  /** Background sweep interval for expired entries (0 disables). */
  sweepIntervalMs: number;
}

export const RATE_LIMIT_OPTIONS: RateLimitOptions = {
  max: 60,
  windowMs: 10_000,
  maxEntries: 10_000,
  sweepIntervalMs: 60_000,
};

export interface RateLimitStore {
  get(ip: string): number[] | undefined;
  set(ip: string, timestamps: number[]): void;
  delete(ip: string): void;
  entries(): IterableIterator<[string, number[]]>;
  readonly size: number;
  clear(): void;
}

export function createMemoryStore(): RateLimitStore {
  const map = new Map<string, number[]>();
  return {
    get: (ip) => map.get(ip),
    set: (ip, timestamps) => {
      // Re-insert to refresh recency for the LRU-style eviction below.
      map.delete(ip);
      map.set(ip, timestamps);
    },
    delete: (ip) => {
      map.delete(ip);
    },
    entries: () => map.entries(),
    get size() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
  };
}

export interface Clock {
  now(): number;
}

export interface RateLimitResult {
  limited: boolean;
  /** Remaining requests in the current window (0 when limited). */
  remaining: number;
  /** Seconds the client should wait before retrying (0 when not limited). */
  retryAfterSec: number;
}

export class RateLimiter {
  private readonly opts: RateLimitOptions;
  private readonly store: RateLimitStore;
  private readonly clock: Clock;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RateLimitOptions = RATE_LIMIT_OPTIONS, store?: RateLimitStore, clock?: Clock) {
    this.opts = opts;
    this.store = store ?? createMemoryStore();
    this.clock = clock ?? { now: () => Date.now() };
  }

  limit(ip: string): RateLimitResult {
    const now = this.clock.now();
    const cutoff = now - this.opts.windowMs;
    const timestamps = (this.store.get(ip) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= this.opts.max) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.opts.windowMs - now) / 1000));
      return { limited: true, remaining: 0, retryAfterSec };
    }

    timestamps.push(now);
    this.persist(ip, timestamps);
    return { limited: false, remaining: this.opts.max - timestamps.length, retryAfterSec: 0 };
  }

  private persist(ip: string, timestamps: number[]): void {
    this.store.set(ip, timestamps);
    if (this.store.size > this.opts.maxEntries) {
      const first = this.store.entries().next().value as [string, number[]] | undefined;
      if (first) this.store.delete(first[0]);
    }
  }

  /** Remove expired entries (and trim stale timestamps). Safe to call often. */
  sweep(): void {
    const now = this.clock.now();
    const cutoff = now - this.opts.windowMs;
    for (const [ip, timestamps] of this.store.entries()) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.store.delete(ip);
        continue;
      }
      const filtered = timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        this.store.delete(ip);
      } else if (filtered.length !== timestamps.length) {
        this.store.set(ip, filtered);
      }
    }
  }

  startSweep(): void {
    if (this.opts.sweepIntervalMs <= 0) return;
    if (typeof setInterval === "undefined") return;
    // Never leave a dangling timer in tests.
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => this.sweep(), this.opts.sweepIntervalMs);
    const t = this.timer as { unref?: () => void } | null;
    if (t && typeof t.unref === "function") t.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Extract the client IP from request headers.
 *
 * The origin is reachable only through Cloudflare (verified on the live
 * server: UFW allows 80/443 solely from Cloudflare ranges, and Caddy
 * terminates TLS before proxying to the Next.js process). Cloudflare sets
 * CF-Connecting-IP to the real client address and X-Forwarded-For to the
 * Cloudflare *edge* address, so ONLY CF-Connecting-IP is trustworthy.
 *
 * This intentionally does NOT fall back to X-Forwarded-For, X-Real-IP, or any
 * other header, and does not rely on a `trustProxy` setting. If the header is
 * absent the caller fails open (see middleware) rather than trusting a spoofed
 * value.
 */
export function extractClientIp(headers: Headers): string | null {
  const value = headers.get("cf-connecting-ip");
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
