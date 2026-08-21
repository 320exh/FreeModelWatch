import { getDb } from "./db";
import { PROVIDERS, HARNESSES } from "./seed-data";
import { AVAILABILITY, SOURCES, HARNESS_COMPAT, CHANGES } from "./seed-availability";
import { MODELS } from "./seed-data";
import type { Model, Provider, Harness, Availability, Source, ChangeHistory, HarnessCompat } from "./types";

function j(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v) && v.length === 0) return null;
  return JSON.stringify(v);
}

function bool(v: boolean | null | undefined): number {
  return v ? 1 : 0;
}

function reliabilityForSource(s: Source): string {
  if (s.isVerified) return "verified";
  if (s.sourceType === "official_docs" || s.sourceType === "pricing_page") return "likely";
  return "unverified";
}

export function seedDatabase(): void {
  const db = getDb();

  const insertProvider = db.prepare(`
    INSERT OR IGNORE INTO providers
    (id,name,category,website_url,api_docs_url,pricing_url,has_free_tier,free_credits_amount,free_credits_currency,
     rate_limit_rpm,rate_limit_tpm,daily_request_limit,monthly_token_limit,requires_payment_method,requires_signup,
     geographic_restrictions,terms_restrictions,status,last_verified_at,verification_confidence,data_origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const p of PROVIDERS as Provider[]) {
    insertProvider.run(
      p.id, p.name, p.category, p.websiteUrl, p.apiDocsUrl, p.pricingUrl, bool(p.hasFreeTier),
      p.freeCreditsAmount, p.freeCreditsCurrency, p.rateLimitRpm, p.rateLimitTpm, p.dailyRequestLimit,
      p.monthlyTokenLimit, bool(p.requiresPaymentMethod), bool(p.requiresSignup), j(p.geographicRestrictions),
      p.termsRestrictions, p.status, p.lastVerifiedAt, p.verificationConfidence, p.dataOrigin ?? "seed"
    );
  }

  const insertHarness = db.prepare(`
    INSERT OR IGNORE INTO harnesses
    (id,name,website_url,documentation_url,supports_custom_openai_endpoint,supports_anthropic_endpoint,
     supports_openrouter_routing,auth_methods,description)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  for (const h of HARNESSES as Harness[]) {
    insertHarness.run(
      h.id, h.name, h.websiteUrl, h.documentationUrl, bool(h.supportsCustomOpenaiEndpoint),
      bool(h.supportsAnthropicEndpoint), bool(h.supportsOpenrouterRouting), j(h.authMethods), h.description
    );
  }

  const insertModel = db.prepare(`
    INSERT OR IGNORE INTO models
    (id,name,provider_id,family,version,release_date,context_window,max_output_tokens,input_modalities,
     output_modalities,vision_support,tool_calling,structured_output,reasoning_support,coding_capability,
     is_open_source,license,official_page_url,documentation_url,description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const m of MODELS as Model[]) {
    insertModel.run(
      m.id, m.name, m.providerId, m.family, m.version, m.releaseDate, m.contextWindow, m.maxOutputTokens,
      j(m.inputModalities), j(m.outputModalities), bool(m.visionSupport), bool(m.toolCalling),
      bool(m.structuredOutput), bool(m.reasoningSupport), m.codingCapability, bool(m.isOpenSource),
      m.license, m.officialPageUrl, m.documentationUrl, m.description
    );
  }

const insertAvail = db.prepare(`
    INSERT OR IGNORE INTO availability
    (id,model_id,provider_id,harness_id,access_type,free_quota_value,free_quota_unit,free_quota_period,
     rate_limit_rpm,rate_limit_tpm,daily_limit,monthly_limit,input_price_per_million,output_price_per_million,
     currency,requires_api_key,requires_payment_method,payment_requirement_known,requires_signup,geographic_restrictions,api_format,
     custom_endpoint_url,status,is_active,source_url,source_title,source_type,last_verified_at,
     verification_method,verification_confidence,verification_notes,data_origin,collection_mode,expires_at,verified_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
   for (const a of AVAILABILITY as Availability[]) {
     insertAvail.run(
       a.id, a.modelId, a.providerId, a.harnessId ?? null, a.accessType, a.freeQuotaValue, a.freeQuotaUnit, a.freeQuotaPeriod,
       a.rateLimitRpm, a.rateLimitTpm, a.dailyLimit, a.monthlyLimit, a.inputPricePerMillion, a.outputPricePerMillion,
       a.currency, bool(a.requiresApiKey), bool(a.requiresPaymentMethod), bool(a.paymentRequirementKnown), bool(a.requiresSignup), j(a.geographicRestrictions),
       a.apiFormat, a.customEndpointUrl, a.status, bool(a.isActive), a.sourceUrl, a.sourceTitle, a.sourceType,
       a.lastVerifiedAt, a.verificationMethod, a.verificationConfidence, a.verificationNotes, a.dataOrigin ?? "seed", a.collectionMode ?? "seed", a.expiresAt ?? null, null
     );
   }

  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO sources
    (id,url,title,source_type,provider_id,model_id,availability_id,claim_supported,date_discovered,date_last_checked,is_verified,reliability,last_checked_at,last_changed_at,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const s of SOURCES as Source[]) {
    insertSource.run(
      s.id, s.url, s.title, s.sourceType, s.providerId, s.modelId, s.availabilityId, s.claimSupported,
      s.dateDiscovered, s.dateLastChecked, bool(s.isVerified), reliabilityForSource(s),
      s.dateLastChecked, s.dateDiscovered, s.notes ?? null
    );
  }

  // Link each availability to every source that supports the same provider (and,
  // where applicable, the same model). A single availability claim can therefore
  // rest on multiple independent sources (pricing page + official docs + API docs).
  const linkAv = db.prepare(
    "INSERT OR IGNORE INTO availability_sources (availability_id, source_id, role) VALUES (?, ?, 'evidence')"
  );
  for (const a of AVAILABILITY as Availability[]) {
    for (const s of SOURCES as Source[]) {
      if (s.providerId === a.providerId && (s.modelId === a.modelId || s.modelId == null)) {
        linkAv.run(a.id, s.id);
      }
    }
  }

  const insertHc = db.prepare(`
    INSERT OR IGNORE INTO model_harness_compatibility
    (id,model_id,harness_id,provider_id,auth_method,requires_api_key,supports_directly,works_with_custom_endpoint,
     works_with_openrouter,setup_difficulty,known_limitations,free_status,last_verified_at,verification_confidence,source_url,data_origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const c of HARNESS_COMPAT as HarnessCompat[]) {
    insertHc.run(
      c.id, c.modelId, c.harnessId, c.providerId, c.authMethod, bool(c.requiresApiKey), bool(c.supportsDirectly),
      bool(c.worksWithCustomEndpoint), bool(c.worksWithOpenrouter), c.setupDifficulty, c.knownLimitations,
      c.freeStatus, c.lastVerifiedAt, c.verificationConfidence, c.sourceUrl, c.dataOrigin ?? "seed"
    );
  }

  const insertChange = db.prepare(`
    INSERT OR IGNORE INTO change_history
    (id,entity_type,entity_id,field_changed,old_value,new_value,change_source,source_url,detected_at,verified_at,verified_by,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const ch of CHANGES as ChangeHistory[]) {
    insertChange.run(
      ch.id, ch.entityType, ch.entityId, ch.fieldChanged, ch.oldValue, ch.newValue, ch.changeSource,
      ch.sourceUrl, ch.detectedAt, ch.verifiedAt, ch.verifiedBy ?? null, ch.notes
    );
  }
}
