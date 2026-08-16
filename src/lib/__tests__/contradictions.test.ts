import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { detectContradictions } from "@/lib/queries";

describe("contradiction detection", () => {
  it("flags two conflicting verified access types from the same provider for the same model", () => {
    const db = getDb();
    const row = db.prepare("SELECT id, provider_id FROM models LIMIT 1").get() as { id: string; provider_id: string };
    const modelId = row.id;
    const providerId = row.provider_id;

    // Insert a second, conflicting verified availability for the same model+provider.
    db.prepare(
      `INSERT INTO availability (id, model_id, provider_id, access_type, status, free_quota_value, free_quota_unit, free_quota_period, requires_payment_method, requires_api_key, requires_signup, source_url, source_title, source_type, data_origin, last_verified_at, verification_confidence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      `conflict__${modelId}`, modelId, providerId,
      "completely_free", "available", null, null, null, 0, 1, 1,
      "https://example.com/x", "x", "other",
      "live", new Date().toISOString().slice(0, 10), "verified"
    );

    const issues = detectContradictions();
    expect(issues.some((i) => i.code === "same_provider_conflicting_access")).toBe(true);
  });
});
