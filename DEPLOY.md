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

  > **Production note (non-blocking maintenance):** the live deployment currently runs
  > **Node v22.23.2** (the 22.13+ line, so `node:sqlite` works unflagged). DEPLOY.md recommends
  > Node ≥ 24; an upgrade to ≥ 24 is a tracked future task, not done yet. Do not upgrade Node as
  > part of documentation/config work.
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
  `https://freemodelwatch.example`). In production this is set to `https://freeai.today`.
  The canonical hostname is the apex `freeai.today`; both `www.freeai.today` and
  `freemodelwatch.freeai.today` return a 301 redirect to `https://freeai.today/`.
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

> **Provision the persistent data directory before the scheduler runs.** The lock file is
> `data/.collect.lock`, and `flock` opens it **before** the collector initializes the database
> (which would otherwise create `data/`). On a completely fresh host the collector timer could
> fire before the web app has created `data/`, and `flock` would fail. Create it once,
> explicitly, owned by the app user:
>
> ```bash
> install -d -o <app-user> -g <app-user> -m 0755 /opt/freemodelwatch/data
> ```
>
> The systemd unit below also guards against this with an `ExecStartPre` `mkdir -p`.

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
WorkingDirectory=/opt/freemodelwatch
EnvironmentFile=/opt/freemodelwatch/.env.local
ExecStart=/usr/bin/npm run start -- -p 3000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/freeai-collect.service` (invoked by a matching `.timer`)
```ini
[Service]
WorkingDirectory=/opt/freemodelwatch
EnvironmentFile=/opt/freemodelwatch/.env.local
Type=oneshot
# Ensure the persistent data directory exists BEFORE flock opens the lock file,
# so a fresh-host timer tick can never fail on a missing data/ dir.
ExecStartPre=/usr/bin/mkdir -p /opt/freemodelwatch/data
ExecStart=/usr/bin/flock -n /opt/freemodelwatch/data/.collect.lock /usr/bin/npm run collect:all
ExecStartPost=/usr/bin/systemctl restart freeai
```

**Restart semantics (matches the route-cache boundary in §6):** for a `Type=oneshot` unit,
`ExecStartPost` runs **only if** `ExecStart` (the `flock` + `collect:all` command) exits
**0**. So:
- a **successful/partial** collect (exit 0) → `freeai` is restarted, clearing the stale
  in-memory route cache;
- a **failed** collect (non-zero) or a **locked-out** `flock -n` (non-zero) → the unit is
  marked failed and **`freeai` is NOT restarted**.

This gives the exact documented behavior: refresh the web cache on success, do not churn it
on failure. The timer just needs the service name; a `.timer` unit like:

```ini
[Unit]
Description=FreeModelWatch collector timer
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
```

Enable both the timer and the web service with `systemctl enable --now freeai.timer freeai`.

## 8. Post-deploy validation

Run the deployment smoke test against the live instance (from the project root on the host,
with the same env as the app — it never prints secret values):

```bash
npm run smoke:deploy -- --base-url http://localhost:3000
# fuller run (runs the collector + exercises web restart; supply the plaintext admin password to
# verify a successful login):
SMOKE_ADMIN_PASSWORD='<admin password>' npm run smoke:deploy -- --base-url https://<domain> --collector --restart
```

It reports PASS/FAIL/SKIP for: required/optional env config, public endpoint availability,
DB readability, unauthenticated admin rejection (401), admin auth with valid/invalid
credentials (when `SMOKE_ADMIN_PASSWORD` is set), the `collect:all` exit-code contract
(`--collector`), systemd unit/timer structure and activity (`--unit freeai`), and DB
persistence across a web restart (`--restart`). Non-destructive by default.

## 9. Production deployment (verified baseline)

This section records the **known-good production state** as the canonical reference. Treat it
as the baseline; do not change it as part of documentation/config work.

- **Host**: Oracle Cloud Ubuntu VM (Always Free, $0). Project path `/opt/freemodelwatch`.
- **Canonical URL**: `https://freeai.today/` (HTTP 200).
  - `https://www.freeai.today/` → 301 → `https://freeai.today/`
  - `https://freemodelwatch.freeai.today/` → 301 → `https://freeai.today/`
  - HTTP on all three hostnames → HTTPS redirect.
- **TLS**: Let's Encrypt, valid. Terminated by **Caddy** (`/etc/caddy/Caddyfile`), active.
- **App**: Next.js served on `127.0.0.1:3000`; fronted by Caddy. Managed by systemd
  service **`freeai`** (active). Collector timer: **`freeai.timer`** (runs `freeai-collect`).
- **Env**: `SITE_URL=https://freeai.today`.
- **UFW**: active, default-deny incoming; `22/tcp`, `80/tcp`, `443/tcp` allowed. No
  unexpected pre-UFW iptables REJECT rules remain. Do not reset UFW.
- **Oracle**: resources remain Always Free / $0. Do not enable any paid resource.
- **DNS**: authoritative/public DNS resolves `freeai.today` → `161.153.82.168` (Google DNS
  confirmed). Do **not** change production DNS — see maintenance item §10.4.

## 10. Maintenance backlog (non-blocking)

Tracked future tasks. None block the current healthy deployment; do not fix as part of
documentation/config work.

1. **Node upgrade.** Production runs Node v22.23.2; DEPLOY.md recommends Node ≥ 24. Plan an
   upgrade to ≥ 24 (verify `node:sqlite` + `next build` first). See §1.
2. **Caddyfile formatting.** Run `caddy fmt` on `/etc/caddy/Caddyfile` to normalize formatting.
   Cosmetic; no behavioral change intended.
3. **`Server Reference ID did not match` errors.** Monitor for recurrence of the transient
   Next.js errors after future restarts/deployments; investigate only if they persist.
4. **ISP resolver NODATA.** The user's local ISP resolver currently returns NODATA for
   `freeai.today`, while Google DNS (`8.8.8.8`) resolves it correctly to `161.153.82.168`. This
   is a **local resolver issue, not a production DNS failure** — authoritative/public DNS is
   working. Do not change production DNS or Cloudflare to "fix" the local resolver.
