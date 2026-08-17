# Deployment — FreeModelWatch

Verified deployment-readiness for the decided target: a **persistent Linux host** running
`next start` (Node ≥ 22.5, persistent SQLite, co-located scheduler). **No source or config
changes were required to deploy.** This document records the verified prerequisites and the
exact commands. Architecture decisions are closed — see `docs/HANDOFF.md` §14c.

## 1. Prerequisites (Linux host)

- **Node.js**: use **Node ≥ 24** (recommended) — `node:sqlite` is unflagged and stable there.
  Node 22.13+ / 23.4+ also work (unflagged, still experimental). **Avoid Node 22.5–22.12**,
  which require starting Node with `--experimental-sqlite` (would have to be threaded through
  `next start`). The app uses the built-in `node:sqlite`; there are no extra native
  dependencies.
- **npm** (ships with Node). A `package-lock.json` is committed, so `npm ci` is reproducible.
- A **writable, persistent directory** for the database (default `data/` under the project
  root). Back this volume up — it is the only stateful store.
- (Recommended) a **reverse proxy** (Caddy/nginx) terminating TLS in front of `next start`.
- (Recommended) a **process manager** — a systemd service is the simplest — to keep the app
  alive and to host the scheduler timer.

## 2. Build & install

```bash
git clone <repo> && cd FreeModelWatch
npm ci
npm run build          # `next build` — safe on a clean host; it does NOT touch the DB.
```

The SQLite file and seed data are created automatically on the **first request**
(`queries.ts` → `ensureSeeded()`), so no manual seeding step is needed.

## 3. Environment variables

Create `.env.local` in the project root (it is gitignored).

**REQUIRED**
- `ADMIN_PASSWORD_HASH` — scrypt hash for the admin user. Generator is in `.env.example`.
  `/admin` throws if this is missing, so it must be set in production.

**OPTIONAL**
- `ADMIN_USERNAME` — default `admin`.
- `SITE_URL` — public base URL for `sitemap.xml` / `robots.txt` (default
  `https://freemodelwatch.example`).
- `GEMINI_API_KEY` — enables live Google Gemini discovery; without it the Gemini collector
  falls back to the bundled official snapshot.
- `FREEAI_DB_PATH` — absolute path to the SQLite file (default `<cwd>/data/freeai.db`). Keep
  the default unless you redirect the whole `data/` volume; the scheduler lock file lives
  next to it.

> `OPENROUTER_API_KEY` is listed in `.env.example` but is **not** read by the code
> (OpenRouter is fetched from its public API). It can be omitted.

## 4. Start (persistent web server)

Run from the project root so `data/` resolves to `<cwd>/data`:

```bash
npm run start            # next start (default port 3000)
# pin a port:  npm run start -- -p 3000
```

Put it behind the reverse proxy and manage it with systemd (see §7), not a bare foreground
shell.

## 5. Collector command (scheduler)

Runs OpenRouter + Gemini sequentially, failure-isolated; exits non-zero only if a collector
fails/crashes (a `partial` run is still exit 0). **Safe to invoke repeatedly** — upserts are
idempotent and `flock` serializes overlapping runs:

```bash
flock -n data/.collect.lock npm run collect:all
```

`collect:all` resolves the DB via the same cwd/`data` (or `FREEAI_DB_PATH`), so run it from
the project root with the same env as the web server.

## 6. Known limitation — cross-process route cache

`buildFreeAccessRoutes()` caches results in an in-memory module singleton **inside the running
`next start` process**. Server actions invalidate it in-process, but the scheduled collector
runs in a **separate process** (`tsx`), so after `collect:all` the web server's cache is stale
until it is invalidated. Pragmatic ops fix (no code change): restart the web service after each
collection, e.g. in the same timer unit:

```bash
flock -n data/.collect.lock npm run collect:all && systemctl restart freeai
```

Keep to a **single `next start` instance** — the cache is per-process.

## 7. Minimal systemd sketch (reference, not committed)

`/etc/systemd/system/freeai.service`
```ini
[Unit]
Description=FreeModelWatch
After=network.target

[Service]
WorkingDirectory=/srv/freemodelwatch
EnvironmentFile=/srv/freemodelwatch/.env.local
ExecStart=/usr/bin/npm run start -- -p 3000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/freeai-collect.service` (invoked by a matching `.timer`)
```ini
[Service]
WorkingDirectory=/srv/freemodelwatch
EnvironmentFile=/srv/freemodelwatch/.env.local
Type=oneshot
ExecStart=/usr/bin/flock -n /srv/freemodelwatch/data/.collect.lock /usr/bin/npm run collect:all
ExecStartPost=/usr/bin/systemctl restart freeai
```
