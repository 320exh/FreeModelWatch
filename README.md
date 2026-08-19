# FreeAI.today

A tracker for which AI models are available for **free** — across direct provider APIs,
aggregators, cloud credits, local/hosted OSS, and coding
harnesses. It emphasizes **verified, fresh data** with transparent
rankings and a clear separation between demo/seed data and live-confirmed data.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **`node:sqlite`** (Node 22+/24) as the single datastore — no separate DB server
- **Vitest** for unit/integration tests

> Requires Node 22.5+ (the `node:sqlite` builtin). Developed on Node 24.16.

## Scripts

```bash
npm run dev        # start dev server (http://localhost:3000)
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run test       # vitest run (in-memory DB, seeded)
```

## Data & freshness model

The database is seeded from `src/lib/seed-data.ts` + `src/lib/seed-availability.ts` via
`seedDatabase()`. Seeded rows are marked `data_origin = 'seed'` so the UI shows them as
**demo data**, never as "live verified". Real data should be entered through the admin
verification workflow (`/admin`) or automated collectors (see `src/lib/collectors/` and
`COLLECTORS.md`). Two live collectors exist: **OpenRouter** (`free_through_aggregator`) and
**Gemini / Google AI Studio** (`direct_api`). A live collector writes
`data_origin = 'live_collector'` (auto, **not** human-verified) and
`verification_confidence = 'likely'`. Only an explicit admin verification
promotes a row to `data_origin = 'production'` / `verification_confidence = 'verified'` — the
collector never does this on its own.

Key concepts:

- **Freshness tiers** (`live_verified`, `likely`, `unverified`, `seed_demo`, `stale`,
  `expired`, `unavailable`) are computed from `data_origin`, `verification_confidence`, and
  `last_verified_at` — not stored redundantly.
- **Verification history** is append-only: every verification writes a `verification_history`
  row and a `change_history` row, so nobody can silently rewrite the past.
- **Contradiction detection** (`detectContradictions`) flags quality problems: a provider
  claiming two conflicting free-access types for the same model, "completely_free" routes
  that require a payment method, expired-but-still-available promos, etc.

## Layout

```
src/lib/
  db.ts              # connection, schema, additive migrations, resetDb
  types.ts           # all shared types (incl. DataOrigin, FreshnessTier)
  seed-data.ts       # providers + models
  seed-availability.ts / seed.ts  # availability, sources, links, harness compat, changes
  queries.ts         # reads: filtering, ranking, freshness, queue, contradictions
  actions.ts         # server actions: verify / add / report (mutations)
  api.ts             # serialization for API routes
  format.ts          # labels, freshness/access maps, helpers
  collectors/        # future data-collector framework (see ARCHITECTURE.md)
src/app/
  page.tsx           # dashboard
  models/ providers/ harnesses/ best/ changes/ compare/ admin/
  api/               # JSON endpoints (see API.md)
```

## Documentation

- `DATABASE_DESIGN.md` — schema as implemented
- `ARCHITECTURE.md` — layering, data flow, and the collector roadmap
- `COLLECTORS.md` — **live collector contract, how to run them, what "free" means, and the
  checklist every new provider collector must satisfy**
- `API.md` — JSON API surface
- `DATA_VERIFICATION.md` — how freshness/verification works and the admin security model
- `CONTRIBUTING.md` — adding models/providers/collectors, and the auth TODO

## Admin security (read this before deploying)

Authentication is implemented via **HTTP Basic Auth** with a single admin identity.
Before deploying, you **must** set the following environment variables:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=salt:derived_key_hex
```

Generate a password hash:

```bash
node -e "
const { scrypt, randomBytes } = require('crypto');
const { promisify } = require('util');
const scryptAsync = promisify(scrypt);
const salt = randomBytes(16).toString('hex');
const password = 'your-strong-password';
(async () => {
  const dk = await scryptAsync(password, salt, 64);
  console.log(salt + ':' + dk.toString('hex'));
})();
"
```

- `/admin` and all `/admin/*` routes are protected by middleware.
- All mutating server actions (`markVerified`, `adminVerifyRoute`, `addAvailability`, `reportChange`, `adminRunCollector`) independently verify credentials via `requireAdmin()`.
- `POST /api/admin/collect/openrouter` and `POST /api/admin/collect/gemini` require authentication.
- `GET /api/admin/collect/*` (read-only status) remain accessible.
- CLI collector execution (`npm run collect:openrouter`, `npm run collect:gemini`) bypasses HTTP auth and works directly.
- The authenticated username becomes `verified_by` on all mutations; collector identities (`collector:openrouter`, `collector:gemini`) are preserved for automated runs.
- **Never deploy without HTTPS** — Basic Auth sends credentials on every request.
