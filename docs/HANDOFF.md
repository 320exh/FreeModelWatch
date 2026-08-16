# FreeModelWatch — AI Development Handoff

> **Status:** Continuity document for developers and AI coding agents.
> Written 2026-08-16 against the HEAD of `main` (commit `ceef6a0`).
> Everything below was verified directly against the repository, not inferred.
> Read it fully before touching any code.

---

## 1. Project Purpose

FreeModelWatch is a tracker for which AI models are usable **for free right now** —
across platforms that are materially different from each other:

- **Direct provider API free tiers** (e.g. Google AI Studio / Gemini API)
- **Aggregators** (e.g. OpenRouter zero-cost inference routes)
- **Free credits / trial tiers** (Together, Cohere, Perplexity)
- **Local / self-hosted open weights** (Ollama)
- **Coding harnesses** (Claude Code, OpenCode, Cline, Roo Code, Aider, Continue,
  Cursor, Windsurf)

The product's differentiator is **trust**:

- Every "this model is free here" claim records *where* it came from
  (`data_origin`), *how confident* we are (`verification_confidence`), *when* it was
  last checked (`last_verified_at`), and which sources back the claim
  (`sources` + `availability_sources`).
- Seed/demo data is never presented as live-verified data.
- Change history is append-only and never rewritten.
- "Unknown" values are displayed as unknown — never silently converted into
  "free / unlimited / no card required".

It is a **read-mostly product**: most pages are static-ish reads over a single SQLite
file; writes happen through a small set of server actions and live collectors.

## 2. Current Product Vision

Intended end state: a reliable, transparent directory of "which models are free and
where", refreshed automatically, with an auditable trail of how the data changed.

Core product principles (each is enforced in code, not just aspirational):

- **Free access ≠ unlimited access.** "Zero-cost inference" does not imply a big or
  any quota. When a source does not publish rate/request/token caps, the UI says the
  limits are *unspecified*, never "unlimited" (`src/lib/collectors/openrouter.ts`, the
  model detail page banner, `explainRoute` in `src/lib/intelligence.ts`).
- **Unknown ≠ false.** A missing payment requirement is *unknown*, not "no card
  required" and not "card required". Enforced via the tri-state
  `paymentRequirementKnown` flag/c/comment in `src/lib/types.ts` and
  `src/lib/queries.ts` (`enrichModel`, `noPaymentMethod` logic).
- **Provenance matters.** Every route knows its origin (seed / production /
  user_report / live_collector), its sources, and who verified it (`verified_by`).
- **Freshness matters.** Freshness tiers are computed on read
  (`classifyFreshness`), never stored, so they cannot drift. Seed rows are always
  `seed_demo` even if their confidence column says "verified".
- **Historical changes must be preserved.** `change_history` and
  `verification_history` are append-only; removal marks a route `is_active = 0`
  instead of deleting it.
- **Recommendations must be evidence-based.** Scoring penalizes unknown data
  (`unknownFlags`), never rewards a model for having *more* routes (only the best
  route's quality counts), and explicitly ranks conservative when quota is unknown.

---

## 3. Current Architecture

Layered Next.js App Router app over a single SQLite file. No ORM, no separate API
server, no background worker.

```
UI (React Server Components: src/app/*, src/components/*)
  │
  ├─ queries.ts   — pure reads  (filtering, ranking, freshness, queue, contradictions)
  ├─ actions.ts   — only writes (server actions: verify / add / report / run collector)
  │
  ├─ intelligence.ts — derived route model + recommendation / change-category engine
  ├─ api.ts       — wire-stubbing / serialization for JSON route handlers
  │
  └─ db.ts        — single DatabaseSync connection + schema + additive migrations
       │
       └─ SQLite file: data/freeai.db  (override with FREEAI_DB_PATH, e.g. :memory: for tests)
```

- Single connection cached on `globalThis` (`getDb()`), every query funnels through it.
- Reads vs writes split: `queries.ts` is read-only; the only mutation entry points are
  `src/lib/actions.ts` (server actions) and `src/lib/collectors/dbSink.ts`
  (collector writes). This is the explicit trust boundary.
- `loadGraph()` loads the whole graph once (models, providers, availability,
  harness compat, sources) and builds lookup maps, and `enrichModel` joins from that
  in memory to avoid N+1 queries.
- Collector architecture lives in `src/lib/collectors/` — see section 6.
- **Intelligence layer** in `src/lib/intelligence.ts` — see section 7.

### Frontend / UI structure

- `src/app/layout.tsx` — root layout (Nav, DataBanner, footer). `SITE_URL` env var
  used for metadata base.
- `src/app/globals.css` — Tailwind v4 + CSS variables (dark theme).
- `src/components/` — shared components (see section 8 + table in section 18).
- Pages mapped in section 8.

### Config files

- `next.config.ts` — empty default config.
- `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts` — see section 17.
- `.npmrc` — `allow-scripts=*` (suppresses npm 11 blocked-postinstall prompts).
- `src/types/node-sqlite.d.ts` — local module declaration for `node:sqlite`
  (Vitest mocks it; Next.js externalizes the builtin).

---

## 4. Database  (`src/lib/db.ts`)

Single file DB, default `data/freeai.db`, `DATA/:memory:` for tests. Schema is created
with `CREATE TABLE IF NOT EXISTS`; additional columns since the initial schema are
applied idempotently via the `MIGRATIONS` array (additive `ALTER TABLE`, best-effort).

Tables (all column names snake_case in SQL, camelCase in the TS types):

### `models`
- **Purpose:** model metadata / capability signals.
- Key columns: `id` (PK, e.g. `gemini-2.0-flash` for direct vendor models,
  `openrouter__{author}/{slug}` for aggregator-imported), `name`, `provider_id`,
  `family`, `version`, `release_date`, `context_window`, `max_output_tokens`,
  `input_modalities` / `output_modalities` (JSON arrays), `vision_support`,
  `tool_calling`, `structured_output`, `reasoning_support`, `coding_capability`,
  `is_open_source`, `license`, `official_page_url`, `documentation_url`,
  `description`.
- **Writers:** `seedDatabase()` (seed), `DbCollectorSink.upsertModelRow` (collectors).
- **Notes:** no created_at/updated_at columns (intentionally; freshness is derived).

### `providers`
- **Purpose:** a provider / aggregator / harness as a first-class entity.
- `pk id`, `name`, `category`, URLs (`website/api_docs/pricing`), `has_free_tier`,
  `free_credits_amount/_currency`, `rate_limit_rpm/tpm`, `daily_request_limit`,
  `monthly_token_limit`, `requires_payment_method`, `requires_signup`,
  `geographic_restrictions` (JSON), `terms_restrictions`, `status`,
  `last_verified_at`, `verification_confidence`, `data_origin`.
- **Writers:** `seedDatabase()`, `DbCollectorSink.ensureProvider` /
  `ensureGeminiProvider`.

### `harnesses`
- **Purpose:** coding harness (Claude Code, OpenCode, Cline, Roo Code, Aider,
  Continue, Cursor, Windsurf) capabilities.
- Fields: `id`, `name`, `supports_custom_openai_endpoint`,
  `supports_anthropic_endpoint`, `supports_openrouter_routing`, `auth_methods` (JSON),
  URL fields, `description`.

### `availability`  (the core junction: model × provider × access route)
- **Purpose:** the "this model is free via this provider" claim.
- `pk id` = `${modelId}__${providerId}`, `model_id`, `provider_id`, `harness_id`
  (nullable; `NULL` for direct API), `access_type` (see enum, section 5),
  `free_quota_value/unit/period`, `rate_limit_rpm/tpm`, `daily_limit`,
  `monthly_limit`, `input/output_price_per_million`, `currency`,
  `requires_api_key`, `requires_payment_method`, `payment_requirement_known`,
  `requires_signup`, `geographic_restrictions` (JSON), `api_format`,
  `custom_endpoint_url`, `status`, `is_active`, `source_url/title/type`,
  `last_verified_at`, `verification_method`, `verification_confidence`,
  `verification_notes`, `data_origin`, `expires_at`, `verified_by`.
- The `payment_requirement_known` flag is the crux of the "unknown ≠ no card" rule:
  when `0`, callers treat `requires_payment_method` as unknown, not as "absent".
- **Writers:** `seedDatabase()`, `adminVerifyRoute`, `markVerified`,
  `addAvailability` (actions), `DbCollectorSink.upsertAvailabilityRow` /
  `markRemoved`.

### `sources`
- **Purpose:** externally linkable evidence for claims (official docs, pricing pages).
- `id` (PK), `url` (UNIQUE), `title`, `source_type`, optional `provider_id` /
  `model_id` / `availability_id`, `claim_supported`, `date_discovered`,
  `date_last_checked`, `is_verified`, `reliability`, `last_checked_at`,
  `last_changed_at`, `notes`.

### `availability_sources`  (join table)
-`availability_id` + `source_id`; `role` = `evidence` (or `contradiction` for the
  future). "One claim, many sources" is modeled here.
- **Writers:** `seed.ts`, `DbCollectorSinklinkSource(s)`, `adminVerifyRoute`
  (creates a `src-{availabilityId}` source on admin-saved source URL).

### `verification_history`  (append-only audit log)
- `availability_id`, `model_id`, `provider_id`, `verified_by`, `verified_at`,
  `previous_confidence/status`, `new_confidence/status`, `source_ids`, `notes`.
- Written by `adminVerifyRoute`, `markVerified`, and `DbCollectorSink`
  (appendVerificationHistory). Nothing updates old rows.

### `change_history`  (append-only feed)
- `id`, `entity_type` (model/provider/availability/harness), `entity_id`,
  `field_changed`, `old_value`, `new_value`, `change_source` (`manual` /
  `automated` / `user_report` / `admin_verify` / `admin_add`), `source_url`,
  `detected_at`, `verified_at`, `verified_by`, `notes`.
- Written by all writers (seed, admin actions, collector sink, `reportChange`).

### `model_harness_compatibility`
- **Purpose:** which models work in which harnesses, with free/auth caveats.
- Fields include `free_status` (`free`/null), `works_with_*` flags,
  `verification_confidence`, `data_origin`.

### `collector_runs`  (audit of collector executions)
- `collector`, `started_at`, `finished_at`, `status` (`success`/`partial`/`failed`),
  `dry_run`, `models_discovered`, `free_models`, `models_added`,
  `models_changed`, `models_removed`, `free_routes_added`, `free_routes_removed`,
  `error_count`, `warning_count`, `error_message`, `summary`.

### Indexes
Cover the hot paths: `availability(model_id)`, `availability(provider_id)`,
`availability(status)`, `availability(access_type)`, `availability(is_active)`,
`availability(data_origin)`, `availability(expires_at)`, `models(coding_capability)`,
`models(context_window)`, `models(vision_support)`, `models(is_open_source)`,
`providers(category/freetier/status)`, `sources(provider/model/availability)`,
`change_history(entity)`, tchange_history(detected_at)`,
`verification_history(availability)`, `availability_sources(both directions)`.

### Existing-deployment notes
- Seeds run `resetDb()` — it deletes all rows. It is fine *after* a clean boot /
  first-run, but a running instance will not lose rows to migration.
- The migration path: `MIGRATIONS` in `db.ts` only *adds* columns. To extend the
  model, add to `MIGRATIONS`, not by recreating the schema.

---

## 5. Data Model

Domain concepts and how they map to code:

- **Models** — the logical model entity (e.g. `gemini-2.5-flash`). The same underlying
  model can appear multiple times when reachable through multiple providers
  (`openrouter__{author}/{slug}` vs vendor id). See `canonicalModelKey`
  (section 7).
- **Providers** — direct APIs (`direct_api`), aggregators (`aggregator`), inference
  hosts, coding harnesses, clouds, local platforms, hosted OSS. Enumerated in
  `ProviderCategory`.
- **Harness** — an AI coding environment that can route to free models.
- **Availability route** — the core pair `(model, provider)` + `access_type` *
  status + limits + provenance.
- **Access types (`AccessType`)**: `completely_free`, `free_tier`, `free_credits`,
  `free_with_limits`, `free_through_aggregator`, `free_through_harness`,
  `free_local`, `temporarily_free`, `community_unofficial`, `direct_api`.
  Every UI badge and every join in `scoreRouteQuality` treats these distinctly —
  aggregator free ≠ direct free tier.
- **Sources** — evidence rows linked to availability via
  `availability_sources`; a model-specific OpenRouter URL vs a canonical catalog URL
  is deliberate (one source for many routes, model-specific URL as primary).
- **Change history** — see `categorizeChange` / `CHANGE_CATEGORY_META` & `getNewlyFree`
  in `intelligence.ts`. `field_changed` uses: `added`, `removed`, `status_change`,
  `quota_change`, `rate_limit_change`, `pricing_change`, `provider_change`,
  `verification`.
- **Payment requirements** — tri-state: `required` / `not_required` / `unknown`
  (`PaymentRequirement` in `types.ts`). `unknown` is only set when the claim is not
  evidenced.
- **Confidence** — `verified` > `likely` > `unverified` > `stale`
  (`VerificationConfidence`).
- **Freshness tiers** — `live_verified`, `likely`, `unverified`, `seed_demo`, `stale`,
  `expired`, `unavailable` (computed in `classifyFreshness`, 30-day threshold).

Ranks and quality constants that must not be casually changed (they are validated by
tests): `ACCESS_QUALITY` in `queries.ts::scoreModel` and `QUALITY_ACCESS` in
`intelligence.ts::scoreRouteQuality` both rank `completely_free` / `free_local`
highest, `direct_api`/`free_tier` next, `community_unofficial` lowest.

---

## 6. Collectors

Location: `src/lib/collectors/`. This is the section an agent adding a new provider
must read end-to-end; the contract is spelled out in `COLLECTORS.md`.

**Common contract** (`types.ts`, `base.ts`):
- `Collector` = `discover() → RawModelListing[]`, `fetchPricing(id) → RawPricing`,
  `normalize(id, raw) → NormalizedAvailability`, `validate(a) → string[]`.
- `CollectorOrchestrator` = generic loop `discover → fetchPricing → normalize →
  validate → sink`. In production the provider-specific runners (`run.ts`) do this
  loop directly (they need richer idempotency/change-detection logic); the generic
  orchestrator + registry are demonstration/test infrastructure.
- **No collector touches SQLite directly.** All writes go through `DbCollectorSink`
  (`dbSink.ts`).
- **The sink** stamps `data_origin='live_collector'`, `verification_confidence='likely'`
  (never auto-promotes to `production`/`verified`), refreshes `last_verified_at`,
  appends history rows **only when a field actually changed** (idempotency), links
  sources, and flags removals by setting `is_active=0` / `status='unavailable'`.

There are **two real collectors** plus one example/stub:

### 6a. OpenRouter (`openrouter.ts` + `run.ts` + `dbSink.ts`)
- **Source / official URL:** `https://openrouter.ai/api/v1/models`
  (no auth required for the public catalog; docs at
  `https://openrouter.ai/docs/api/api-reference/models/get-models`).
- **Discovery:** one `GET /api/v1/models`; `parseCatalog` requires a `data` array.
- **Free classification (`classifyPricing`):** every usage-priced dimension known to
  OpenRouter must be **explicitly `0`** (or absent → treated as free):
  prompt, completion, request, image, web_search, internal_reasoning.
  - Positive number on any dimension ⇒ **paid** ⇒ model is dropped (not imported).
  - **Negative/sentinel (`-1`)** (routing/meta models like `openrouter/auto`) ⇒
    *cannot be asserted free* ⇒ not imported (prevents false positives).
  - Model name (e.g. a `:free` suffix) is **never** a classifier.
- **Normalization:** stable internal ids `openrouter__{author}/{slug}`; vision =
  `architecture.input_modalities` includes `image` (input, not output modality);
  `pricing` in string USD/token → `pricePerMillion` converts to USD/M tokens.
- **Provenance:** model-specific page `https://openrouter.ai/models/{slug}` as the primary
  evidence `source_url`; a single `src-openrouter-models-api` canonical source row.
- **Limits/payment semantics:** OpenRouter does **not** publish reliable per-model
  rate/request/token caps, so `rateLimitRpm/Tpm/daily/monthly` are `null`, and the
  import's note text encodes "usage limits not specified by source — NOT unlimited."
  `requires_payment_method = false` but `paymentRequirementKnown = false` (meaning
  "unknown" in UI).
- **Rate-limit handling:** `fetchJsonWithRetry` = 15s timeout, up to 3 retries with
  exponential backoff, retry on 5xx and 429 (honoring `Retry-After`), no retry on other
  4xx.
- **Idempotency:** rerun vs unchanged catalog → 0 writes, 0 duplicate rows.
- **Change detection:** paid→free → new route (with history); free→paid / gone →
  `markRemoved` (never `.stale` history loss); field change → update + history rows.
- **Partial/truncated guard (Scenario E):** if a previous successful run discovered
  `> 20` models and the new catalog returns `< 50%` of that count → refuse to mutate,
  record `failed`, warn. Cold start (no previous count) is never guarded.
- **Failure safety:** fetch happens first and is the only risky step; on error no
  model/availability/source row changes, only a `collector_runs` row.
- **CLI commands:** `npm run collect:openrouter`, `npm run collect:openrouter:dry`
  (both `tsx src/lib/collectors/cli.ts --collector=openrouter [--dry-run]`).
- **Admin execution:** `/admin` → CollectorRunner component
  (`adminRunCollector` server action) and `POST /api/admin/collect/openrouter` with
  `?dryRun=1`.

### 6b. Gemini / Google AI Studio collector (`gemini.ts`)
- **Source:** live catalog `GET https://generativelanguage.googleapis.com/v1beta/models`
  (**requires `GEMINI_API_KEY`**; 403 otherwise). Without a key the collector falls
  back to a bundled, clearly-labeled frozen snapshot `GEMINI_CATALOG_SNAPSHOT`.
- **Free tier:** transcribed from Google's official pricing docs into `GEMINI_FREE_TIER`
  (the free tier list at `https://ai.google.dev/gemini-api/docs`. Models *not present*
  in the table → unknown → not imported. Present-but-paid entries are handled
  explicitly (e.g. `gemini-3.1-pro-preview` is listed `free:false` so the paid status
  is asserted rather than "asserted-as-free").
- **Access type:** `direct_api` (proves a distinct claim vs the aggregator model).
- **Limits:**       **`rate_limit_rpm`→null (RPM/RPD dynamic per tier)**, `daily_limit`→null,
  `rate_limit_tpm` = the **published per-model token-rate limit** (real), context /
  max output captured from live API. Free routes: `requires_payment_method = 0`,
  `paymentRequirementKnown = true` (Google's billing page says Free tier doesn't need
  a card), `requires_api_key = 1`, `requires_signup = 1`.
- **Provenance:** 4 linked sources per route: models API / pricing / rate limits /
  billing (`src-gemini-*-…`) — "one claim, many evidence".
- **Idempotency / change detection / failure safety / partial guard:** same contract
  as OpenRouter (a near-identical guarded `runGeminiCollector`).
- **CLI:** `npm run collect:gemini`, `npm run collect:gemini:dry`, or
  `GEMINI_API_KEY=xxx npm run collect:gemini` for true live discovery.
- **Admin execution:** `/admin` CollectorRunner, or `POST /api/admin/collect/gemini`.

### 6c. Example / legacy pieces (not for production paths)
- `examples/openai.ts` — `OpenAICollector` stub to demonstrate the generic
  `Collector`/`Orchestrator` shape. It is only exercised by the unit test
  (`collectors.test.ts`) and referenced from `registry.ts`.
- `registry.ts` — generic registry of `[OpenAICollector, geminiCollector]`. **Not used
  by any app code path** (the runners are called directly); effectively an example
  contract.
- `collectors/actions.ts` — an **older near-duplicate** of `dbSink.ts` (defines
  `DbCollectorSink` with hardcoded OpenRouter attribution). It is **not imported
  anywhere** (dead code). `dbSink.ts` is the real sink. Do not "fix" the duplicate
  casually — decide whether to delete it. See section 14.

---

## 7. Unified Free Access Intelligence Layer  (`src/lib/intelligence.ts`)

Builds one representation — `FreeAccessRoute` — used by `/free`, the model detail
comparison table, the recommendation engine (`/best`), and the API. It deliberately
never collapses an unknown into a concrete value.

Key functions & semantics:

- **`buildFreeAccessRoutes(force?)`** — iterates the graph, includes every available
  route (`status` in available/limited/degraded/temporarily_free), and returns
  `FreeAccessRoute[]` with `qualityScore`, `explanation`, and `provenance`.
  **Caches** results in module state (`_routeCache`) until `invalidateRouteCache()`;
  note that `invalidateRouteCache()` is currently **never called** — the only "always
  fresh" caller is `/free`, which uses `buildFreeAccessRoutes()` without `force`, so
  a long-running server with a cached list could go stale after writes (see 14).
- **`filterFreeAccessRoutes(routes, filters)`** — orthogonal filters: `q`, `access[]`,
  `provider[]`, `harness`, `verified[]`, `freshness[]`, capability flags, `noCard`
  (strict == `not_required`), `noSignup`, `minContext`, `apiKeyRequired`.
  **Important:** `noCard` must match `r.paymentRequirement === "not_required"` — an
  `unknown` payment will never pass a no-card filter.
- **`scoreRouteQuality(a, m, fresh, sources)`** — returns a componentized score with
  an `unknownFlags[]` list. Unknown quota ⇒ capped low (score 4), never unlimited.
  Payment: known+not-required ⇒ +10, known+required ⇒ −6, unknown ⇒ neutral but added
  to `unknownFlags`. Caps total at 100.
- **`explainRoute(...)`** — natural-language "why is this free?" — always states
  unknown quantities ("limits displayed as unknown, not unlimited",
  "credit card unknown", "demo/seed data" when `dataOrigin === 'seed'`).
- **`recommendFreeAccess(req)`** — priority (`coding`/`reasoning`/`vision`/
  `longContext`/`general`), hard filters (noCard/noSignup/noApiKey/openSource/
  contextMin/harness), then ranks by `0.5 * qualityScore.total` + priority boosts,
  attaching `matchReasons` and `rankReasons` for the transparent "why" UI.
- **`categorizeChange(c)` / `getCategorizedChanges(changes)` / `CHANGE_CATEGORY_META`**
  — maps raw `field_changed` + old/new values into `became_free`, `became_paid`,
  `limit_increased/decreased`, `removed`, `restored`, `provider_changed`.
- **`canonicalModelKey(id)`** — strips the `{provider}__` prefix **and** the upstream
  `author/` path, e.g. `openrouter__google/gemma-4` → `gemma-4`. Used by
  `getCrossProviderRoutes` (SQL in `queries.ts`) to link the same logical model across
  providers. (Aggressively merging *different* models is prohibited — see section 10.)
- **`getDataQualityStats()`** — route-count, payment-requirement coverage + freshness
  breakdown + providers-with-unknown-card (for the admin transparency panel).

Edge cases to preserve: `free_local` routes never show "unknown" quota (they're
locally unbounded); `geoRestrictionsKnown` is true for free_local or when any
restriction is recorded; seed rows always surface a "demo/seed data" caveat.

---

## 8. Current UI

All pages are server components rendered `force-dynamic` (they hit SQLite at request
time).

| Route | File | What it does |
|---|---|---|
| `GET /` | `src/app/page.tsx` | Dashboard: stat cards; "Newly free (30d)" / "Recently removed (30d)" panels; alerts (seed, newly-free, removed, stale, unverified, contradictions); top-6 best free coding models; recent changes. |
| `/free` | `src/app/free/page.tsx` | "Free Right Now": all `FreeAccessRoute`s, filterable, each card shows free allowance, payment, access, context, capabilities, harnesses, quality score (`Q`), explanation/evidence details, provenance. Uses `buildFreeAccessRoutes` + `filterFreeAccessRoutes`. |
| `/models` | `src/app/models/page.tsx` | Model grid with `ModelCard`s + `FilterBar`; sort options. |
| `/models/[id]` | `src/app/models/[id]/page.tsx` | Model detail: per-route quality ("Free quota", rate limit, payment tri-state, access, warnings "not specified by source"), sources list, **cross-provider consolidated comparison table**, harness compatibility, change history, verification history, `dataQuality` flags. |
| `/providers` | `src/app/providers/page.tsx` | Cards of all providers/aggregators (free-tier + credits chips, freshness-derived tier, free-model counts). |
| `/providers/[id]` | `src/app/providers/[id]/page.tsx` | Provider detail: metrics, free models here, sources, change history. |
| `/harnesses` | `src/app/harnesses/page.tsx` | Harness cards + free-model counts. |
| `/harnesses/[id]` | `src/app/harnesses/[id]/page.tsx` | Compatibility table, citations, known limitations. |
| `/best` | `src/app/best/page.tsx` | Ranked sections (coding/reasoning/vision/long-context/OpenCode/Claude Code/no-card/aggregators) + interactive "Find a free model for your task" recommendation box (`recommendFreeAccess`). |
| `/changes` | `src/app/changes/page.tsx` | Change feed categorized by `CHANGE_CATEGORY_META`; filter by category. |
| `/compare` | `src/app/compare/page.tsx` | Client-side comparison tool; fetches `/api/models/free`, lets you pick up to 6 models and renders a property matrix. |
| `/admin` | `src/app/admin/page.tsx` | Verification queue (with per-route verify forms), contradiction table, data-quality transparency, "Live Collectors" (CollectorRunner + run history), "Add free-access route", "Report a change" moderation form. **Unauthenticated** (see section 14). |
| `/api-docs` | `src/app/api-docs/page.tsx` | Static JSON API documentation. |
| `/robots.txt` | `src/app/robots.ts` | Allow the public entity pages; disallow `/admin`, `/api/`, `/compare`. |
| `/sitemap.xml` | `src/app/sitemap.ts` | Dynamic sitemap from DB data. |
| `/` error pages | `error.tsx`, `not-found.tsx`, `layout.tsx` | App shell + error surfaces. |

Shared components: `ui.tsx` (badges: Access/Confidence/Freshness/Status/Category/Open),
`ModelCard.tsx`, `FilterBar.tsx` (client)), `Nav.tsx`, `DataBanner.tsx` (renders the
demo/live-state disclosure banner from `getDataState()`), `SeedBanner.tsx` (legacy
static banner), `CollectorRunner.tsx` (client, runs collectors via server action),
`CompareClient.tsx`.

---

## 9. Current API

All endpoints are `dynamic`, JSON, `runtime = "nodejs"`. Read endpoints read through
`queries.ts`; mutations are **server actions, not a JSON API** (see below).

**`GET /api/models/free`** (`src/app/api/models/free/route.ts`)
- Query params: `limit` (1–200, default 50), `offset`; `q`; `access` (comma-separated,
  supports aliases `aggregator/agg/openrouter` → free_through_aggregator, `direct`,
  `local`, `harness`, `credits`, `community`, `promo`); `verified`; `coding`, `vision`,
  `reasoning`, `toolCalling`, `structuredOutput`, `longContext`, `openSource`
  (truthy `true`/`1`); `provider`, `harness`; `noPayment`|`noCard`; `noSignup`;
  `apiKeyRequired`. `minContext`; `sort` (`relevance` default | `context` | `coding` |
  `recent` | `freshness` | `reliability`).
- Response: `{ count, limit, offset, filters, freshness (per-tier bucket),
  note, models: ModelView[] }`.

**`GET /api/models/[id]`** — single model with `score` breakdown, `harnessCompat`,
`sources`, `changes`.

**`GET /api/providers`** — paginated providers (`limit` 1–500, `offset`).

**`GET /api/providers/[id]/free-models`** — free models via a provider with per-route
freshness/limits/provenance flags.

**`GET /api/harnesses/[id]/free-models`** — models compatible with a harness (free).

**`GET /api/changes`** — recent categorized change feed; `limit`, `category`,
`provider`, `model` filters. `categoryCounts` map included.

**`GET /api/verification-queue`** — admin worklist; `provider`, `model`,
`severity` (`all|critical|warning|info`). Includes `contradictions` array and counts.

**`POST /api/admin/collect/openrouter`** and **`POST /api/admin/collect/gemini`** —
run a collector; `?dryRun=1` to dry-run. `GET` on the same route returns last 20 runs.
**These are administrative mutation endpoints with no auth** (section 14).

**Mutations (server actions, `src/lib/actions.ts`, no HTTP route):** `markVerified`,
`adminVerifyRoute`, `addAvailability`, `reportChange`, `adminRunCollector`. Invoked
from forms via Next server actions. **Unauthenticated.**

**Serialization (`src/lib/api.ts`):** `serializeModelView` shapes every `ModelView`
into the wire format; internal-only fields (e.g. `verificationNotes`) are intentionally
not exposed. The API and pages share `queries.ts`, so they can't disagree.

Errors: `{ error: string }` with non-200 (404 for missing entity, 500 for internal).

---

## 10. Trust / Data Correctness Rules

These are **load-bearing** invariants across the codebase. Do not weaken them.

- **Never fabricate quotas / limits.** If a source doesn't publish a limit, store
  `null` and say "unknown" in the UI, e.g.:
  `openrouter.ts` (free rows → all limits null + explicit "not specified by source"),
  `gemini.ts` (RPM/RPD null; only TPM known).
- **Unknown ≠ zero.** A missing payment requirement is a 3-state: `required`,
  `not_required`, `unknown`. `unknown` is rendered and filtered accordingly
  (`paymentRequirementOfArm`, `FreeAccessRoute.paymentRequirement`,
  `queryModels.noPayment`).
- **Unknown ≠ unlimited.** Ranking penalizes unknown quota
  (`scoreRouteQuality` exports `quota_unknown` flag); the model detail page renders an
  amber "limits not specified — NOT unlimited" note for live-collector rows without
  limits.
- **No-card access must be evidenced.** `paymentRequirementKnown` must be `true` before
  the UI claims "no card required". Seed rows default it to `false` unless the access
  type is self-evident (`free_local` with no key/signup) or explicitly supplied.
- **Free inference pricing ≠ no payment method.** `free_through_aggregator`/`free_tier`
  routes keep `requires_payment_method`/`paymentRequirementKnown` honest; e.g.
  OpenRouter free routes have `paymentRequirementKnown = false` because the catalog
  does not state it. Recommendation: never read "free" as "no card".
- **Collector failure must never present as mass removal.** The partial/truncated
  guard in `run.ts` (previous count `>20` and `<50%` of it) blocks all mutation of a
  suspicious response, and every failed run records a `failed` status — never success.
- **Historical records survive a route disappearing.** `markFieldDetected` marks
  `is_active=0` true + change_history row; nothing deletes the past; `change_history`
  & `verification_history` are append-only.
- **Live collector rows must not auto-become "human-verified".** The sink always stamps
  `data_origin='live_collector'` / `confident='likely'`; only `adminVerifyRoute`/
  `markVerified` may set `production`/`verified`.
- **Never attribute one provider's source to another.** Collector change/removal
  history must carry the *collector's own* source URL and note text — this was bug
  #1 and #4 (section 12). The fix adds per-run `sourceUrl`/`sourceNotes` overrides.
- **Conservative model identity > aggressive merging.** `canonicalModelKey` strips the
  aggregator `author/` prefix for *cross-provider comparison only*; it does **not**
  claim two models are identical; verify before assuming "same model".
- **Seed data is demo data.** `data_origin='seed'` rows are never rendered as
  live-verified (freshness = `seed_demo`), and `robots.ts` / banners make this clear.

---

## 11. Known Current State  (verified at HEAD `ceef6a0`)

| Item | Value (verified) |
|---|---|
| Branch / HEAD | `main`; latest commit `ceef6a0` (2026-08-16, "feat: harden admin authentication and CSRF protection") |
| Node / npm | v24.16.0 / 11.17.0 |
| Test run | 15 files, **189 tests passed** (`npm run test`, in-memory seeded DB) |
| Typecheck | `npm run typecheck` passes |
| Production build | `npm run build` passes; 25 App-Router routes, all `ƒ dynamic` except `_not-found` & `/api-docs` (`○`) |
| Routes (DB, live) | `data/freeai.db` — 86 active availability rows = **58 seed** + **28 live_collector** (19 OpenRouter + 9 Gemini) |
| Models | 50 total (25 curated seed + collector-imported `..` for OpenRouter/Gemini) |
| Providers | 19 (seed review) + `openrouter` (live_collector provider row) |
| Harnesses | 8 |
| Sources | 19 (`= 14 seed + collector sources`) |
| Collector runs | 3 recorded (OpenRouter success: discovered 413, 19 free; Gemini success: 10 discovered, 9 free; reused `src` source rows) |
| change_history | 46 rows (9 seed + live-collector+admin history) |
| verification_history | 28 rows (all relate to collector imports) |
| Seed dataset | 25 curated models; 61 seed availability rows; 14 seed sources; 9 sample changes; ~47 harness-compat rows |

Verified live `data/freeai.db` active availability by origin (a per-provider view):

```
cloudflare seed 3 · cohere seed 2 · deepseek seed 2 · groq seed 10 ·
huggingface seed 2 · mistral seed 2 · ollama seed 11 · openai seed 2 ·
openrouter live_collector 19 · openrouter seed 10 · google live_collector 9 ·
perplexity seed 1 · qwen seed 1 · together seed 12
```

**Caveats observed**
- `src/lib/collectors/actions.ts` is duplicate dead code (un-used `DbCollectorSink`,
  OpenRouter-hardcoded attribution).
- `invalidateRouteCache()` is defined but never called; `buildFreeAccessRoutes` holds a
  module-level cache (`_routeCache`) that nothing refreshes. In `force-dynamic` (fresh
  per-request) mode this is mostly invisible, but a long-lived process could serve
  stale route sets after writes until restart.
- `/admin` and all POST wrappers are unauthenticated (`ADMIN_SECURITY` lane for deploy).
- The OpenRouter collector's last run discovered **413** models but only 19 classified
  free — the `-1`/sentinel and paid rules are doing their job.
- `server.err` is empty/ignored (`gitignored`).

---

## 12. Recently Fixed Bugs

All four bugs below were found during the integration review and fixed in commit
`5f36149` (plus a fifth, unrelated, dashboard fix). Do **not** reintroduce them in the
dangerous ways — they are the exact failure modes the collector/harness harnesses test
for.

### a) Hardcoded OpenRouter source attribution (model-row change_history)
- **Root cause:** `DbCollectorSink.upsertModelRow(m)` always wrote
  `sourceUrl = OPENROUTER_SOURCE_URL` and note `"... in OpenRouter catalog"` — but it
  was also called by `runGeminiCollector`, so Gemini model changes were attributed to
  OpenRouter's catalog.
- **Fix:** `upsertModelRow(m, opts?: { sourceUrl, sourceNotes })`; both runners now
  pass their own source URL + note (`run.ts` passes `OPENROUTER_SOURCE_URL` or
  `GEMINI_SOURCE_CATALOG_URL`).
- **Files:** `src/lib/collectors/dbSink.ts`, `src/lib/collectors/run.ts`.

### b) snake_case/camelCase mapping → empty `new_value`
- **Root cause:** change detection compared DB columns (`context_window`,
  `official_page_url`, …) via `(m as any)[field]`, but the TS object uses camelCase
  (`contextWindow`, `officialPageUri`), so `new_value` was recorded as blank in
  `change_history` rows.
- **Fix:** added a `modelProp` snake→camel map used when reading the new value.
- **File:** `src/lib/collectors/dbSink.ts`.

### c) canonical model identity didn't strip author prefix
- **Root cause:** `canonicalModelKey` stripped the `{provider}__` prefix but **not** the
  upstream `author/` path, so `openrouter__google/gemma-4` did not match the seed model
  id `gemma-4`, and cross-provider consolidation tables missed aggregator routes.
- **Fix:** `canonicalModelKey` now also slices off everything through the first `/` after
  the prefix; the `getCrossProviderRoutes` SQL was updated with the equivalent CASE
  expression.
- **Files:** `src/lib/queries.ts`.

### d) Hardcoded OpenRouter attribution in removal history
- **Root cause:** `markRemoved()` hardcoded the OpenRouter source URL, the default
  reason string, and `verification_notes = "Removed from OpenRouter catalog…"` for
  **every** route, including Gemini's.
- **Fix:** choose defaults by comparing `existing.provider_id === GEMINI_PROVIDER_ID`,
  accept the catalog source URL as a param, and record it.
- **Files:** `src/lib/collectors/dbSink.ts` + call sites in `run.ts`.

(Also in the same commit: added the missing `'seed'` key to `ALERT_STYLE` in
`src/app/page.tsx`, which fixed a dashboard 500.)

---

## 13. Important Architectural Decisions

Do not casually reverse the following decisions. Any change to the data model should
go through `MIGRATIONS` + a test.

- **Single SQLite "one file" datastore** with a single cached `DatabaseSync` as the only
  data-access module — intentional; keeps deployment trivial. Do not add a DB server
  without a compelling reason.
- **Unified route/value model** (`FreeAccessRoute`) used by `/free`, `/best`,
  comparison, and API — one representation, many views.
- **Explicit "unknown" states** everywhere (freshness `seed_demo`/`unverified`,
  payment `unknown`, limits `null`), with honest UI labels.
- **Provenance is first-class** (`data_origin`, `verified_by`, `sources`,
  `collector_runs` audit).
- **Historical availability is preserved**: append-only change/verification history,
  no delete for removal, `resetDb()` never runs on a live instance except seeds.
- **Conservative canonical identity**: `canonicalModelKey` strips only the aggregator
  prefix/author — it does not merge/dedup models.
- **Collector abstraction: collectors never touch SQLite.** All writes go through
  `DbCollectorSink`. New provider = new `Collector` + runner, no page/API changes.
- **Failure safety.**: fetch-first execution, partial response guard, dry-run support.
- **No fake quota info.** Store `null` + "not specified" instead of inventing limits.
- **Freshness computed, not stored.**
- Read/write separation (`queries.ts` reads-only; `actions.ts`/`dbSink.ts` write-only)
  — the trust boundary that makes future auth drops-in.

---

## 14. Current Limitations (verified as NOT implemented)

- **No automated scheduler / cron.** Collectors only run on demand (CLI, `/admin`,
  HTTP POST). A typical cadence ("hourly") is not wired.
- **No notification system.** No email push / webhook / watchlist alerts for
  "became free" / "removed" changes. The `change_history` feed is best-effort.
- **No user accounts / subscriptions.** `watchlist` table doesn't exist.
- **Only two live provider collectors** (OpenRouter, Gemini). OpenAI/Anthropic/etc.
  have **seed/demo data only**; the example `OpenAICollector` is a stub.
- **No production authentication.** `/admin`, all mutating server actions, and both
  admin collect endpoints are unauthenticated. Documented path exists (gate
  `requireAdmin()`, derive `verified_by` from session) but not implemented.
- **Anonymous routes** — entity pages are public.
- **Search-facets duplication in DB** — the collector `id` may collide with seed ids for
  Google (`gemini-2.5-flash` etc.), meaning a Google run can overwrite a seed route's
  provenance flags. (Verified: after the Gemini run, `data/freeai.db` shows Google
  routes as `live_collector`, including the seed-era ones.)
- **The `modelsRemoved` report counter is always 0** — the removal loop only deactivates
  availability *routes* (`markRemoved` on the row), never the `models` table itself, so a
  model disappearing entirely is not counted as a removed model.
- **Dead duplicate file:** `src/lib/collectors/actions.ts` (unused copy of `dbSink.ts`).
- **`invalidateRouteCache()` never wired** — see section 11 caveat.

---

## 14a. Automated Scheduler Architecture Assessment (NEW — 2026-08-16)

The next planned phase ("Automated Free-Model Monitoring") requires deciding **where the scheduler runs**. The current architecture has a critical constraint:

### SQLite is a local file — GitHub Actions does NOT work for this architecture

| Problem | Details |
|---------|---------|
| **SQLite is local file** | `data/freeai.db` lives on the deployment machine's disk |
| **`data/` is gitignored** | Not in version control |
| **No shared DB server** | No external DB (PostgreSQL, Turso, PlanetScale, Neon) |
| **Vercel is stateless** | Cannot receive DB updates from Actions runner |

**Running collectors on GitHub Actions would update a throwaway database that disappears when the workflow ends. The production app would never see those changes.**

### Recommended Architecture

| Deployment Target | Scheduler Solution |
|-------------------|-------------------|
| **Linux VPS / bare metal / Docker** | Native `cron` / `systemd timer` / supercronic sidecar — runs on **same machine** as Next.js app, shares `data/freeai.db` |
| **Windows Server** | Windows Task Scheduler |
| **Vercel / serverless** | **Not compatible** with local SQLite — would need external DB (Turso/libSQL, Neon, PlanetScale) first, then GitHub Actions cron becomes viable |

### Implementation Plan (for Linux/VPS/Docker deployment)

1. **Add `scripts/collect-all.ts`** — sequential runner:
   ```typescript
   import { runOpenRouterCollector, runGeminiCollector, formatRunReport } from "@/lib/collectors/run";
   
   async function main() {
     const openRouterReport = await runOpenRouterCollector({ dryRun: false });
     console.log(formatRunReport(openRouterReport));
     if (openRouterReport.status === "failed") process.exit(1);
     
     const geminiReport = await runGeminiCollector({ dryRun: false });
     console.log(formatRunReport(geminiReport));
     if (geminiReport.status === "failed") process.exit(1);
   }
   main();
   ```

2. **Add npm script** to `package.json`:
   ```json
   "collect:all": "tsx scripts/collect-all.ts"
   ```

3. **Document cron setup** in `README.md` / `DEPLOYMENT.md`:
   ```bash
   # Hourly - adjust path to your deployment
   0 * * * * cd /path/to/FreeModelWatch && /usr/bin/npm run collect:all >> /var/log/freemodelwatch-collect.log 2>&1
   ```

### Why NOT GitHub Actions?

1. **Cannot persist SQLite changes to production** — Actions runner has ephemeral filesystem
2. **No shared database** — Would need external DB (Turso/Neon) first
3. **Parallel execution risk** — Both collectors query `currentActive` at start; racing on same DB file needs inter-process locking (not implemented)
4. **Deployment target undefined** — Current architecture assumes single-machine SQLite

---

The next major phase is **Automated Free-Model Monitoring** with the following shape
(design first, then implementation):

```
Scheduler
  → collectors (OpenRouter, Gemini, more)
  → validation / failure safety
  → change detection
  → persisted events
  → notifications
```

**Do not implement this phase unless explicitly asked.** The architecture needs to be
designed before code: where the scheduler lives (in-process `setInterval`? a cron job
separate process? a Vercel/serverless cron), how the notifications are delivered
(email/webhook/in-app "watchlist"), and how the "_newly free_ / _removed_" feed
turns into "a user subscribed to model X was notified".

Existing seams that already support it:
- `collector_runs` already records every run for audit.
- `change_history` already records `detection` with `change_category` semantics.
- `getNewlyFree` / `getRecentlyRemoved` extract monitorable events from history.
- The `change_source = 'automated'` rows are distinct from manual entries.

---

## 16. Proposed Next Steps (staged, solo-developer friendly)

**Prerequisite decision:** Confirm deployment target before implementing scheduler.

| Target | Scheduler Approach |
|--------|-------------------|
| Linux VPS / Docker / bare metal | Native `cron` / `systemd timer` / supercronic sidecar (Option A below) |
| Windows Server | Windows Task Scheduler |
| Vercel / serverless | **Blocked** — must migrate to external DB first (Turso, Neon, PlanetScale), then GitHub Actions cron |

### Option A: Native OS Scheduler (if deploying to Linux/VPS/Docker)

1. **Add `scripts/collect-all.ts`** — sequential runner:
   ```typescript
   import { runOpenRouterCollector, runGeminiCollector, formatRunReport } from "@/lib/collectors/run";
   
   async function main() {
     const openRouterReport = await runOpenRouterCollector({ dryRun: false });
     console.log(formatRunReport(openRouterReport));
     if (openRouterReport.status === "failed") process.exit(1);
     
     const geminiReport = await runGeminiCollector({ dryRun: false });
     console.log(formatRunReport(geminiReport));
     if (geminiReport.status === "failed") process.exit(1);
   }
   main();
   ```

2. **Add npm script** to `package.json`:
   ```json
   "collect:all": "tsx scripts/collect-all.ts"
   ```

3. **Document cron setup** in `README.md` / `DEPLOYMENT.md`:
   ```bash
   # Hourly - adjust path to your deployment
   0 * * * * cd /path/to/FreeModelWatch && /usr/bin/npm run collect:all >> /var/log/freemodelwatch-collect.log 2>&1
   ```

4. **Verify in clean container** before deploying:
   ```bash
   docker run --rm -v $(pwd):/app -w /app node:24 bash -c "npm ci && npm run collect:all"
   ```

### Option B: External DB + GitHub Actions (if staying on Vercel)

1. Provision Turso (libSQL) or Neon PostgreSQL
2. Update `db.ts` to connect via HTTP/WebSocket
3. Set `DATABASE_URL` in Vercel + GitHub Actions secrets
4. Then GitHub Actions cron workflow can run collectors against shared DB

### Staged Implementation Order (after deployment target chosen)

1. **Scheduler skeleton** — add `collect-all.ts` + `collect:all` script + cron docs
2. **Lock/guard** — add simple mutex in `collector_runs` to prevent overlapping runs
3. **Notification layer** — introduce `watch_entries` table; emit events from `getNewlyFree`/`getRecentlyRemoved` (already implemented)
4. **New-provider collectors** — Anthropic (check if free tier exists), Cloudflare Workers AI, Groq, DeepSeek — each as new `Collector` + `run<Provider>Collector`
5. **Auth** — gate `/admin` and mutating actions; record `verified_by` from session

**Do not implement until deployment target is confirmed.** The architecture of the scheduler depends entirely on where the SQLite file lives.

---

## 17. Development Commands

From `package.json` (all verified against the repo):

```bash
npm run dev                     # next dev (localhost:3000)
npm run build                   # next build (verified ✓)
npm run start                   # next start (serve build)
npm run typecheck               # tsc --noEmit (passes)
npm run lint                    # next lint
npm run test                    # vitest run (in-memory seeded DB; set FREEAI_DB_PATH)
npm run collect:openrouter      # tsx cli.ts --collector=openrouter  (LIVE)
npm run collect:openrouter:dry  # tsx cli.ts --collector=openrouter --dry-run
npm run collect:gemini          # tsx cli.ts --collector=gemini       (LIVE)
npm run collect:gemini:dry      # tsx cli.ts --collector=gemini --dry-run
```

Important test-runtime detail: `vitest.config.ts` sets `FREEAI_DB_PATH=:memory:` and
`vitest.setup.ts` reseeds the DB per-run, so `npm run test` never touches
`data/freeai.db`.

The CLI dry-run mode fetches + normalizes without writing.

---

## 18. Important Files

| Path | Role |
|---|---|
| `src/lib/types.ts` | All shared domain types + enums (`AccessType`, `DataOrigin`, freshness/tier, tri-state `PaymentRequirement`). |
| `src/lib/db.ts` | `getDb()`/`resetDb()`, schema (CREATE TABLE), `MIGRATIONS` (additive), seed backfalls. |
| `src/lib/queries.ts` | Read layer (`loadGraph`, model views, freshness, scoring, contradictions, verification queue, `canonicalModelKey`). |
| `src/lib/actions.ts` | Mutating server actions (verify/… , add route, report, run collector). No auth. |
| `src/lib/intelligence.ts` | Free-route model, scoring, filtering, recommendations, change categorization, transition detection, data-quality stats. |
| `src/lib/api.ts` | JSON serialization for wire endpoints. |
| `src/lib/format.ts` | Labels/maps for access, freshness, payment, confidence, origins, formatting helpers. |
| `src/lib/seed-data.ts` | Seed providers + 25 curated models. |
| `src/lib/seed-availability.ts` | Seed availability (61 routes), 14 sources, 47 harness-compat rows, 9 changes. |
| `src/lib/seed.ts` | `seedDatabase()` — destructive reseed of all tables. |
| `src/lib/collectors/types.ts` | `Collector` / `CollectorTrade` interfaces. |
| `src/lib/collectors/base.ts` | Generic `CollectorOrchestrator` (example/test only). |
| `src/lib/collectors/openrouter.ts` | Reference collector: classification (zero/−1/sentinel), normalization, HTTP retry, source consts. |
| `src/lib/collectors/gemini.ts` | 2nd collector: official snapshot + free-tier transcription + 4-source provenance. |
| `src/lib/collectors/run.ts` | End-to-end runner for both collectors (idempotency/change-detect/failure-safety guards + report). |
| `src/lib/collectors/dbSink.ts` | **The only DB-writer** for collectors (stamps `live_collector`, appends history). |
| `src/lib/collectors/cli.ts` | CLI entry (`--collector=`, `--dry-run`). |
| `src/lib/collectors/registry.ts` | Example registry (OpenAI stub + gemini). |
| `src/lib/collectors/examples/openai.ts` | Example/legacy `OpenAICollector` stub. |
| `src/lib/collectors/actions.ts` | ⚠ dead duplicate of `dbSink.ts` (not imported; do not touch casually). |
| `src/app/api/*` | JSON route handlers (models/free, model detail, providers, harnesses, changes, verification-queue, admin/collect). |
| `src/app/{page,free,models,providers,harnesses,best,changes,compare,admin,api-docs}` | UI routes (section 8). |
| `src/components/` | Shared UI + `nav`, `FilterBar`, `CollectorRunner`, `CompareClient`. |
| `docs/DATABASE_DESIGN.md` / `ARCHITECTURE.md` / `COLLECTORS.md` / `API.md` / `DATA_VERIFICATION.md` / `CONTRIBUTING.md` | The existing living decision documents. This HANDOFF supersedes none of them; it anchors them to verified current state. |

---

## 19. AI Agent Instructions

For future coding agents working in this repo:

- **Inspect before modifying.** Read the relevant module + at least one of
  `ARCHITECTURE.md` / `COLLECTORS.md` / `API.md` before editing.
- **Preserve the architecture.** The layered shape (reads in `queries.ts`, writes in
  `actions.ts`/`dbSink.ts`, serialization in `api.ts`, derived-instead-of-stored
  freshness) is intentional. Don't restructure without cause.
- **Do not fabricate data.** Any UI/API text that claims a concrete rate/limit/payment
  fact must trace to a source in the DB. Read "unknown" as "unknown".
- **Don't blindly trust seed data.** `data_origin='seed'` rows are demo data, not
  facts. Verify against a live source before bleeding them into recommendations.
- **Don't add dependencies without reason.** The dep surface is tiny (`next`, `react`,
  tailwind, tsx, vitest, typescript, @types/*). Prefer plain Node/native features.
- **Run tests after any change:** `npm run test`.
- **Run typecheck + build after meaningful changes:** `npm run typecheck`, then
  `npm run build`.
- **Make small, verifiable changes.** One logical change per commit, with a test when
  behavior changes (the collector contract is well-tested; keep it that way).
- **Don't implement future-roadmap items** (scheduler, notifications,
  subscriptions, extra providers, auth) unless explicitly your session goal.
- **Report what was actually verified.** Distinguish "I checked the source/ran the
  test" from "that's how it should be best be".
- **Separate bugs from architectural preferences.** If you prefer a different scoring
  constant or a different UI layout, say "preference", not "bug". Flag true data-
  correctness or data-loss bugs separately.

---

## 20. Handoff Checklist

A new agent should verify the following before the first change, to prove the
environment + dataset assumptions below still hold:

1. **Repo state** — `git status` clean-ish, `main` (latest `ceef6a0`) is the running
   base.
2. **Toolchain** — `node --version` ≥ 22.5 (24.16 used), `npm ci` produces no errors.
3. **Tests** — `npm run test` → 189 passing / 15 files; `npm run typecheck` clean;
   `npm run build` completes with no route errors.
4. **DB sanity** — `npm run dev` boots, `/` renders with the DataBanner; either
   `data/freeai.db` exists with the counts in section 11, or a fresh marketing seed +
   a collector run rebuilds it. Check `SELECT data_origin, count(*) FROM availability
   WHERE is_active=1 GROUP BY data_origin`.
5. **Collectors work locally** — `npm run collect:openrouter:dry` and
   `npm run collect:gemini:dry` complete (network may need backend; Gemini falls back
   to snapshot without a key).
6. **Pages render** — spot-check `/` (dashboard), `/free`, `/models`, `/best`,
   `/changes`, `/admin`, `/models/gemini-2.5-flash` to confirm no 500s (the dashboard
   alert style bug from commit `5` is fixed).
7. **Enforced rules still drop-visible** — take one live route (e.g. an `openrouter__…`
   route) and confirm: `data_origin='live_collector'`, `verification_confidence=`,
   no invented rate limits, "limits not specified" note visible, history rows exist.
8. **Auth gap acknowledged** — confirm `/admin` is reachable unauthenticated (expected
   until auth lands; don't be surprised).

After this checklist, you may work. When you finish, either update this document or
add a "handoff updated at <date>" section with what changed so the next agent doesn't
re-derive it.