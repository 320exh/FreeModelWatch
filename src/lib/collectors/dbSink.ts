import { getDb, withTransaction } from "../db";
import {
  OPENROUTER_PROVIDER_ID,
  OPENROUTER_SOURCE_ID,
  OPENROUTER_SOURCE_URL,
  type NormalizedModelRow,
  type NormalizedAvailabilityRow,
} from "./openrouter";
import {
  GEMINI_PROVIDER_ID,
  GEMINI_SOURCE_CATALOG_ID,
  GEMINI_SOURCE_CATALOG_URL,
  GEMINI_SOURCE_PRICING_ID,
  GEMINI_SOURCE_PRICING_URL,
  GEMINI_SOURCE_RATELIMITS_ID,
  GEMINI_SOURCE_RATELIMITS_URL,
  GEMINI_SOURCE_BILLING_ID,
  GEMINI_SOURCE_BILLING_URL,
} from "./gemini";
import {
  GROQ_PROVIDER_ID,
  GROQ_SOURCE_MODELS_ID,
  GROQ_SOURCE_MODELS_URL,
  GROQ_SOURCE_PRICING_ID,
  GROQ_SOURCE_PRICING_URL,
  GROQ_SOURCE_RATELIMITS_ID,
  GROQ_SOURCE_RATELIMITS_URL,
} from "./groq";
import type { CollectorSink, NormalizedAvailability, CollectorResult } from "./types";
import type { VerificationConfidence, CollectionMode } from "../types";
import { invalidateRouteCache } from "../intelligence";

function j(v: unknown): string | null {
  if (v == null || (Array.isArray(v) && v.length === 0)) return null;
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function bool(v: boolean | null | undefined): number {
  return v ? 1 : 0;
}

// Confidence ordering for provenance preservation (Decision 3, §14c): a collector
// must never downgrade an existing human-attested confidence.
const CONF_RANK: Record<string, number> = { verified: 4, likely: 3, unverified: 2, stale: 1 };
function maxConfidence(a: string, b: string): string {
  return (CONF_RANK[a] ?? 0) >= (CONF_RANK[b] ?? 0) ? a : b;
}

/**
 * The ONLY place collector output is written to the database. Implements the
 * shared `CollectorSink` contract (so the generic orchestrator still works)
 * and exposes richer, provider-aware upserts used by `runOpenRouterCollector`.
 *
 * Every write:
 *   - stamps `data_origin = 'live_collector'` for seed/live rows, but PRESERVES an
 *     existing `production` (admin-verified) `data_origin` and `verified_by`
 *   - sets `verification_confidence` to the HIGHER of the existing and collector
 *     confidence (never downgrades a human-verified `verified` to auto `likely`)
 *   - refreshes `last_verified_at` = today (the live "last checked" timestamp)
 *   - appends `verification_history` + `change_history` ONLY when something
 *     actually changed (so repeated runs are idempotent — no duplicates, no
 *     spurious history rows)
 *   - links every free route to the canonical OpenRouter API source
 *   - on disappearance, marks the route removed/unavailable rather than deleting
 */
export class DbCollectorSink implements CollectorSink {
  private readonly now: Date;
  private readonly today: string;
  private readonly nowIso: string;

  constructor(now: Date = new Date()) {
    this.now = now;
    this.today = now.toISOString().slice(0, 10);
    this.nowIso = now.toISOString();
  }

  private uid(prefix: string): string {
    return `${prefix}-${this.now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private recordChange(params: {
    entityType: string;
    entityId: string;
    fieldChanged: string;
    oldValue?: string | null;
    newValue?: string | null;
    changeSource?: string;
    sourceUrl?: string | null;
    notes?: string | null;
    verifiedBy?: string | null;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO change_history
       (id, entity_type, entity_id, field_changed, old_value, new_value, change_source, source_url, detected_at, verified_at, verified_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      this.uid("chg"),
      params.entityType,
      params.entityId,
      params.fieldChanged,
      params.oldValue ?? null,
      params.newValue ?? null,
      params.changeSource ?? "automated",
      params.sourceUrl ?? null,
      this.today,
      params.verifiedBy ? this.today : null,
      params.verifiedBy ?? null,
      params.notes ?? null
    );
  }

  private appendVerificationHistory(params: {
    availabilityId: string;
    modelId: string | null;
    providerId: string | null;
    verifiedBy: string | null;
    previousConf?: string | null;
    previousStatus?: string | null;
    newConf?: string | null;
    newStatus?: string | null;
    notes?: string | null;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO verification_history
       (id, availability_id, model_id, provider_id, verified_by, verified_at, previous_confidence, previous_status, new_confidence, new_status, source_ids, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      this.uid("vh"),
      params.availabilityId,
      params.modelId,
      params.providerId,
      params.verifiedBy,
      this.today,
      params.previousConf ?? null,
      params.previousStatus ?? null,
      params.newConf ?? null,
      params.newStatus ?? null,
      null,
      params.notes ?? null
    );
  }

  ensureProvider(): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO providers
       (id, name, category, website_url, api_docs_url, pricing_url, has_free_tier,
        requires_payment_method, requires_signup, status, data_origin, verification_confidence, last_verified_at)
       VALUES (?, 'OpenRouter', 'aggregator', 'https://openrouter.ai', 'https://openrouter.ai/docs',
        'https://openrouter.ai/models', 1, 0, 1, 'available', 'live_collector', 'likely', ?)`
    ).run(OPENROUTER_PROVIDER_ID, this.today);
    db.prepare(
      `UPDATE providers SET name='OpenRouter', category='aggregator', website_url='https://openrouter.ai',
        api_docs_url='https://openrouter.ai/docs', pricing_url='https://openrouter.ai/models',
        has_free_tier=1, requires_payment_method=0, requires_signup=1, status='available',
        data_origin='live_collector', verification_confidence='likely', last_verified_at=?
       WHERE id=?`
    ).run(this.today, OPENROUTER_PROVIDER_ID);
  }

  ensureSource(): string {
    const db = getDb();
    db.prepare(
      `INSERT INTO sources
        (id, url, title, source_type, provider_id, is_verified, reliability, date_last_checked, last_checked_at, notes)
       VALUES (?, ?, 'OpenRouter Models API', 'official_docs', ?, 1, 'verified', ?, ?,
        'Authoritative live catalog used by the OpenRouter collector (GET /api/v1/models).')
       ON CONFLICT(url) DO UPDATE SET last_checked_at=excluded.last_checked_at, date_last_checked=excluded.date_last_checked`
    ).run(OPENROUTER_SOURCE_ID, OPENROUTER_SOURCE_URL, OPENROUTER_PROVIDER_ID, this.today, this.today);
    return OPENROUTER_SOURCE_ID;
  }

  linkSource(availabilityId: string, sourceId: string): void {
    const db = getDb();
    db.prepare(
      "INSERT OR IGNORE INTO availability_sources (availability_id, source_id, role) VALUES (?, ?, 'evidence')"
    ).run(availabilityId, sourceId);
  }

  linkSources(availabilityId: string, sourceIds: string[]): void {
    for (const sid of sourceIds) this.linkSource(availabilityId, sid);
  }

  ensureGeminiProvider(): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO providers
        (id, name, category, website_url, api_docs_url, pricing_url, has_free_tier,
         requires_payment_method, requires_signup, status, data_origin, verification_confidence, last_verified_at)
        VALUES (?, 'Google Gemini / AI Studio', 'direct_api', 'https://aistudio.google.com', 'https://ai.google.dev/gemini-api/docs',
         'https://ai.google.dev/gemini-api/docs/pricing', 1, 0, 1, 'available', 'live_collector', 'likely', ?)`
    ).run(GEMINI_PROVIDER_ID, this.today);
    db.prepare(
      `UPDATE providers SET name='Google Gemini / AI Studio', category='direct_api', website_url='https://aistudio.google.com',
        api_docs_url='https://ai.google.dev/gemini-api/docs', pricing_url='https://ai.google.dev/gemini-api/docs/pricing',
        has_free_tier=1, requires_payment_method=0, requires_signup=1, status='available',
        data_origin='live_collector', verification_confidence='likely', last_verified_at=?
       WHERE id=?`
    ).run(this.today, GEMINI_PROVIDER_ID);
  }

  ensureGeminiSources(): [string, string, string, string] {
    const db = getDb();
    const ensure = (id: string, url: string, title: string, notes: string) => {
      db.prepare(
        `INSERT INTO sources
          (id, url, title, source_type, provider_id, is_verified, reliability, date_last_checked, last_checked_at, notes)
         VALUES (?, ?, ?, 'official_docs', ?, 1, 'verified', ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET last_checked_at=excluded.last_checked_at, date_last_checked=excluded.date_last_checked`
      ).run(id, url, title, GEMINI_PROVIDER_ID, this.today, this.today, notes);
    };
    ensure(GEMINI_SOURCE_CATALOG_ID, GEMINI_SOURCE_CATALOG_URL, "Gemini API — Models", "Authoritative model list (GET /v1beta/models).");
    ensure(GEMINI_SOURCE_PRICING_ID, GEMINI_SOURCE_PRICING_URL, "Gemini API — Pricing", "Authoritative free-of-charge tier pricing.");
    ensure(GEMINI_SOURCE_RATELIMITS_ID, GEMINI_SOURCE_RATELIMITS_URL, "Gemini API — Rate limits", "Per-model token-rate limits; RPM/RPD are dynamic per usage tier.");
    ensure(GEMINI_SOURCE_BILLING_ID, GEMINI_SOURCE_BILLING_URL, "Gemini API — Billing", "Free tier requires no credit card.");
    return [GEMINI_SOURCE_CATALOG_ID, GEMINI_SOURCE_PRICING_ID, GEMINI_SOURCE_RATELIMITS_ID, GEMINI_SOURCE_BILLING_ID];
  }

  ensureGroqProvider(): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO providers
        (id, name, category, website_url, api_docs_url, pricing_url, has_free_tier,
         requires_payment_method, requires_signup, status, data_origin, verification_confidence, last_verified_at)
        VALUES (?, 'Groq', 'direct_api', 'https://groq.com', 'https://console.groq.com/docs',
         'https://groq.com/pricing', 1, 0, 1, 'available', 'live_collector', 'likely', ?)`
    ).run(GROQ_PROVIDER_ID, this.today);
    db.prepare(
      `UPDATE providers SET name='Groq', category='direct_api', website_url='https://groq.com',
        api_docs_url='https://console.groq.com/docs', pricing_url='https://groq.com/pricing',
        has_free_tier=1, requires_payment_method=0, requires_signup=1, status='available',
        data_origin='live_collector', verification_confidence='likely', last_verified_at=?
       WHERE id=?`
    ).run(this.today, GROQ_PROVIDER_ID);
  }

  ensureGroqSources(): [string, string, string] {
    const db = getDb();
    const ensure = (id: string, url: string, title: string, notes: string) => {
      db.prepare(
        `INSERT INTO sources
          (id, url, title, source_type, provider_id, is_verified, reliability, date_last_checked, last_checked_at, notes)
         VALUES (?, ?, ?, 'official_docs', ?, 1, 'verified', ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET last_checked_at=excluded.last_checked_at, date_last_checked=excluded.date_last_checked`
      ).run(id, url, title, GROQ_PROVIDER_ID, this.today, this.today, notes);
    };
    ensure(GROQ_SOURCE_MODELS_ID, GROQ_SOURCE_MODELS_URL, "Groq — Models", "Authoritative model list (https://console.groq.com/docs/models).");
    ensure(GROQ_SOURCE_PRICING_ID, GROQ_SOURCE_PRICING_URL, "Groq — Pricing", "Authoritative free-tier / paid pricing.");
    ensure(GROQ_SOURCE_RATELIMITS_ID, GROQ_SOURCE_RATELIMITS_URL, "Groq — Rate limits", "Per-model free-tier rate limits (RPM/TPM/RPD).");
    return [GROQ_SOURCE_MODELS_ID, GROQ_SOURCE_PRICING_ID, GROQ_SOURCE_RATELIMITS_ID];
  }

  upsertModelRow(
    m: NormalizedModelRow,
    opts?: { sourceUrl?: string; sourceNotes?: string }
  ): { added: boolean; changed: boolean; changedFields: string[] } {
    return withTransaction(() => {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM models WHERE id = ?").get(m.id) as any;
    if (!existing) {
      const cols = [
        "id", "name", "provider_id", "family", "version", "release_date", "context_window", "max_output_tokens",
        "input_modalities", "output_modalities", "vision_support", "tool_calling", "structured_output",
        "reasoning_support", "coding_capability", "is_open_source", "license", "official_page_url", "documentation_url", "description",
      ];
      const params = [
        m.id, m.name, m.providerId, m.family, m.version, m.releaseDate, m.contextWindow, m.maxOutputTokens,
        j(m.inputModalities), j(m.outputModalities), bool(m.visionSupport), bool(m.toolCalling),
        bool(m.structuredOutput), bool(m.reasoningSupport), null, bool(m.isOpenSource), null,
        m.officialPageUrl, null, m.description,
      ];
      db.prepare(`INSERT INTO models (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...params);
      invalidateRouteCache();
      return { added: true, changed: false, changedFields: [] };
    }

    const changes: string[] = [];
    const modelProp = (field: string): string => {
      const map: Record<string, string> = {
        context_window: "contextWindow",
        input_modalities: "inputModalities",
        output_modalities: "outputModalities",
        vision_support: "visionSupport",
        tool_calling: "toolCalling",
        structured_output: "structuredOutput",
        reasoning_support: "reasoningSupport",
        official_page_url: "officialPageUrl",
      };
      return map[field] ?? field;
    };
    const cmp = (field: string, a: unknown, b: unknown) => {
      const av = a == null ? null : String(a);
      const bv = b == null ? null : String(b);
      if (av !== bv) changes.push(field);
    };
    cmp("context_window", existing.context_window, m.contextWindow);
    cmp("name", existing.name, m.name);
    cmp("input_modalities", existing.input_modalities, j(m.inputModalities));
    cmp("output_modalities", existing.output_modalities, j(m.outputModalities));
    cmp("vision_support", existing.vision_support, bool(m.visionSupport));
    cmp("tool_calling", existing.tool_calling, bool(m.toolCalling));
    cmp("structured_output", existing.structured_output, bool(m.structuredOutput));
    cmp("reasoning_support", existing.reasoning_support, bool(m.reasoningSupport));
    cmp("description", existing.description, m.description);
    cmp("official_page_url", existing.official_page_url, m.officialPageUrl);

    if (changes.length === 0) {
      db.prepare("UPDATE models SET provider_id = ?, family = ? WHERE id = ?").run(m.providerId, m.family, m.id);
      return { added: false, changed: false, changedFields: [] };
    }

    db.prepare(
      `UPDATE models SET name=?, provider_id=?, family=?, version=?, release_date=?, context_window=?,
        max_output_tokens=?, input_modalities=?, output_modalities=?, vision_support=?, tool_calling=?,
        structured_output=?, reasoning_support=?, is_open_source=?, official_page_url=?, description=?
       WHERE id=?`
    ).run(
      m.name, m.providerId, m.family, m.version, m.releaseDate, m.contextWindow, m.maxOutputTokens,
      j(m.inputModalities), j(m.outputModalities), bool(m.visionSupport), bool(m.toolCalling),
      bool(m.structuredOutput), bool(m.reasoningSupport), bool(m.isOpenSource), m.officialPageUrl, m.description, m.id
    );

    for (const field of changes) {
      this.recordChange({
        entityType: "model",
        entityId: m.id,
        fieldChanged: field,
        oldValue: String((existing as any)[field] ?? ""),
        newValue: String((m as any)[modelProp(field)] ?? ""),
        changeSource: "automated",
        sourceUrl: opts?.sourceUrl ?? OPENROUTER_SOURCE_URL,
        notes: opts?.sourceNotes ?? "Changed in OpenRouter catalog during live collection.",
      });
    }
    invalidateRouteCache();
    return { added: false, changed: true, changedFields: changes };
    });
  }

  upsertAvailabilityRow(a: NormalizedAvailabilityRow, sourceId: string): {
    added: boolean;
    changed: boolean;
    reactivated: boolean;
  } {
    return withTransaction(() => {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM availability WHERE id = ?").get(a.id) as any;

    // Provenance preservation (Decision 3, §14c): never downgrade an existing
    // human-attested (`production`) row, and never lower its confidence.
    const isProduction = !!existing && existing.data_origin === "production";
    const effDataOrigin = isProduction ? "production" : "live_collector";
    const effMethod = isProduction ? (existing.verification_method ?? "manual") : "collector";
    const effConfidence: VerificationConfidence = existing
      ? (maxConfidence(existing.verification_confidence, a.confidence) as VerificationConfidence)
      : a.confidence;
    // Collection mode: for new rows, use the collector's mode; for existing production rows, preserve mode.
    const effCollectionMode = existing
      ? (existing.collection_mode as CollectionMode | null) ?? (isProduction ? "live" : "live")
      : a.collectionMode ?? "live";

    if (!existing) {
      const cols = [
        "id", "model_id", "provider_id", "harness_id", "access_type", "free_quota_value", "free_quota_unit", "free_quota_period",
        "rate_limit_rpm", "rate_limit_tpm", "daily_limit", "monthly_limit", "input_price_per_million", "output_price_per_million",
        "currency", "requires_api_key", "requires_payment_method", "payment_requirement_known", "requires_signup", "geographic_restrictions", "api_format",
        "custom_endpoint_url", "status", "is_active", "source_url", "source_title", "source_type", "last_verified_at",
        "verification_method", "verification_confidence", "verification_notes", "data_origin", "collection_mode", "expires_at", "verified_by",
      ];
      const params = [
        a.id, a.modelId, a.providerId, null, a.accessType, null, null, null,
        a.rateLimitRpm ?? null, a.rateLimitTpm ?? null, a.dailyLimit ?? null, a.monthlyLimit ?? null,
        a.inputPricePerMillion, a.outputPricePerMillion, "USD", bool(a.requiresApiKey), bool(a.requiresPaymentMethod),
        bool(a.paymentRequirementKnown ?? false), bool(a.requiresSignup), null, a.apiFormat, null, a.status, 1, a.sourceUrl, a.sourceTitle, "official_docs",
        this.today, "collector", "likely", a.free.reason ?? "Imported by live collector.", effDataOrigin, effCollectionMode, a.expiresAt, null,
      ];
      db.prepare(`INSERT INTO availability (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...params);
      this.recordChange({
        entityType: "availability",
        entityId: a.id,
        fieldChanged: "added",
        oldValue: null,
        newValue: `${a.accessType}/${a.status}`,
        changeSource: "automated",
        sourceUrl: a.sourceUrl,
        notes: `Free route discovered via live collector. ${a.free.reason}`,
      });
      this.appendVerificationHistory({
        availabilityId: a.id,
        modelId: a.modelId,
        providerId: a.providerId,
        verifiedBy: `collector:${a.providerId}`,
        newConf: effConfidence,
        newStatus: a.status,
        notes: "Initial import by live collector.",
      });
      this.linkSource(a.id, sourceId);
      invalidateRouteCache();
      return { added: true, changed: false, reactivated: false };
    }

    const changes: string[] = [];
    const cmp = (field: string, a: unknown, b: unknown) => {
      const av = a == null ? null : String(a);
      const bv = b == null ? null : String(b);
      if (av !== bv) changes.push(field);
    };
    cmp("status", existing.status, a.status);
    cmp("access_type", existing.access_type, a.accessType);
    cmp("verification_confidence", existing.verification_confidence, effConfidence);
    cmp("requires_payment_method", existing.requires_payment_method, bool(a.requiresPaymentMethod));
    cmp("payment_requirement_known", existing.payment_requirement_known, bool(a.paymentRequirementKnown ?? false));
    cmp("input_price_per_million", existing.input_price_per_million, a.inputPricePerMillion);
    cmp("output_price_per_million", existing.output_price_per_million, a.outputPricePerMillion);
    cmp("rate_limit_rpm", existing.rate_limit_rpm, a.rateLimitRpm ?? null);
    cmp("rate_limit_tpm", existing.rate_limit_tpm, a.rateLimitTpm ?? null);
    cmp("daily_limit", existing.daily_limit, a.dailyLimit ?? null);
    cmp("monthly_limit", existing.monthly_limit, a.monthlyLimit ?? null);
    cmp("expires_at", existing.expires_at ?? null, a.expiresAt ?? null);

    const wasActive = existing.is_active === 1;
    const reactivated = !wasActive;

    // The standardized "why free" note is part of the canonical claim and must be
    // kept current on every run (it embeds the last-checked date and the
    // "usage limits not specified" caveat). Refresh it even when no other field
    // changed, so live-collector rows never drift from the collector's contract.
    const wantNotes = `${a.free.reason} (last checked ${this.today})`;
    const notesChanged = (existing.verification_notes ?? "") !== wantNotes;

    if (changes.length === 0 && !reactivated && !notesChanged) {
      db.prepare("UPDATE availability SET last_verified_at = ? WHERE id = ?").run(this.today, a.id);
      return { added: false, changed: false, reactivated: false };
    }

    db.prepare(
      `UPDATE availability SET status=?, access_type=?, verification_confidence=?, requires_payment_method=?, payment_requirement_known=?,
        input_price_per_million=?, output_price_per_million=?, rate_limit_rpm=?, rate_limit_tpm=?, daily_limit=?, monthly_limit=?,
        source_url=?, source_title=?, source_type=?,
        expires_at=?, is_active=1, last_verified_at=?, verification_method=?,
        data_origin=?, collection_mode=?, verification_notes=?
       WHERE id=?`
    ).run(
      a.status, a.accessType, effConfidence, bool(a.requiresPaymentMethod), bool(a.paymentRequirementKnown ?? false), a.inputPricePerMillion,
      a.outputPricePerMillion, a.rateLimitRpm ?? null, a.rateLimitTpm ?? null, a.dailyLimit ?? null, a.monthlyLimit ?? null,
      a.sourceUrl, a.sourceTitle, a.sourceType, a.expiresAt ?? null, this.today, effMethod, effDataOrigin,
      effCollectionMode, wantNotes, a.id
    );
    this.linkSource(a.id, sourceId);

    // Only record change/verification history when an actual field changed or the
    // route was reactivated. A note-only refresh (e.g. updated "last checked" date)
    // must not generate spurious history rows.
    if (changes.length > 0 || reactivated) {
    if (reactivated) {
      this.recordChange({
        entityType: "availability",
        entityId: a.id,
        fieldChanged: "added",
        oldValue: `${existing.status ?? "unavailable"}/inactive`,
        newValue: `${a.accessType}/${a.status}`,
        changeSource: "automated",
        sourceUrl: a.sourceUrl,
        notes: "Free route re-appeared in the live catalog after being removed.",
      });
    } else {
      const hasRateLimitChange = changes.some((c) => c === "rate_limit_rpm" || c === "rate_limit_tpm" || c === "daily_limit" || c === "monthly_limit");
      const fieldLabel = changes.includes("status") || changes.includes("access_type") ? "status/access" : hasRateLimitChange ? "rate_limit" : changes.join(",");
      this.recordChange({
        entityType: "availability",
        entityId: a.id,
        fieldChanged: changes.includes("status") ? "status_change" : changes.includes("input_price_per_million") || changes.includes("output_price_per_million") ? "pricing_change" : hasRateLimitChange ? "rate_limit_change" : "updated",
        oldValue: `${existing.verification_confidence}/${existing.status}`,
        newValue: `${effConfidence}/${a.status}`,
        changeSource: "automated",
        sourceUrl: a.sourceUrl,
        notes: `Changed field(s): ${fieldLabel}.`,
      });
    }
      this.appendVerificationHistory({
        availabilityId: a.id,
        modelId: a.modelId,
        providerId: a.providerId,
        verifiedBy: `collector:${a.providerId}`,
        previousConf: existing.verification_confidence,
        previousStatus: existing.status,
        newConf: effConfidence,
        newStatus: a.status,
        notes: reactivated ? "Re-activated by live collector." : "Updated by live collector.",
      });
    }
    invalidateRouteCache();
    return { added: false, changed: changes.length > 0 || reactivated, reactivated };
    });
  }

  markRemoved(availabilityId: string, reason?: string, sourceUrl?: string): boolean {
    return withTransaction(() => {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM availability WHERE id = ?").get(availabilityId) as any;
    if (!existing || existing.is_active !== 1) return false;
    const defaultReason = existing.provider_id === GEMINI_PROVIDER_ID
      ? "Model no longer present in the Gemini live catalog."
      : "Model no longer present in the OpenRouter live catalog.";
    const note = reason ?? defaultReason;
    const defaultCatalog = existing.provider_id === GEMINI_PROVIDER_ID
      ? "Google catalog"
      : "OpenRouter catalog";
    // Provenance preservation (Decision 3, §14c): a human-verified (`production`)
    // route is still deactivated, but its attestation labels are kept.
    const isProduction = existing.data_origin === "production";
    const method = isProduction ? (existing.verification_method ?? "manual") : "collector";
    const origin = isProduction ? "production" : "live_collector";
    db.prepare(
      `UPDATE availability SET is_active=0, status='unavailable', last_verified_at=?, verification_method=?,
        data_origin=?, verification_notes='Removed from ${defaultCatalog} — no longer returned by the API.'
       WHERE id=?`
    ).run(this.today, method, origin, availabilityId);
    this.recordChange({
      entityType: "availability",
      entityId: availabilityId,
      fieldChanged: "removed",
      oldValue: `${existing.verification_confidence}/${existing.status}`,
      newValue: "unavailable",
      changeSource: "automated",
      sourceUrl: sourceUrl ?? OPENROUTER_SOURCE_URL,
      notes: note,
    });
    this.appendVerificationHistory({
      availabilityId,
      modelId: existing.model_id,
      providerId: existing.provider_id,
      verifiedBy: `collector:${existing.provider_id}`,
      previousConf: existing.verification_confidence,
      previousStatus: existing.status,
      newConf: existing.verification_confidence,
      newStatus: "unavailable",
      notes: note,
    });
    invalidateRouteCache();
    return true;
    });
  }

  recordRun(run: {
    id: string;
    collector: string;
    startedAt: string;
    finishedAt: string;
    status: string;
    dryRun: boolean;
    modelsDiscovered: number;
    freeModels: number;
    modelsAdded: number;
    modelsChanged: number;
    modelsRemoved: number;
    freeRoutesAdded: number;
    freeRoutesRemoved: number;
    errorCount: number;
    warningCount: number;
    errorMessage: string | null;
    summary: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO collector_runs
        (id, collector, started_at, finished_at, status, dry_run, models_discovered, free_models,
         models_added, models_changed, models_removed, free_routes_added, free_routes_removed,
         error_count, warning_count, error_message, summary)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      run.id, run.collector, run.startedAt, run.finishedAt, run.status, run.dryRun ? 1 : 0, run.modelsDiscovered,
      run.freeModels, run.modelsAdded, run.modelsChanged, run.modelsRemoved, run.freeRoutesAdded,
      run.freeRoutesRemoved, run.errorCount, run.warningCount, run.errorMessage, run.summary
    );
  }

  async upsertModel(m: import("./types").NormalizedModel): Promise<void> {
    this.upsertModelRow({
      id: m.id,
      name: m.name,
      providerId: m.providerId,
      author: m.providerId,
      family: m.family ?? null,
      version: m.version ?? null,
      releaseDate: null,
      contextWindow: null,
      maxOutputTokens: null,
      inputModalities: [],
      outputModalities: [],
      visionSupport: false,
      toolCalling: false,
      structuredOutput: false,
      reasoningSupport: false,
      isOpenSource: false,
      description: null,
      officialPageUrl: null,
    });
  }

  async upsertAvailability(a: NormalizedAvailability, _issues: string[]): Promise<void> {
    const sourceId = this.ensureSource();
    this.upsertAvailabilityRow(
      {
        id: a.id,
        modelId: a.modelId,
        providerId: a.providerId,
        accessType: a.accessType,
        status: a.status,
        confidence: a.confidence,
        isFree: a.freeAccess ?? false,
        pricingClass: "zero_cost_inference",
        free: { isFree: a.freeAccess ?? false, pricingClass: "zero_cost_inference", accessType: a.accessType, reason: "imported" },
        inputPricePerMillion: a.pricePerMillionIn ?? null,
        outputPricePerMillion: a.pricePerMillionOut ?? null,
        requiresApiKey: a.requiresApiKey ?? true,
        requiresPaymentMethod: a.requiresPaymentMethod ?? false,
        requiresSignup: a.requiresSignup ?? true,
        expiresAt: a.expiresAt ?? null,
        sourceUrl: a.sourceUrl ?? null,
        sourceType: a.sourceType ?? "official_docs",
        sourceTitle: a.sourceTitle ?? "OpenRouter",
        apiFormat: "openai_chat_completions",
      } as NormalizedAvailabilityRow,
      sourceId
    );
  }

  async finish(_result: CollectorResult): Promise<void> {
    // Run-level record is written by runOpenRouterCollector.
  }
}
