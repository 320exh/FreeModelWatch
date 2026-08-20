"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "./db";
import { getAvailability } from "./queries";
import { invalidateRouteCache } from "./intelligence";
import { runOpenRouterCollector, runGeminiCollector, runGroqCollector, type CollectorRunReport } from "./collectors/run";
import { verifyBasicAuth } from "./auth";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function requireAdmin(): Promise<string> {
  const authHeader = (await headers()).get("authorization");
  const username = await verifyBasicAuth(authHeader);
  if (!username) {
    throw new Error("UNAUTHORIZED");
  }
  return username;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function str(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}
function num(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}
function bool(v: unknown): boolean {
  return v === true || v === "on" || v === "1" || v === "true";
}

// Server actions accept either a real FormData (from <form action>) or a plain
// object (from collectors / tests). Normalize both into one shape.
function toFields(formData: FormData | Record<string, any>): Record<string, any> {
  if (formData instanceof FormData) return Object.fromEntries(formData.entries());
  return (formData ?? {}) as Record<string, any>;
}

// revalidatePath requires an active request store; in tests / collectors there is
// none, so swallow the error rather than crash the mutation.
function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* no-op outside a request context */
  }
}

/**
 * NOTE: These are server actions, not authenticated endpoints. Real admin
 * authentication is intentionally NOT implemented yet (see ADMIN_SECURITY in
 * CONTRIBUTING.md / DATA_VERIFICATION.md). When it is, gate every mutating
 * action behind `requireAdmin()` — the database and action signatures already
 * support a `verifiedBy` actor, so no schema rewrite is required.
 */

function recordChange(params: {
  entityType: string;
  entityId: string;
  fieldChanged: string;
  oldValue?: string | null;
  newValue?: string | null;
  changeSource?: string;
  sourceUrl?: string | null;
  notes?: string | null;
  verifiedBy?: string | null;
}) {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO change_history
     (id, entity_type, entity_id, field_changed, old_value, new_value, change_source, source_url, detected_at, verified_at, verified_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid("chg"),
    params.entityType,
    params.entityId,
    params.fieldChanged,
    params.oldValue ?? null,
    params.newValue ?? null,
    params.changeSource ?? "manual",
    params.sourceUrl ?? null,
    today(),
    params.verifiedBy ? today() : null,
    params.verifiedBy ?? null,
    params.notes ?? null
  );
}

function appendVerificationHistory(params: {
  availabilityId: string;
  modelId: string | null;
  providerId: string | null;
  verifiedBy: string | null;
  previousConfidence: string | null;
  previousStatus: string | null;
  newConfidence: string | null;
  newStatus: string | null;
  sourceIds?: string | null;
  notes?: string | null;
}) {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO verification_history
     (id, availability_id, model_id, provider_id, verified_by, verified_at, previous_confidence, previous_status, new_confidence, new_status, source_ids, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid("vh"),
    params.availabilityId,
    params.modelId,
    params.providerId,
    params.verifiedBy ?? null,
    today(),
    params.previousConfidence,
    params.previousStatus,
    params.newConfidence,
    params.newStatus,
    params.sourceIds ?? null,
    params.notes ?? null
  );
}

export async function markVerified(formData: FormData | Record<string, any>) {
  const verifiedBy = await requireAdmin();
  const fields = toFields(formData);
  const availabilityId = str(fields["id"]);
  if (!availabilityId) return;
  const db = getDb();
  const row = db.prepare("SELECT * FROM availability WHERE id = ?").get(availabilityId) as any;
  if (!row) return;

  const prevConfidence = row.verification_confidence;
  const prevStatus = row.status;
  const newStatus = prevStatus === "unavailable" ? "available" : prevStatus;

  db.prepare(
    `UPDATE availability
     SET last_verified_at = ?, verification_confidence = 'verified', verification_method = 'manual',
         data_origin = 'production', status = ?, verified_by = ?
     WHERE id = ?`
  ).run(today(), newStatus, verifiedBy, availabilityId);

  appendVerificationHistory({
    availabilityId,
    modelId: row.model_id,
    providerId: row.provider_id,
    verifiedBy,
    previousConfidence: prevConfidence,
    previousStatus: prevStatus,
    newConfidence: "verified",
    newStatus,
  });
  recordChange({
    entityType: "availability",
    entityId: availabilityId,
    fieldChanged: "verification",
    oldValue: `${prevConfidence}/${prevStatus}`,
    newValue: `verified/${newStatus}`,
    changeSource: "admin_verify",
    verifiedBy,
    notes: "Administratively verified against linked source(s).",
  });

  invalidateRouteCache();
  safeRevalidate("/admin");
  safeRevalidate("/models");
  safeRevalidate(`/models/${row.model_id}`);
}

// Full admin verification of a single availability route: status, limits, confidence, source, notes.
export async function adminVerifyRoute(formData: FormData | Record<string, any>) {
  const verifiedBy = await requireAdmin();
  const fields = toFields(formData);
  const availabilityId = str(fields["id"]);
  if (!availabilityId) return { error: "Missing availability id" };
  const db = getDb();
  const row = db.prepare("SELECT * FROM availability WHERE id = ?").get(availabilityId) as any;
  if (!row) return { error: "Availability not found" };

  const status = str(fields["status"]) || row.status;
  const accessType = str(fields["accessType"]) || row.access_type;
  const confidence = str(fields["confidence"]) || "verified";
  const requiresPaymentMethod = bool(fields["requiresPaymentMethod"]);
  const paymentRequirementKnown = fields["paymentRequirementKnown"] !== undefined ? bool(fields["paymentRequirementKnown"]) : (requiresPaymentMethod ? true : row.payment_requirement_known === 1);
  const freeQuotaValue = num(fields["freeQuotaValue"]);
  const freeQuotaUnit = str(fields["freeQuotaUnit"]) || null;
  const freeQuotaPeriod = str(fields["freeQuotaPeriod"]) || null;
  const sourceUrl = str(fields["sourceUrl"]) || row.source_url;
  const sourceTitle = str(fields["sourceTitle"]) || row.source_title;
  const notes = str(fields["notes"]) || null;
  const expiresAt = str(fields["expiresAt"]) || null;

  const changes: string[] = [];
  if (status !== row.status) changes.push(`status: ${row.status} -> ${status}`);
  if (accessType !== row.access_type) changes.push(`access: ${row.access_type} -> ${accessType}`);
  if (confidence !== row.verification_confidence) changes.push(`confidence: ${row.verification_confidence} -> ${confidence}`);
  if (requiresPaymentMethod !== !!row.requires_payment_method) changes.push(`card: ${!!row.requires_payment_method} -> ${requiresPaymentMethod}`);
  if (paymentRequirementKnown !== (row.payment_requirement_known === 1)) changes.push(`cardKnown: ${!!row.payment_requirement_known} -> ${paymentRequirementKnown}`);

  db.prepare(
    `UPDATE availability
      SET status = ?, access_type = ?, verification_confidence = ?, requires_payment_method = ?, payment_requirement_known = ?,
          free_quota_value = ?, free_quota_unit = ?, free_quota_period = ?, source_url = ?,
          source_title = ?, verification_notes = ?, expires_at = ?, last_verified_at = ?,
          verification_method = 'manual', data_origin = 'production', verified_by = ?
      WHERE id = ?`
    ).run(
      status, accessType, confidence, requiresPaymentMethod ? 1 : 0, paymentRequirementKnown ? 1 : 0, freeQuotaValue, freeQuotaUnit, freeQuotaPeriod,
      sourceUrl || null, sourceTitle || null, notes || null, expiresAt || null, today(), verifiedBy, availabilityId
    );

  // Link any newly supplied source URL as a source for this availability.
  if (sourceUrl) {
    const srcId = `src-${availabilityId}`;
    db.prepare(
      `INSERT OR IGNORE INTO sources (id, url, title, source_type, provider_id, availability_id, date_discovered, date_last_checked, is_verified, reliability, last_checked_at)
       VALUES (?, ?, ?, 'official_docs', ?, ?, ?, ?, 1, 'verified', ?)`
    ).run(srcId, sourceUrl, sourceTitle || sourceUrl, row.provider_id, availabilityId, today(), today(), today());
    db.prepare("INSERT OR IGNORE INTO availability_sources (availability_id, source_id, role) VALUES (?, ?, 'evidence')").run(availabilityId, srcId);
  }

  appendVerificationHistory({
    availabilityId,
    modelId: row.model_id,
    providerId: row.provider_id,
    verifiedBy,
    previousConfidence: row.verification_confidence,
    previousStatus: row.status,
    newConfidence: confidence,
    newStatus: status,
  });

  recordChange({
    entityType: "availability",
    entityId: availabilityId,
    fieldChanged: "verification",
    oldValue: `${row.verification_confidence}/${row.status}`,
    newValue: `${confidence}/${status}`,
    changeSource: "admin_verify",
    sourceUrl: sourceUrl || null,
    verifiedBy,
    notes: changes.length ? changes.join("; ") : "Re-verified (no field changes).",
  });

  invalidateRouteCache();
  safeRevalidate("/admin");
  safeRevalidate("/models");
  safeRevalidate(`/models/${row.model_id}`);
  safeRevalidate(`/providers/${row.provider_id}`);
  return { ok: true };
}

export async function addAvailability(formData: FormData | Record<string, any>) {
  const verifiedBy = await requireAdmin();
  const fields = toFields(formData);
  const modelId = str(fields["modelId"]);
  const providerId = str(fields["providerId"]);
  if (!modelId || !providerId) return;
  const accessType = str(fields["accessType"]) || "free_with_limits";
  const status = str(fields["status"]) || "available";
  const freeQuotaValue = num(fields["freeQuotaValue"]);
  const freeQuotaUnit = str(fields["freeQuotaUnit"]) || null;
  const freeQuotaPeriod = str(fields["freeQuotaPeriod"]) || null;
  const requiresPaymentMethod = bool(fields["requiresPaymentMethod"]);
  const paymentRequirementKnown = fields["paymentRequirementKnown"] !== undefined ? bool(fields["paymentRequirementKnown"]) : requiresPaymentMethod;
  const sourceUrl = str(fields["sourceUrl"]) || null;
  const id = `${modelId}__${providerId}`;
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO availability
     (id, model_id, provider_id, harness_id, access_type, free_quota_value, free_quota_unit, free_quota_period,
       requires_payment_method, payment_requirement_known, requires_api_key, requires_signup, status, is_active, source_url, last_verified_at,
       verification_method, verification_confidence, data_origin, verified_by)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, 1, ?, 1, ?, ?, 'manual', 'likely', 'production', ?)`
  ).run(id, modelId, providerId, accessType, freeQuotaValue, freeQuotaUnit, freeQuotaPeriod, requiresPaymentMethod ? 1 : 0, paymentRequirementKnown ? 1 : 0, status, sourceUrl || null, today(), verifiedBy);

  recordChange({
    entityType: "availability",
    entityId: id,
    fieldChanged: "added",
    newValue: accessType,
    changeSource: "admin_add",
    sourceUrl: sourceUrl || null,
    verifiedBy,
    notes: "Manually added free-access route.",
  });

  invalidateRouteCache();
  safeRevalidate("/admin");
  safeRevalidate("/models");
  safeRevalidate(`/models/${modelId}`);
}

export async function reportChange(formData: FormData | Record<string, any>) {
  const verifiedBy = await requireAdmin();
  const fields = toFields(formData);
  const entityType = str(fields["entityType"]) || "availability";
  const entityId = str(fields["entityId"]);
  const fieldChanged = str(fields["fieldChanged"]) || "status_change";
  const newValue = str(fields["newValue"]);
  const notes = str(fields["notes"]);
  const sourceUrl = str(fields["sourceUrl"]) || null;
  if (!entityId || !newValue) return;

  // Capture the current value as the previous value so history is meaningful.
  let oldValue: string | null = null;
  if (entityType === "availability") {
    const a = getAvailability({}).find((x) => x.id === entityId);
    if (a) oldValue = `${a.status}/${a.accessType}`;
  }

  recordChange({
    entityType,
    entityId,
    fieldChanged,
    oldValue,
    newValue,
    changeSource: "user_report",
    sourceUrl,
    verifiedBy,
    notes,
  });
  safeRevalidate("/admin");
  safeRevalidate("/changes");
}

// ---------------------------------------------------------------------------
// Admin: run the OpenRouter live collector.
//
// This action is protected by requireAdmin(). CLI collector execution
// (npm run collect:openrouter / collect:gemini) bypasses this action entirely
// and calls runOpenRouterCollector / runGeminiCollector directly.
// ---------------------------------------------------------------------------

export async function adminRunCollector(formData: FormData | Record<string, any>): Promise<{ ok: boolean; report?: CollectorRunReport; error?: string }> {
  await requireAdmin();
  const fields = toFields(formData);
  const collectorId = str(fields["collectorId"]) || "openrouter";
  const dryRun = bool(fields["dryRun"]);
  try {
    const report = collectorId === "gemini"
      ? await runGeminiCollector({ dryRun })
      : collectorId === "groq"
        ? await runGroqCollector({ dryRun })
        : await runOpenRouterCollector({ dryRun });
    safeRevalidate("/admin");
    safeRevalidate("/models");
    safeRevalidate("/best");
    safeRevalidate("/providers");
    safeRevalidate("/changes");
    safeRevalidate("/");
    // `ok` reflects the collector's actual outcome, not just that the call
    // completed. A failed/partial run must not be reported as success.
    return { ok: report.status !== "failed", report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
