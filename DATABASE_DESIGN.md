# Database Design (as implemented)

The app uses a single SQLite database accessed through Node's built-in `node:sqlite`
(`DatabaseSync`). The connection is created once per process and cached on `globalThis`
so serverless/worker re-use works. The file lives at `data/freeai.db` (override with
`FREEAI_DB_PATH`, e.g. `:memory:` for tests).

## Design principles

- **Data freshness is first-class.** Every availability/provider/harness row carries a
  `data_origin` (`seed` | `production` | `user_report`) and a `verification_confidence`.
  Seed/demo rows are never presented to users as "live verified".
- **Verification is immutable.** Status/confidence changes are appended to
  `verification_history`; the live row is updated, but the prior value is always preserved
  in history + `change_history`.
- **One claim, many sources.** Each `availability` row can be backed by multiple
  `sources` through the `availability_sources` join table, so a single "this model is free
  here" claim rests on independent evidence.
- **Migrations are additive.** New columns are applied via `ALTER TABLE` at boot
  (`MIGRATIONS` in `db.ts`) so an existing on-disk database is upgraded in place rather
  than dropped.

## Tables

### models
```
id TEXT PRIMARY KEY
name TEXT NOT NULL
provider_id TEXT                 -- original provider (denormalized label)
family TEXT
version TEXT
release_date TEXT
context_window INTEGER
max_output_tokens INTEGER
input_modalities TEXT            -- JSON array
output_modalities TEXT           -- JSON array
vision_support INTEGER
tool_calling INTEGER
structured_output INTEGER
reasoning_support INTEGER
coding_capability INTEGER
is_open_source INTEGER
license TEXT
official_page_url TEXT
documentation_url TEXT
description TEXT
```
No `created_at`/`updated_at` columns are used at runtime (the design doc's earlier draft
listed them; they are intentionally omitted to keep writes simple).

### providers
```
id TEXT PRIMARY KEY
name TEXT NOT NULL
category TEXT                    -- direct_api | aggregator | inference | coding_harness | cloud | local_platform | hosted_oss
website_url, api_docs_url, pricing_url TEXT
has_free_tier INTEGER
free_credits_amount REAL
free_credits_currency TEXT
rate_limit_rpm, rate_limit_tpm, daily_request_limit, monthly_token_limit INTEGER
requires_payment_method INTEGER
requires_signup INTEGER
geographic_restrictions TEXT     -- JSON array
terms_restrictions TEXT
status TEXT
last_verified_at TEXT
verification_confidence TEXT
data_origin TEXT                 -- ADDED: seed | production | user_report
```

### harnesses
```
id TEXT PRIMARY KEY
name TEXT NOT NULL
website_url, documentation_url TEXT
supports_custom_openai_endpoint, supports_anthropic_endpoint, supports_openrouter_routing INTEGER
auth_methods TEXT                -- JSON array
description TEXT
```

### availability  (core junction: model × provider × access route)
```
id TEXT PRIMARY KEY              -- `${modelId}__${providerId}`
model_id TEXT NOT NULL
provider_id TEXT NOT NULL
harness_id TEXT                  -- NULL for direct API access
access_type TEXT NOT NULL        -- see AccessType enum
free_quota_value REAL
free_quota_unit TEXT             -- requests | tokens | dollars | credits
free_quota_period TEXT           -- day | month | minute | once | lifetime
rate_limit_rpm, rate_limit_tpm, daily_limit, monthly_limit INTEGER
input_price_per_million, output_price_per_million REAL
currency TEXT
requires_api_key, requires_payment_method, requires_signup INTEGER
geographic_restrictions TEXT     -- JSON array
api_format TEXT
custom_endpoint_url TEXT
status TEXT                      -- available | limited | degraded | unavailable | unknown | temporarily_free
is_active INTEGER
source_url, source_title, source_type TEXT
last_verified_at TEXT
verification_method TEXT
verification_confidence TEXT     -- verified | likely | unverified | stale
verification_notes TEXT
data_origin TEXT                 -- ADDED: seed | production | user_report
expires_at TEXT                  -- ADDED: for promotional/temporary offers
verified_by TEXT                 -- ADDED: actor who last confirmed
```

### sources
```
id TEXT PRIMARY KEY
url TEXT NOT NULL UNIQUE
title TEXT
source_type TEXT                 -- official_docs | pricing_page | blog_post | github | twitter | community
provider_id, model_id, availability_id TEXT
claim_supported TEXT
date_discovered, date_last_checked TEXT
is_verified INTEGER
reliability TEXT                 -- ADDED: verified | likely | unverified | stale
last_checked_at TEXT             -- ADDED
last_changed_at TEXT             -- ADDED
notes TEXT                       -- ADDED
```

### availability_sources  (join: one claim, many sources)
```
availability_id TEXT NOT NULL
source_id TEXT NOT NULL
role TEXT                        -- evidence | contradiction
PRIMARY KEY (availability_id, source_id)
```

### verification_history  (immutable audit trail of verifications)
```
id TEXT PRIMARY KEY
availability_id TEXT NOT NULL
model_id, provider_id TEXT
verified_by TEXT
verified_at TEXT NOT NULL
previous_confidence, previous_status TEXT
new_confidence, new_status TEXT
source_ids TEXT
notes TEXT
```

### change_history
```
id TEXT PRIMARY KEY
entity_type TEXT                 -- model | provider | availability | harness
entity_id TEXT
field_changed TEXT
old_value, new_value TEXT
change_source TEXT               -- manual | automated | user_report | admin_verify
source_url TEXT
detected_at TEXT
verified_at TEXT
verified_by TEXT                 -- ADDED
notes TEXT
```

### model_harness_compatibility
```
id TEXT PRIMARY KEY
model_id, harness_id, provider_id TEXT
auth_method TEXT
requires_api_key, supports_directly, works_with_custom_endpoint, works_with_openrouter INTEGER
setup_difficulty, known_limitations, free_status TEXT
last_verified_at TEXT
verification_confidence TEXT
source_url TEXT
data_origin TEXT                 -- ADDED
```

## Indexes
Cover the common access paths: `availability(model_id)`, `availability(provider_id)`,
`availability(status)`, `availability(access_type)`, `availability(is_active)`,
`availability(data_origin)`, `availability(expires_at)`, plus the same for `models`
(coding/vision/context/opensource), `providers` (category/freetier/status), `sources`
(provider/model/availability), `change_history` (entity/detected), `verification_history`
(availability), and `availability_sources` (both directions).

## Notes on the earlier design draft
The previous `DATABASE_DESIGN.md` proposed `created_at`/`updated_at` columns, a
`verification_queue` table, and a `user_watchlist` table. These were **not** implemented:
- Freshness is derived from `last_verified_at` + `data_origin` rather than separate audit
  timestamps, and the verification queue is computed on read (`getVerificationQueue`) from
  the `availability` table — no separate table to keep in sync.
- `user_watchlist` remains a future feature.
If you add either, do it via the `MIGRATIONS` array in `db.ts` so existing databases upgrade.
