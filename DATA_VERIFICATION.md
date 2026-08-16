# Data Verification & Freshness

The whole point of FreeModelWatch is trustworthy "is this model free right now?" data.
This document explains how that is enforced in code.

## Three questions every row answers

1. **Where did it come from?** — `data_origin`
   - `seed` — bundled demo data. Explicitly **not** a live claim.
   - `production` — confirmed against a real source by a human/admin.
   - `user_report` — submitted via the moderation queue, pending confirmation.
   - `collector` — written by an automated collector (treated like `user_report` until confirmed).
2. **How confident are we?** — `verification_confidence`
   - `verified` (confirmed) > `likely` (plausible, single source) > `unverified` > `stale`.
3. **When was it last checked?** — `last_verified_at`.

## Freshness tiers (`classifyFreshness`)

Computed, never stored:
- `live_verified` — `data_origin = 'production'` AND `confidence = 'verified'` AND recent.
- `likely` — plausible but not confirmed (`likely`), or seed claim.
- `unverified` — no positive verification.
- `seed_demo` — `data_origin = 'seed'`. **Shown distinctly** so demo data can't masquerade
  as live.
- `stale` — `data_origin != 'seed'` and `last_verified_at` older than `STALE_THRESHOLD_DAYS`
  (30).
- `expired` — a `temporarily_free` / promotional row whose `expires_at` is in the past.
- `unavailable` — the route is currently down.

The UI surfaces this via `<FreshnessBadge>` and the `dataQuality` flag on every model view,
plus a dashboard alert when seed data is present.

## Immutable verification history

`adminVerifyRoute` / `markVerified` update the live `availability` row **and** append a
`verification_history` row capturing `previous_confidence` / `previous_status` → new values,
plus `verified_by` and `notes`. They also append a `change_history` row. Nothing overwrites
the past; an auditor can reconstruct the full timeline for any route.

## Verification queue

`getVerificationQueue({ provider, model, severity })` computes the worklist on read:
- Routes whose `last_verified_at` is old or missing.
- Routes whose `expires_at` is approaching/over.
- Routes derived from seed data (need a real confirmation).
- Routes with low confidence.
Items are scored by `urgency` and the admin UI sorts most-urgent first.

## Contradiction / data-quality detection

`detectContradictions()` scans for:
- `free_requires_payment` — `completely_free` but `requires_payment_method`.
- `local_requires_key` / `local_requires_signup` — self-hosted routes that shouldn't need auth.
- `free_has_price` — a "free" route with a non-zero price.
- `future_verification` — verification date in the future.
- `expired_still_available` — promo expired but still marked available.
- `provider_unavailable` / `provider_requires_card` — provider-level conflicts.
- `missing_source` — a claim with no linked source.
- `missing_quota` — a free route with no recorded quota.
- **`same_provider_conflicting_access`** (critical) — the same provider/model asserts two
  different free-access types on verified/likely rows.
- `same_provider_conflicting_status` — same provider/model reported both available and unavailable.

The admin page lists these under **Data Quality · Contradictions** and the dashboard shows a
count + alert.

## Security model

Authentication is implemented via **HTTP Basic Auth** (see `src/lib/auth.ts`, `src/middleware.ts`).
Required environment variables: `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (scrypt hash).

Protected surfaces:
- `/admin` and `/admin/*` — middleware enforces Basic Auth (401 + WWW-Authenticate)
- All mutating server actions in `actions.ts` — each calls `requireAdmin()` at entry
- `POST /api/admin/collect/openrouter` and `POST /api/admin/collect/gemini` — explicit auth check
- `GET /api/admin/collect/*` — read-only status, no auth required

The authenticated username is written to `verified_by` on all mutations.
Collector identities (`collector:openrouter`, `collector:gemini`) are preserved for automated CLI runs.

CLI collector execution (`npm run collect:openrouter`, `npm run collect:gemini`) bypasses HTTP auth.

**Never deploy without HTTPS** — Basic Auth sends credentials on every request.
