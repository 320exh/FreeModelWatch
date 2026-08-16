# API

All endpoints return JSON and are **server-rendered on demand** (`dynamic`). They read from
the same `queries.ts` layer the UI uses, so the API and the pages never disagree.

Base URL: `/api`

## GET /api/models/free

Free models with their available routes. Supports pagination, filtering, and freshness
metadata.

Query params:
- `limit` (1–200, default 50), `offset` (default 0)
- `access` — comma-separated `AccessType` values (e.g. `completely_free,free_tier`)
- `verified` — `true` to require `verification_confidence = 'verified'`
- `noCard` — `true` to exclude models that require a payment method
- `harness` — harness id; only models compatible with it
- `provider` — provider id
- `q` — free-text search
- `sort` — `context` | `coding` | `recent` | `freshness` | `reliability`

Response:
```json
{
  "models": [ /* ModelView */ ],
  "total": 61,
  "limit": 50,
  "offset": 0,
  "freshness": { "live_verified": 0, "likely": 0, "seed_demo": 61, "stale": 0, "expired": 0, "unavailable": 0, "unverified": 0 }
}
```

Each `ModelView` includes `routes`, each route carrying `availability`, `provider`,
`freshness` (computed tier), and `sources` (linked evidence). The model also carries
`bestFreshness` and a `dataQuality` flag (`{ seedData: boolean, hasUnverified: boolean,
hasStale: boolean }`).

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
