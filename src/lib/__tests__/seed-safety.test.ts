import { describe, it, expect, beforeEach } from "vitest";
import { getDb, resetDb, isSeeded } from "../db";
import { seedDatabase } from "../seed";
import { ensureSeeded } from "../queries";

const db = getDb();

// Deterministic baseline: start every test from a freshly reset + seeded DB.
beforeEach(() => {
  resetDb();
  seedDatabase();
});

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

describe("seedDatabase is non-destructive (H1)", () => {
  it("preserves pre-existing non-seed availability rows", () => {
    db.prepare(
      "INSERT INTO availability (id, model_id, provider_id, access_type, status, is_active, data_origin) VALUES (?,?,?,?,?,?,?)"
    ).run("prod-avail-1", "some-model", "some-provider", "free_tier", "available", 1, "production");

    seedDatabase();

    const row = db.prepare("SELECT id FROM availability WHERE id = ?").get("prod-avail-1");
    expect(row, "pre-existing availability row must survive seedDatabase()").toBeTruthy();
  });

  it("preserves pre-existing verification_history rows", () => {
    db.prepare(
      "INSERT INTO verification_history (id, availability_id, verified_at, new_confidence, new_status, source_ids) VALUES (?,?,?,?,?,?)"
    ).run("prod-verif-1", "prod-avail-1", "2026-01-01", "verified", "available", "[]");

    seedDatabase();

    const row = db.prepare("SELECT id FROM verification_history WHERE id = ?").get("prod-verif-1");
    expect(row, "pre-existing verification_history row must survive seedDatabase()").toBeTruthy();
  });

  it("preserves pre-existing change_history rows", () => {
    db.prepare(
      "INSERT INTO change_history (id, entity_type, entity_id, field_changed, old_value, new_value, change_source) VALUES (?,?,?,?,?,?,?)"
    ).run("prod-chg-1", "availability", "prod-avail-1", "added", null, "free_tier", "manual");

    seedDatabase();

    const row = db.prepare("SELECT id FROM change_history WHERE id = ?").get("prod-chg-1");
    expect(row, "pre-existing change_history row must survive seedDatabase()").toBeTruthy();
  });

  it("still inserts seed rows", () => {
    expect(count("models")).toBeGreaterThan(0);
    const seedModel = db.prepare("SELECT id FROM models WHERE id = ?").get("gpt-4o-mini");
    expect(seedModel, "seed model gpt-4o-mini must be present").toBeTruthy();
    expect(count("providers")).toBeGreaterThan(0);
    expect(count("availability")).toBeGreaterThan(0);
  });
});

describe("ensureSeeded cannot wipe data (H1)", () => {
  it("does not wipe pre-existing availability when models table is empty", () => {
    db.prepare(
      "INSERT INTO availability (id, model_id, provider_id, access_type, status, is_active, data_origin) VALUES (?,?,?,?,?,?,?)"
    ).run("prod-avail-2", "m2", "p2", "free_tier", "available", 1, "production");

    // Simulate the trigger condition: models empty but other data present.
    db.exec("DELETE FROM models");
    expect(isSeeded(), "isSeeded() must be false when models is empty").toBe(false);

    ensureSeeded();

    const prod = db.prepare("SELECT id FROM availability WHERE id = ?").get("prod-avail-2");
    expect(prod, "pre-existing availability must survive ensureSeeded() even with empty models").toBeTruthy();
    expect(count("models")).toBeGreaterThan(0);
  });
});

describe("seeding idempotency (H1)", () => {
  it("repeated seeding does not duplicate seed data", () => {
    const modelsBefore = count("models");
    const availBefore = count("availability");
    expect(modelsBefore).toBeGreaterThan(0);

    ensureSeeded();
    ensureSeeded();
    seedDatabase(); // via the public name-equivalent path
    seedDatabase();

    expect(count("models"), "models count must not grow on re-seed").toBe(modelsBefore);
    expect(count("availability"), "availability count must not grow on re-seed").toBe(availBefore);
  });
});
