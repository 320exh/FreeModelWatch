# API

All endpoints return JSON and are **server-rendered on demand** (`dynamic`). They read from
the same `queries.ts` layer the UI uses, so the API and the pages never disagree.

Base URL: `/api`

## GET /api/models/free

Free models with their available routes. Supports pagination, filtering, and freshness
metadata.

Query params:
- `limit` (1–200, default 50), `offset` (default 0)
- `access` — comma-separated `AccessType` values (e.g. `completely_free,free_tier,direct_api,free_through_aggregator`)
- `verified` — `true` to require `verification_confidence = 'verified'`
- `noCard` — `true` to exclude models that require a payment method
- `harness` — harness id; only models compatible with it
- `provider` — provider id
- `q` — free-text search
- `sort` — `context` | `coding` | `recent` | `freshness` | `reliability`
- `collection_mode` — comma-separated `CollectionMode` values (e.g. `live`, `frozen`, `seed`, or `live,frozen`). Filters to models having at least one availability route with the specified collection mode(s). A model may appear in results for multiple collection modes if it has routes in multiple modes.

Response:
```json
{
  "models": [ /* ModelView */ ],
  "total": 64,
  "limit": 50,
  "offset": 0,
  "freshness": { "live_verified": 12, "likely": 30, "unverified": 0, "seed_demo": 22, "stale": 0, "expired": 0, "unavailable": 0 },
  "note": "Routes are classified by collection_mode: 'live' (live collector), 'frozen' (collector fallback), or 'seed' (curated demo data). Routes with collection_mode 'seed' or 'frozen' are NOT live-verified. Check the `freshness` and `collection_mode` fields per route."
}
```

Each `ModelView` includes `routes`, each route carrying `availability`, `provider`,
`freshness` (computed tier), `collectionMode` (one of `live`, `frozen`, `seed`), and `sources` (linked evidence). The model also carries `bestFreshness`, `bestCollectionMode` (the highest-ranked collection mode among its routes, determined by the same ranking system used for `scoreModel`), and a `dataQuality` flag (`live` | `mixed` | `seed` | `stale`).

**Important:** `collection_mode` and `data_origin` are distinct concepts:
- `collection_mode=live` — live collector data (live_collector data_origin)
- `collection_mode=frozen` — frozen collector fallback (data_origin is seed, but represents a collector snapshot)
- `collection_mode=seed` — curated demo/seed data (data_origin is seed)
- `data_origin=seed` encompasses both curated seed and frozen collector fallback rows; use `collection_mode` to distinguish them.

Aliases: `verified=1` is accepted as `verified=true`; `noCard=1` as `noCard=true`.

## GET /api/models/[id]

A single model with its routes, harness compatibility, linked sources, change history, and
verification history. Response includes a `score` breakdown (`scoreModel`) and `dataQuality`.

## GET /api/providers

Paginated provider list (with free-model counts).

## GET /api/providers/[id]/free-models

Free models available through one provider, each with `freshness` and `sources`.

## GET /api/harnesses/[id]/free-models

Free models usable through one harness (coding agent), with `freshness`.

## GET /api/changes

Recent `change_history` entries (moderation + verification log). `limit` / `offset` supported.

## GET /api/verification-queue  (new)

The admin verification worklist, sorted by urgency.
Query params: `provider`, `model`, `severity` (`all` | `critical` | `warning` | `info`).
Each item: `{ availabilityId, modelName, providerName, accessType, status, confidence,
freshness, dataOrigin, lastVerifiedAt, ageDays, reason, urgency }`.

## Wire shape notes
- Serialization lives in `src/lib/api.ts`. API responses never leak internal-only fields
  that aren't part of the `ModelView`/`Source` shapes (e.g. `verification_notes` is not
  surfaced unless you extend `serializeModelView`).
- Errors return `{ error: "..." }` with a non-200 status for missing resources.

## Mutations
There is no public JSON write API. Mutations happen through **server actions** in
`src/lib/actions.ts` (`adminVerifyRoute`, `markVerified`, `addAvailability`, `reportChange`),
invoked from forms on `/admin` and `/models/[id]`. These are **not authenticated** yet
(see `CONTRIBUTING.md`).
