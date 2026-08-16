# Live Collectors

This document is the contract for FreeModelWatch's automated data collectors. The **OpenRouter
collector** (`src/lib/collectors/openrouter.ts`) is the first live collector and is the
**reference template** for every provider that follows.

> Other providers in the app (OpenAI, Anthropic, Google, etc.) may still contain **seed/demo
> data** only. Seed data is curated for the UI but is explicitly *not* live-verified.

## How to run the OpenRouter collector

```bash
# LIVE — writes to the database (data_origin = 'live_collector')
npm run collect:openrouter

# DRY RUN — fetches + normalizes, reports what would change, writes nothing
npm run collect:openrouter:dry

# Or programmatically
import { runOpenRouterCollector } from "@/lib/collectors/run";
await runOpenRouterCollector({ dryRun: false });
```

You can also run it from the admin UI (`/admin` → "Live Collectors") which shows a
loading/success/failure banner and the run history.

## How often should it run?

OpenRouter's free catalog changes frequently (models added, promoted, or removed). A reasonable
cadence is **hourly** via cron, with the dry-run available for CI/smoke checks. The collector is
idempotent: re-running against an unchanged catalog performs **zero** writes and creates **no**
duplicates or spurious history.

## What "free" means in FreeModelWatch

A model is classified **free** only when **every** usage-priced dimension OpenRouter exposes is
explicitly `0` (zero cost):

- `prompt`, `completion`, `request`, `image`, `web_search`, `internal_reasoning`

Rules (see `classifyPricing` in `openrouter.ts`):

- A **missing** dimension is treated as free (assumed zero).
- A **positive** number on any dimension ⇒ **paid** ⇒ not imported.
- A **negative** price (OpenRouter uses `"-1"` as a sentinel for routing/meta models like
  `openrouter/auto` whose price is *not* a fixed per-token amount) ⇒ **cannot be asserted free**
  ⇒ **not imported**. This protects against false positives.
- The model name (e.g. a `:free` suffix) is **never** trusted on its own.

### Free does NOT mean unlimited

OpenRouter's catalog does **not** publish reliable per-model rate limits, request caps, or token
quotas. The collector therefore records, for every free route:

> Free inference pricing; usage limits (rate / request / token caps) are **not specified by the
> source**.

The model detail page surfaces this explicitly so users never read "free" as "unrestricted".

## What the collector CAN and CANNOT determine

| Can determine (from the API)            | Cannot determine (must not invent)        |
| --------------------------------------- | ----------------------------------------- |
| Model id, name, context window          | Rate limits / request caps / token quotas |
| Input & output modalities (incl. vision)| Uptime / SLA                              |
| Pricing (zero vs paid vs -1 sentinel)   | "Unlimited" usage                         |
| Reasoning / tool-calling support        | Whether a free tier will persist          |
| Per-model official page (source URL)    | Business intent of the provider           |

## Source accuracy

Every free route links to its **model-specific** OpenRouter page
(`https://openrouter.ai/models/{slug}`) as the primary evidence — clicking it lands on the exact
claim. A single authoritative `sources` row (`src-openrouter-models-api`) is attached as the
canonical catalog provenance; this is deliberate (one row, not 400 near-identical ones). The
model-specific `source_url` is what the UI surfaces first.

## The standard interface every future collector must satisfy

Copy this checklist when adding a provider. The OpenRouter collector is the reference
implementation.

### 1. Official source
- One documented, stable endpoint/URL that is the authoritative source for pricing/availability.
- If the provider has no public, stable source, **do not** build a collector.

### 2. Discovery
- Determine the full set of model ids the upstream exposes (OpenRouter returns them all in one
  call; other providers may need paging).

### 3. Normalization
- Map raw fields into `NormalizedModel` / `NormalizedAvailabilityRow` with **stable internal ids**
  (`{provider}__{externalId}`).
- **Vision** = input modalities that include `image` (multimodal understanding), *not* output
  modalities (image generation).
- Never trust model names for free/paid classification.

### 4. Free classification
- Define an explicit, documented rule for "free" (OpenRouter: all usage dimensions == 0).
- Handle sentinel/unknown values (e.g. `-1`) as **not free**, never as free.
- Distinguish `zero_cost_inference` from `paid` / `unknown`.
- Record *why* a model is free (the `free.reason` string powers the "Why is this free?" UI).

### 5. Provenance
- Write `data_origin = 'live_collector'` and `verification_confidence = 'likely'`.
- **Never** auto-promote to `production` / `verified` — only an admin verification does that.
- Link a model-specific source URL as primary evidence.

### 6. Idempotency
- Re-running against an unchanged catalog produces **zero** writes and **zero** duplicate rows.
- Reordering the upstream list must not create changes.

### 7. Change detection
- Paid → free: create availability + `change_history` (old → new values).
- Free → paid / disappeared: mark `is_active = 0`, `status = 'unavailable'` (**not deleted**),
  preserve `change_history` and `verification_history`.
- Field change (e.g. context length): update current value, preserve history.

### 8. Removal detection
- A free route absent from a subsequent catalog is marked removed/inactive, never deleted.

### 9. Failure safety
- The network fetch happens **first**; if it fails, **no** model/availability/source row is
  touched.
- Malformed JSON, HTTP errors, timeouts, empty/partial responses, and incomplete model objects
  must leave existing data intact and be reported as `failed` (with a warning where relevant).
- **Partial/truncated responses**: guard against mass-removal. If a run returns far fewer models
  than the previous successful run (e.g. `< 50%` when a previous run discovered `> 20`), refuse to
  mutate existing data and report the suspicious response.

### 10. Dry run
- Support a dry-run mode that reports would-be changes without writing.

### 11. Tests
- Unit tests for classification (incl. sentinel/negative prices) and normalization (vision, etc.).
- Integration tests for all five change-detection scenarios (A–E) using deterministic fixtures.
- Failure-safety tests proving existing data is untouched across timeout/HTTP/malformed/empty/
  incomplete/unexpected-format inputs.
- Idempotency + reordering tests.

### 12. Collector run history
- Every run (success/partial/failed, dry/live) records a `collector_runs` row with discovered /
  free / added / changed / removed counts, errors, and warnings, so the admin UI can audit it.

## Template (skeleton)

```ts
// src/lib/collectors/<provider>.ts
export const <PROVIDER>_PROVIDER_ID = "<provider>";
export const <PROVIDER>_SOURCE_ID = "src-<provider>-models";
export const <PROVIDER>_SOURCE_URL = "https://..."; // authoritative catalog

export function classifyPricing(p: Pricing | null): FreeClassification { /* explicit rule */ }
export function normalizeModel(raw: Raw): NormalizedModel { /* stable ids, vision=input, provenance */ }
export class <Provider>Collector {
  async fetchCatalog(opts): Promise<Raw[]> { /* fetch + retry/timeout */ }
}
```

Then wire it into `runOpenRouterCollector`-style orchestration (a `run<Provider>Collector`
function) and register it for the admin UI. Keep all DB writes inside `DbCollectorSink` so the
collector itself remains trivially testable and side-effect-free.
