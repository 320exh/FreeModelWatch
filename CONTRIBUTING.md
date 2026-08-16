# Contributing

## Setup

```bash
npm install
npm run dev        # http://localhost:3000
npm run test       # vitest (in-memory seeded DB)
npm run typecheck
npm run build
```

Requires Node 22.5+ (`node:sqlite`). The test suite points `FREEAI_DB_PATH=:memory:`
via `vitest.config.ts` so it never touches `data/freeai.db`.

## Project layout (where to put things)

- **Reads** go in `src/lib/queries.ts` (filtering, ranking, freshness, queue, contradictions).
- **Writes** go in `src/lib/actions.ts` (server actions only — the single trust boundary).
- **Types** go in `src/lib/types.ts`. Keep `DataOrigin` / `FreshnessTier` in sync there.
- **Seed data** lives in `src/lib/seed-data.ts` (providers, models) and
  `src/lib/seed-availability.ts` (availability, sources, harness compat, changes).
- **UI** lives under `src/app/*` and `src/components/*`.

## Adding a model / provider / route

### Quick (manual)
1. Add the provider to `PROVIDERS` in `seed-data.ts` (or via the DB directly).
2. Add the model to `MODELS`.
3. Add an availability route with `av({ modelId, providerId, accessType, ... })` in
   `seed-availability.ts`, and any supporting `sources`.
4. Run `npm run dev` — the DB auto-seeds on first read. To force a reseed, delete
   `data/freeai.db` (or set `FREEAI_DB_PATH=:memory:`).

### Preferred (verified)
Use `/admin` → **Add free-access route** (writes `data_origin`/`confidence` honestly) or the
verification form to confirm an existing route. This creates a proper `verification_history`
entry.

## Adding a data collector (future)

1. Create `src/lib/collectors/examples/<Provider>Collector.ts` implementing the `Collector`
   interface (`discover`, `fetchPricing`, `normalize`, `validate`).
2. Register it in `src/lib/collectors/registry.ts`.
3. Run it through `CollectorOrchestrator` with a `CollectorSink` (the default
   `DbCollectorSink` writes via the same server actions). **Do not** import `db.ts` from
   inside a collector — all writes go through the sink.

Collectors are unit-tested in isolation (`src/lib/__tests__/collectors.test.ts`).

## Schema changes

Add new columns via the `MIGRATIONS` array in `src/lib/db.ts` (idempotent `ALTER TABLE`).
Never drop/recreate the database in a migration — existing deployments must upgrade in place.
Backfill defaults in `createConnection()` if needed.

## ADMIN_SECURITY (must do before deploy)

`/admin` and the mutating server actions (`adminVerifyRoute`, `markVerified`,
`addAvailability`, `reportChange`) are **unauthenticated**. The codebase documents this in
`src/lib/actions.ts` and `DATA_VERIFICATION.md`. To ship safely:

1. Add an auth check (e.g. `requireAdmin()`) at the top of each mutating action.
2. Derive `verified_by` from the session instead of the form field.
3. Lock down `/admin` (redirect/403 when unauthenticated).
4. Add CSRF protection to the forms and basic rate limiting.

The `verified_by` column already exists on `availability`, `change_history`, and
`verification_history`, so no schema change is needed.

## Tests

- Put tests next to code as `*.test.ts` under `src/lib/__tests__/`.
- Keep the DB access through `queries.ts` / `actions.ts`; never construct SQL in tests.
- The `vitest` config mocks `node:sqlite` with the real module so tests run in plain Node.
