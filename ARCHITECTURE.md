# Architecture

FreeModelWatch is intentionally a **thin, layered Next.js app** over a single SQLite file.
There is no ORM, no separate API server, and no background worker — all data access goes
through one module.

## Layers

```
UI (React Server Components, app/*, components/*)
        │  call
        ▼
queries.ts   ── read paths (filtering, ranking, freshness, queue, contradictions)
actions.ts   ── write paths  (server actions: verify / add / report)
        │  both use
        ▼
api.ts       ── (de)serialization for JSON routes (keeps DB rows out of the wire shape)
        │
        ▼
db.ts        ── single DatabaseSync connection + schema + migrations
        │
        ▼
SQLite (data/freeai.db  ·  FREEAI_DB_PATH for tests / ephemeral)
```

### Why this shape
- **One connection.** `getDb()` caches a `DatabaseSync` on `globalThis`. Every query funnels
  through it, so there is exactly one place to add pooling, logging, or (later) a read
  replica.
- **Read vs write split.** `queries.ts` is pure reads; `actions.ts` is the only place that
  mutates. This makes the trust boundary explicit and makes it easy to gate writes behind
  auth later.
- **No N+1.** `loadGraph()` loads the whole graph once (models, providers, availability,
  harness compat, sources) and builds lookup maps. Per-model enrichment (`enrichModel`)
  joins from memory, so a page that lists 25 models issues ~1 graph load, not 25+ queries.
- **Compute freshness, don't store it.** Freshness tiers are derived in `classifyFreshness`
  from `data_origin` + `verification_confidence` + `last_verified_at`. Storing a cached tier
  would drift; deriving it keeps it honest.

## Data flow — verifying a route

```
Admin form (app/admin)  ──►  adminVerifyRoute(action)  ──►  UPDATE availability
                                                        └──►  INSERT verification_history (old → new)
                                                        └──►  INSERT change_history
                                                        └──►  revalidatePath(...)
```

The verification is **immutable**: the live row moves to the new status/confidence, but the
previous values are always captured in `verification_history` and `change_history`.
`reportChange` (the moderation queue) inserts an **unverified** `change_history` row; an
admin later confirms it via `adminVerifyRoute` or `markVerified`.

## Ranking

`scoreModel` returns a transparent, componentized score:

```
total = capability + freeAccess + reliability + freshness + availability
```

- `capability` — coding/reasoning/vision/tool-calling signal of the underlying model.
- `freeAccess` — best access quality across the model's routes **(does not sum route count)**.
- `reliability` — driven by `verification_confidence` (verified > likely > unverified > stale).
- `freshness` — driven by the computed `FreshnessTier`.
- `availability` — current `status` of the best route.

Crucially, a model is **not** rewarded for having more aggregator routes. More routes only
help if they improve the *best* access quality or freshness. See `API.md` and the UI's
score-breakdown chips on `/best`.

## Future architecture — collectors (src/lib/collectors)

The product is designed to support many data sources without rewriting the app. Each
provider gets one **Collector**:

```
Collector (knows one upstream)
  discover()        → list external model ids
  fetchPricing(id)  → raw pricing/availability JSON
  normalize(id,raw) → NormalizedAvailability (stable internal ids)
  validate(a)       → string[] (issues)

CollectorOrchestrator
  run() → for each model: fetchPricing → normalize → validate → sink.upsert*(...)
```

`CollectorSink` (e.g. `DbCollectorSink`) is the **only** thing that writes to the database.
Collectors therefore never touch SQLite directly, which keeps them trivially unit-testable.
New providers are added by implementing one `Collector` and registering it in
`src/lib/collectors/registry.ts` — no changes to queries, pages, or the API.

The example `OpenAICollector` (under `collectors/examples/`) shows the shared `Collector`
shape with stubbed network calls. The **OpenRouter collector** (`collectors/openrouter.ts` +
`collectors/run.ts` + `collectors/dbSink.ts`) is the first *real* collector and is the reference
implementation — it fetches the live catalog, normalizes with stable ids, classifies free
pricing (handling OpenRouter's `-1` sentinel), writes only through `DbCollectorSink`, and records
`collector_runs` history. See `COLLECTORS.md` for the full contract and the checklist every new
provider collector must satisfy.

The **Gemini / Google AI Studio collector** (`collectors/gemini.ts` + `runGeminiCollector`) is
the second real collector. It proves a distinct product claim — a **direct provider API free
tier** (`access_type = direct_api`) — versus OpenRouter's **aggregator** free inference
(`access_type = free_through_aggregator`). Both collectors import via the same `DbCollectorSink`
and follow the identical failure-safety / idempotency / change-detection contract; they differ
only in their official sources, their `free` classification rule, and how they handle limits
(Gemini captures the published per-model TPM but stores RPM/RPD as `null` because Google does not
publish a fixed public grid). The admin UI (CollectorRunner), CLI, and `adminRunCollector`
action run either collector independently.

## Known limitations / future work
- User watchlists/alerts (the earlier design draft's `user_watchlist`) are not implemented.
- The verification queue is computed on read; for very large datasets it could be
  materialized, but current volumes don't need it.
- Admin auth is not implemented (see `CONTRIBUTING.md`).
