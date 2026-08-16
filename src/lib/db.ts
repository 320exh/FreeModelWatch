import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const DB_DIR = path.join(process.cwd(), "data");
// Allow tests / ephemeral usage to point at an in-memory or custom database.
const DB_PATH = process.env.FREEAI_DB_PATH && process.env.FREEAI_DB_PATH.length > 0
  ? process.env.FREEAI_DB_PATH
  : path.join(DB_DIR, "freeai.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_id TEXT,
  family TEXT,
  version TEXT,
  release_date TEXT,
  context_window INTEGER,
  max_output_tokens INTEGER,
  input_modalities TEXT,
  output_modalities TEXT,
  vision_support INTEGER DEFAULT 0,
  tool_calling INTEGER DEFAULT 0,
  structured_output INTEGER DEFAULT 0,
  reasoning_support INTEGER DEFAULT 0,
  coding_capability INTEGER,
  is_open_source INTEGER DEFAULT 0,
  license TEXT,
  official_page_url TEXT,
  documentation_url TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  website_url TEXT,
  api_docs_url TEXT,
  pricing_url TEXT,
  has_free_tier INTEGER DEFAULT 0,
  free_credits_amount REAL,
  free_credits_currency TEXT DEFAULT 'USD',
  rate_limit_rpm INTEGER,
  rate_limit_tpm INTEGER,
  daily_request_limit INTEGER,
  monthly_token_limit INTEGER,
  requires_payment_method INTEGER DEFAULT 0,
  requires_signup INTEGER DEFAULT 1,
  geographic_restrictions TEXT,
  terms_restrictions TEXT,
  status TEXT DEFAULT 'unknown',
  last_verified_at TEXT,
  verification_confidence TEXT DEFAULT 'unverified',
  data_origin TEXT DEFAULT 'seed'
);

CREATE TABLE IF NOT EXISTS harnesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website_url TEXT,
  documentation_url TEXT,
  supports_custom_openai_endpoint INTEGER DEFAULT 0,
  supports_anthropic_endpoint INTEGER DEFAULT 0,
  supports_openrouter_routing INTEGER DEFAULT 0,
  auth_methods TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  harness_id TEXT,
  access_type TEXT NOT NULL,
  free_quota_value REAL,
  free_quota_unit TEXT,
  free_quota_period TEXT,
  rate_limit_rpm INTEGER,
  rate_limit_tpm INTEGER,
  daily_limit INTEGER,
  monthly_limit INTEGER,
  input_price_per_million REAL,
  output_price_per_million REAL,
  currency TEXT DEFAULT 'USD',
  requires_api_key INTEGER DEFAULT 1,
  requires_payment_method INTEGER DEFAULT 0,
  requires_signup INTEGER DEFAULT 1,
  geographic_restrictions TEXT,
  api_format TEXT,
  custom_endpoint_url TEXT,
  status TEXT DEFAULT 'unknown',
  is_active INTEGER DEFAULT 1,
  source_url TEXT,
  source_title TEXT,
  source_type TEXT,
  last_verified_at TEXT,
  verification_method TEXT,
  verification_confidence TEXT DEFAULT 'unverified',
  verification_notes TEXT,
  data_origin TEXT DEFAULT 'seed',
  expires_at TEXT,
  verified_by TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  source_type TEXT,
  provider_id TEXT,
  model_id TEXT,
  availability_id TEXT,
  claim_supported TEXT,
  date_discovered TEXT,
  date_last_checked TEXT,
  is_verified INTEGER DEFAULT 0,
  reliability TEXT DEFAULT 'unknown',
  last_checked_at TEXT,
  last_changed_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS availability_sources (
  availability_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  role TEXT DEFAULT 'evidence',
  PRIMARY KEY (availability_id, source_id)
);

CREATE TABLE IF NOT EXISTS verification_history (
  id TEXT PRIMARY KEY,
  availability_id TEXT NOT NULL,
  model_id TEXT,
  provider_id TEXT,
  verified_by TEXT,
  verified_at TEXT NOT NULL,
  previous_confidence TEXT,
  previous_status TEXT,
  new_confidence TEXT,
  new_status TEXT,
  source_ids TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS change_history (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  change_source TEXT,
  source_url TEXT,
  detected_at TEXT,
  verified_at TEXT,
  verified_by TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS model_harness_compatibility (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  harness_id TEXT NOT NULL,
  provider_id TEXT,
  auth_method TEXT,
  requires_api_key INTEGER DEFAULT 1,
  supports_directly INTEGER DEFAULT 0,
  works_with_custom_endpoint INTEGER DEFAULT 0,
  works_with_openrouter INTEGER DEFAULT 0,
  setup_difficulty TEXT,
  known_limitations TEXT,
  free_status TEXT,
  last_verified_at TEXT,
  verification_confidence TEXT DEFAULT 'unverified',
  source_url TEXT,
  data_origin TEXT DEFAULT 'seed'
);

CREATE INDEX IF NOT EXISTS idx_avail_model ON availability(model_id);
CREATE INDEX IF NOT EXISTS idx_avail_provider ON availability(provider_id);
CREATE INDEX IF NOT EXISTS idx_avail_harness ON availability(harness_id);
CREATE INDEX IF NOT EXISTS idx_avail_status ON availability(status);
CREATE INDEX IF NOT EXISTS idx_avail_access ON availability(access_type);
CREATE INDEX IF NOT EXISTS idx_avail_active ON availability(is_active);
CREATE INDEX IF NOT EXISTS idx_avail_origin ON availability(data_origin);
CREATE INDEX IF NOT EXISTS idx_avail_expires ON availability(expires_at);
CREATE INDEX IF NOT EXISTS idx_change_entity ON change_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_change_detected ON change_history(detected_at);
CREATE INDEX IF NOT EXISTS idx_models_coding ON models(coding_capability);
CREATE INDEX IF NOT EXISTS idx_models_context ON models(context_window);
CREATE INDEX IF NOT EXISTS idx_models_vision ON models(vision_support);
CREATE INDEX IF NOT EXISTS idx_models_opensource ON models(is_open_source);
CREATE INDEX IF NOT EXISTS idx_providers_category ON providers(category);
CREATE INDEX IF NOT EXISTS idx_providers_freetier ON providers(has_free_tier);
CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);
CREATE INDEX IF NOT EXISTS idx_sources_provider ON sources(provider_id);
CREATE INDEX IF NOT EXISTS idx_sources_model ON sources(model_id);
CREATE INDEX IF NOT EXISTS idx_sources_availability ON sources(availability_id);
CREATE INDEX IF NOT EXISTS idx_avail_sources_avail ON availability_sources(availability_id);
CREATE INDEX IF NOT EXISTS idx_avail_sources_source ON availability_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_verif_hist_avail ON verification_history(availability_id);

CREATE TABLE IF NOT EXISTS collector_runs (
  id TEXT PRIMARY KEY,
  collector TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  dry_run INTEGER DEFAULT 0,
  models_discovered INTEGER DEFAULT 0,
  free_models INTEGER DEFAULT 0,
  models_added INTEGER DEFAULT 0,
  models_changed INTEGER DEFAULT 0,
  models_removed INTEGER DEFAULT 0,
  free_routes_added INTEGER DEFAULT 0,
  free_routes_removed INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  error_message TEXT,
  summary TEXT
);

`;

// Columns added after the initial schema. Applied idempotently so an existing
// database file is migrated forward instead of being dropped.
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "availability", column: "data_origin", ddl: "ALTER TABLE availability ADD COLUMN data_origin TEXT DEFAULT 'seed'" },
  { table: "availability", column: "expires_at", ddl: "ALTER TABLE availability ADD COLUMN expires_at TEXT" },
  { table: "availability", column: "verified_by", ddl: "ALTER TABLE availability ADD COLUMN verified_by TEXT" },
  { table: "providers", column: "data_origin", ddl: "ALTER TABLE providers ADD COLUMN data_origin TEXT DEFAULT 'seed'" },
  { table: "sources", column: "reliability", ddl: "ALTER TABLE sources ADD COLUMN reliability TEXT DEFAULT 'unknown'" },
  { table: "sources", column: "last_checked_at", ddl: "ALTER TABLE sources ADD COLUMN last_checked_at TEXT" },
  { table: "sources", column: "last_changed_at", ddl: "ALTER TABLE sources ADD COLUMN last_changed_at TEXT" },
  { table: "sources", column: "notes", ddl: "ALTER TABLE sources ADD COLUMN notes TEXT" },
  { table: "change_history", column: "verified_by", ddl: "ALTER TABLE change_history ADD COLUMN verified_by TEXT" },
  { table: "model_harness_compatibility", column: "data_origin", ddl: "ALTER TABLE model_harness_compatibility ADD COLUMN data_origin TEXT DEFAULT 'seed'" },
];

type GlobalWithDb = typeof globalThis & { __freeaiDb?: any };

function hasColumn(db: any, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function createConnection(): any {
  if (DB_PATH !== ":memory:") {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    if (!hasColumn(db, m.table, m.column)) {
      try {
        db.exec(m.ddl);
      } catch {
        // Best-effort: a concurrent migration or unsupported op should not crash boot.
      }
    }
  }
  // Backfill data_origin for rows created before the column existed.
  db.exec("UPDATE availability SET data_origin = 'seed' WHERE data_origin IS NULL OR data_origin = ''");
  db.exec("UPDATE providers SET data_origin = 'seed' WHERE data_origin IS NULL OR data_origin = ''");
  db.exec("UPDATE model_harness_compatibility SET data_origin = 'seed' WHERE data_origin IS NULL OR data_origin = ''");
  return db;
}

export function getDb(): any {
  const g = globalThis as GlobalWithDb;
  if (!g.__freeaiDb) {
    g.__freeaiDb = createConnection();
  }
  return g.__freeaiDb;
}

export function isSeeded(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS c FROM models").get() as { c: number };
  return row.c > 0;
}

export function resetDb(): void {
  const db = getDb();
  for (const t of [
    "availability_sources",
    "verification_history",
    "change_history",
    "availability",
    "sources",
    "model_harness_compatibility",
    "harnesses",
    "providers",
    "models",
  ]) {
    db.exec(`DELETE FROM ${t}`);
  }
}
