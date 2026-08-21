import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDb, withTransaction } from "@/lib/db";
import { DbCollectorSink } from "@/lib/collectors/dbSink";
import { seedDatabase } from "@/lib/seed";
import { addAvailability } from "@/lib/actions";
import { getAllModels, getAllProviders } from "@/lib/queries";
import type { NormalizedAvailabilityRow } from "@/lib/collectors/openrouter";

// Provide an admin auth header for the server-action tests (mirrors actions-auth.test.ts).
vi.mock("next/headers", () => ({
  headers: () => new Map([["authorization", "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="]]),
}));

const db = getDb();

beforeEach(() => {
  resetDb();
  seedDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function baseAvail(overrides: Partial<NormalizedAvailabilityRow> = {}): NormalizedAvailabilityRow {
  return {
    id: "tx__openrouter",
    modelId: "tx-model",
    providerId: "openrouter",
    accessType: "free_tier",
    status: "available",
    confidence: "likely",
    isFree: true,
    pricingClass: "free_tier",
    free: { isFree: true, pricingClass: "free_tier", accessType: "free_tier", reason: "free tier" },
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    rateLimitRpm: null,
    rateLimitTpm: null,
    dailyLimit: null,
    monthlyLimit: null,
    requiresApiKey: true,
    requiresPaymentMethod: false,
    paymentRequirementKnown: true,
    requiresSignup: true,
    expiresAt: null,
    sourceUrl: "https://example.com",
    sourceType: "official_docs",
    sourceTitle: "Example",
    apiFormat: "openai_chat_completions",
    ...overrides,
  } as NormalizedAvailabilityRow;
}

function count(query: string, param?: string): number {
  const stmt = db.prepare(query);
  const row = param !== undefined ? stmt.get(param) : stmt.get();
  return (row as { c: number }).c;
}

describe("withTransaction helper", () => {
  it("commits all statements on success", () => {
    withTransaction(() => {
      db.exec("INSERT INTO providers (id, name, category, status) VALUES ('p1','P1','direct_api','available')");
      db.exec("INSERT INTO providers (id, name, category, status) VALUES ('p2','P2','direct_api','available')");
    });
    expect(count("SELECT COUNT(*) AS c FROM providers WHERE id IN ('p1','p2')")).toBe(2);
  });

  it("rolls back all statements when the callback throws", () => {
    expect(() =>
      withTransaction(() => {
        db.exec("INSERT INTO providers (id, name, category, status) VALUES ('p3','P3','direct_api','available')");
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(db.prepare("SELECT * FROM providers WHERE id = ?").get("p3")).toBeUndefined();
  });
});

describe("sink upsert atomicity", () => {
  it("new availability route writes availability + change_history + verification_history + source link together", () => {
    const sink = new DbCollectorSink(new Date("2026-08-16T00:00:00Z"));
    const sourceId = sink.ensureSource();
    const a = baseAvail({ id: "ok-route__openrouter" });
    sink.upsertAvailabilityRow(a, sourceId);

    expect(db.prepare("SELECT * FROM availability WHERE id = ?").get(a.id)).toBeTruthy();
    expect(count("SELECT COUNT(*) AS c FROM change_history WHERE entity_id = ?", a.id)).toBe(1);
    expect(count("SELECT COUNT(*) AS c FROM verification_history WHERE availability_id = ?", a.id)).toBe(1);
    expect(count("SELECT COUNT(*) AS c FROM availability_sources WHERE availability_id = ?", a.id)).toBe(1);
  });

  it("mid-operation failure rolls back the availability row (and its history)", () => {
    const sink = new DbCollectorSink(new Date("2026-08-16T00:00:00Z"));
    const sourceId = sink.ensureSource();
    const a = baseAvail({ id: "rollback-route__openrouter" });

    // Force the LAST write inside the transaction to throw, after the availability
    // row has been inserted. If the transaction works, the availability insert
    // must also be undone.
    const spy = vi.spyOn(sink, "linkSource");
    spy.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => sink.upsertAvailabilityRow(a, sourceId)).toThrow("boom");

    expect(db.prepare("SELECT * FROM availability WHERE id = ?").get(a.id)).toBeUndefined();
    expect(count("SELECT COUNT(*) AS c FROM change_history WHERE entity_id = ?", a.id)).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM verification_history WHERE availability_id = ?", a.id)).toBe(0);
  });

  it("one failed model does not roll back a successful sibling", () => {
    const sink = new DbCollectorSink(new Date("2026-08-16T00:00:00Z"));
    const sourceId = sink.ensureSource();
    const aOk = baseAvail({ id: "ok-route__openrouter" });
    const aBad = baseAvail({ id: "bad-route__openrouter" });

    // First linkSource (aOk) succeeds; second linkSource (aBad) throws. Because each
    // upsert runs in its OWN transaction, aOk must stay committed while aBad rolls back.
    const spy = vi.spyOn(sink, "linkSource");
    spy.mockImplementationOnce(() => {});
    spy.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    sink.upsertAvailabilityRow(aOk, sourceId);
    expect(() => sink.upsertAvailabilityRow(aBad, sourceId)).toThrow("boom");

    expect(db.prepare("SELECT * FROM availability WHERE id = ?").get(aOk.id)).toBeTruthy();
    expect(db.prepare("SELECT * FROM availability WHERE id = ?").get(aBad.id)).toBeUndefined();
  });
});

describe("admin addAvailability atomicity", () => {
  it("writes availability and change_history together (composite committed)", async () => {
    const models = getAllModels();
    const providers = getAllProviders();
    const modelId = models[0].id;
    const providerId = providers[0].id;
    const id = `${modelId}__${providerId}`;

    db.prepare("DELETE FROM availability WHERE id = ?").run(id);
    db.prepare("DELETE FROM change_history WHERE entity_id = ?").run(id);

    await addAvailability({
      modelId,
      providerId,
      accessType: "free_tier",
      status: "available",
      sourceUrl: "https://example.com/add",
    });

    const avail = db.prepare("SELECT * FROM availability WHERE id = ?").get(id) as { id: string } | undefined;
    expect(avail).toBeDefined();
    const change = db
      .prepare("SELECT * FROM change_history WHERE entity_id = ? ORDER BY detected_at DESC LIMIT 1")
      .get(id) as { change_source: string } | undefined;
    expect(change).toBeDefined();
    expect(change?.change_source).toBe("admin_add");
  });
});
