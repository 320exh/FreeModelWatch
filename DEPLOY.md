# Deployment — FreeAI.today

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
git clone https://github.com/320exh/freeai.today.git && cd freeai.today
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
  `https://example.com`). In production this is set to `https://freeai.today`.
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
> install -d -o <app-user> -g <app-user> -m 0755 /opt/freeai/data
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
Description=FreeAI.today
After=network.target

[Service]
WorkingDirectory=/opt/freeai
EnvironmentFile=/opt/freeai/.env.local
ExecStart=/usr/bin/npm run start -- -p 3000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/freeai-collect.service` (invoked by a matching `.timer`)
```ini
[Service]
WorkingDirectory=/opt/freeai
EnvironmentFile=/opt/freeai/.env.local
Type=oneshot
# Ensure the persistent data directory exists BEFORE flock opens the lock file,
# so a fresh-host timer tick can never fail on a missing data/ dir.
ExecStartPre=/usr/bin/mkdir -p /opt/freeai/data
ExecStart=/usr/bin/flock -n /opt/freeai/data/.collect.lock /usr/bin/npm run collect:all
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
Description=FreeAI.today collector timer
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

- **Host**: Oracle Cloud Ubuntu VM (Always Free, $0). Project path `/opt/freeai`.
- **Canonical URL**: `https://freeai.today/` (HTTP 200).
  - `https://www.freeai.today/` → 301 → `https://freeai.today/`
  - `https://freemodelwatch.freeai.today/` → 301 → `https://freeai.today/`
  - HTTP on all three hostnames → HTTPS redirect.
- **TLS**: **Cloudflare Origin CA** (cert `/etc/caddy/origin-ca/freeai.today.crt`, key
  `/etc/caddy/origin-ca/freeai.today.key`), valid. The Cloudflare proxy is set to SSL/TLS
  **Full (strict)**, so only the matching Origin CA cert is accepted. **Caddy**
  (`/etc/caddy/Caddyfile`) terminates TLS with this cert; the previous Let's Encrypt config is
  backed up at `/etc/caddy/Caddyfile.bak.le`. Do not revert to Let's Encrypt without also
  updating Cloudflare SSL/TLS mode.
- **App**: Next.js served on `127.0.0.1:3000`; fronted by Caddy. Managed by systemd
  service **`freeai`** (active). Collector timer: **`freeai.timer`** (runs `freeai-collect`).
- **Env**: `SITE_URL=https://freeai.today`.
- **UFW**: active, default-deny incoming. Inbound `80/tcp` and `443/tcp` are allowed **only
  from the Cloudflare IPv4 + IPv6 ranges**; `22/tcp` is allowed **only from admin IP
  `108.247.52.154`**. No unexpected pre-UFW iptables REJECT rules remain. Do not reset UFW.
- **Oracle**: resources remain Always Free / $0. Do not enable any paid resource. The OCI
  Security List (stateful; no NSG attached) permits inbound `80/tcp` and `443/tcp` **only from
  the Cloudflare IPv4 ranges**, and `22/tcp` **only from `108.247.52.154/32`**; `3000/tcp` is
  not exposed. Egress is all-allowed.
- **DNS**: authoritative/public DNS resolves `freeai.today` → `161.153.82.168` (Google DNS
  confirmed). Do **not** change production DNS — see maintenance item §10.4.

### 9.1 Network perimeter (verified lockdown)

Both network perimeters (OCI Security List and host UFW) were tightened so the origin is
reachable only through Cloudflare, and administrative SSH is restricted to the operator's
current public IP. Verified end-to-end on 2026-08-18.

| Layer             | Port            | Allowed from …                                  | Blocked from          |
|-------------------|-----------------|-------------------------------------------------|-----------------------|
| OCI Security List | 80/tcp, 443/tcp | Cloudflare IPv4 ranges only                     | everything else       |
| OCI Security List | 22/tcp          | `108.247.52.154/32` only                        | everything else       |
| OCI Security List | 3000/tcp        | not exposed                                     | everything            |
| UFW               | 80/tcp, 443/tcp | Cloudflare IPv4 + IPv6 ranges only              | everything else       |
| UFW               | 22/tcp          | `108.247.52.154` only                           | everything else       |

Consequences (verified):
- The public site works **only through Cloudflare** (`https://freeai.today/` → 200;
  `www`/`freemodelwatch` → 301). All three DNS records are proxied (orange-cloud) under
  Cloudflare SSL/TLS **Full (strict)**, and the origin presents the **Cloudflare Origin CA**
  certificate.
- **Direct access to the origin** (`161.153.82.168:80` / `:443` from a non-Cloudflare IP) is
  blocked at both perimeters.
- OCI has no IPv6 Cloudflare rule because the VNIC has no global IPv6 address; Cloudflare
  reaches the origin over IPv4. The UFW IPv6 Cloudflare rules are therefore defensive only.

### 9.2 Operational caveat — admin SSH is IP-restricted

SSH (port 22) is intentionally locked to the operator's **current public IP
`108.247.52.154`** at both the OCI Security List and UFW. If that public IP changes (e.g., the
operator's ISP reassigns it, or the connection is made from a different network), **SSH — and
therefore all administrative access — will be refused** until the allow-lists are updated.

To recover or change the allowed IP:
- **OCI**: edit the Security List ingress rule `22/tcp` → `108.247.52.154/32` (console only;
  cannot be changed over SSH).
- **UFW**: `sudo ufw allow from <new-ip> to any port 22`, then remove the old rule
  (`sudo ufw delete allow from 108.247.52.154 to any port 22`, or by number via
  `sudo ufw status numbered`).
- **Out-of-band fallback**: if locked out, use the OCI **Instance Console Connection**
  (VNC/serial) to regain shell access and repair the rules.

### 9.3 Security contact & inbound email (`security@freeai.today`)

`security@freeai.today` is a **functional inbound email address** used as the project's
published security contact. Cloudflare Email Routing receives the mail and forwards it to a
verified external destination; the Oracle server does **not** run a mail server.

**Public security contact (`security.txt`).** The live site serves
`https://freeai.today/.well-known/security.txt` (verified HTTP 200) containing:

```text
Contact: mailto:security@freeai.today
```

This file is served directly by **Caddy on the Oracle Cloud server**, **outside the Git
repository** — it is not version-controlled with the application. A repository-only audit will
therefore not reveal where the security contact address is defined.

**Inbound flow.** `security@freeai.today` → Cloudflare Email Routing → verified external
destination. Cloudflare Email Routing is enabled and active (`status: ready`); the routing rule
forwards `security@freeai.today` to a verified external destination. The destination is
intentionally **not documented here** for privacy.

**Verification.** The path was tested end-to-end: an email sent to `security@freeai.today`
arrived at the destination inbox (initially classified as spam by Gmail, then marked "Not spam"
and received successfully).

**Email authentication (auto-configured by Cloudflare Email Routing — do not hand-edit):**

- **MX**: three records `freeai.today` → `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`,
  `route3.mx.cloudflare.net` (Cloudflare-managed).
- **SPF**: `v=spf1 include:_spf.mx.cloudflare.net ~all`. (The record was originally
  `v=spf1 -all`; Cloudflare Email Routing changed it automatically when routing was enabled. Do
  not treat the old `-all` value as current.)
- **DKIM**: Cloudflare-managed record at `cf2024-1._domainkey.freeai.today`.
- **DMARC**: `v=DMARC1; p=reject; adkim=s; aspf=s; pct=100` (unchanged).

**Scope.** This is **inbound email forwarding only**. Outbound email sending from `@freeai.today`
is **not** configured.

**Admin address.** `admin@freeai.today` is **not** currently configured — do not assume it exists
or is functional. It may be added later if needed.

**External configuration note.** The Cloudflare Email Routing setup (routing rule, destination
address, and the MX/SPF/DKIM records above) lives in Cloudflare, **outside the Git repository**. A
repository-only audit will not reveal the `security@freeai.today` forwarding rule. Manage it via
the Cloudflare dashboard or `scripts/cloudflare.ps1` (§11).

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

## 11. Cloudflare API access (local credentials)

Cloudflare API operations for `freeai.today` are performed from the local machine with a small
PowerShell helper, so tokens never enter source, commits, or chat.

- **Credentials are stored in `.env.local`** at the project root (gitignored — see §3). It holds
  exactly two variables and **must NEVER be committed**:
  - `CF_READ_TOKEN` — for **read-only** Cloudflare API operations.
  - `CF_WRITE_TOKEN` — for Cloudflare **configuration changes** (mutations).
- **Helper:** `scripts/cloudflare.ps1`. It loads `CF_READ_TOKEN` / `CF_WRITE_TOKEN` from
  `.env.local` (session-scoped, nothing written to disk) and exposes:
  - `CF` — read-only calls (`CF_READ_TOKEN`).
  - `CFw` — mutating calls (`CF_WRITE_TOKEN`).
- **OpenCode / Hy3 sessions:** OpenCode launches PowerShell with `-NoProfile`, so the profile
  dot-source is not loaded. When Cloudflare access is needed, dot-source the helper explicitly
  from the project root:
  ```powershell
  . scripts/cloudflare.ps1
  ```
- **Rules:** never paste Cloudflare token values into source code, documentation, commits, or
  chat; never commit `.env.local`.
- **Lost credentials?** Inspect the persistent `.env.local` setup (and the profile dot-source)
  **before** creating new tokens. No token values are kept in this repository.
