# FreeModelWatch — OpenCode Handoff

> Technical handoff for an autonomous OpenCode coding/operations agent taking over the existing FreeModelWatch deployment and public-reachability investigation.
>
> Handoff date: 2026-08-18
>
> **Evidence rule:** Every important state item is labeled `CONFIRMED`, `LIKELY`, `UNKNOWN`, or `SUPERSEDED`. Do not promote an inference to a fact.

---

## 1. Mission

Take over the existing FreeModelWatch deployment and determine exactly why the application is not currently reachable through its intended public domain.

Do not redesign the application or rebuild Oracle infrastructure. Inspect the deployment as it exists, identify the first failing layer, make the smallest evidence-based fix, and verify end-to-end reachability.

Expected request path:

```text
Browser
  ↓
freeai.today / production hostname
  ↓
Cloudflare DNS / proxy
  ↓
Oracle public IP
  ↓
Oracle VCN / subnet / route / VNIC
  ↓
Oracle security list / NSG
  ↓
Ubuntu
  ↓
UFW
  ↓
Caddy / reverse proxy
  ↓
FreeModelWatch Node/Next.js application
```

---

## 2. Project Overview

**CONFIRMED:** FreeModelWatch is the user's application for tracking/monitoring free AI models and related availability.

**CONFIRMED:** It is deployed on an Oracle Cloud Ubuntu VM.

**CONFIRMED:** The project path is `/opt/freemodelwatch`.

**CONFIRMED:** The application uses a local SQLite database; the deployed database path is `data/freeai.db`.

**CONFIRMED:** The application is a Next.js application using Node/npm.

**CONFIRMED:** The application has been successfully built and has been locally verified as serving HTTP 200.

**CONFIRMED:** The application is intended to be publicly served over HTTP/HTTPS, with the public web ports handled separately from the Next.js application port.

---

## 3. Current Status — Executive Summary

### What is already working

**CONFIRMED:** Oracle VM exists and is operational.

**CONFIRMED:** A reserved public IP has been configured for the VM.

**CONFIRMED:** Repository is deployed at `/opt/freemodelwatch`.

**CONFIRMED:** `.env.local` exists/configuration was established. Never expose its values.

**CONFIRMED:** `data/freeai.db` exists.

**CONFIRMED:** `npm ci` completed successfully:

```text
added 96 packages, and audited 97 packages in 9s
25 packages are looking for funding
  run `npm fund` for details
found 0 vulnerabilities
```

**CONFIRMED:** `npm run build` completed successfully.

**CONFIRMED:** A systemd service was configured for the application.

**CONFIRMED:** UFW is active and allows inbound TCP 22, 80, and 443.

**CONFIRMED:** The application has returned HTTP 200 on localhost.

**CONFIRMED:** The latest socket inspection showed Next.js listening on `*:3000`.

### What is still unresolved

**UNKNOWN:** Whether OCI security-list/NSG rules currently permit 80/443.

**UNKNOWN:** Whether Caddy is installed, configured, running, and listening on 80/443.

**UNKNOWN:** Whether the exact production hostname resolves to the reserved public IP.

**UNKNOWN:** Whether an AAAA record is interfering.

**UNKNOWN:** Cloudflare proxy status and SSL/TLS mode.

**UNKNOWN:** Whether public TCP 80/443 connections reach the VM.

**UNKNOWN:** Whether the public hostname reaches Caddy and then Next.js.

The root cause must not be guessed.

---

## 4. Confirmed Facts

| Item | Status | Evidence |
|---|---|---|
| Project | CONFIRMED | FreeModelWatch |
| Server username | CONFIRMED | `ubuntu` |
| Server hostname | CONFIRMED | `freemodelwatch-vnic` |
| Project path | CONFIRMED | `/opt/freemodelwatch` |
| Oracle VM | CONFIRMED | Existing deployment |
| Reserved public IP | CONFIRMED | Configured during deployment |
| `.env.local` | CONFIRMED | Deployment configuration established |
| SQLite database | CONFIRMED | `data/freeai.db` |
| npm install | CONFIRMED | `npm ci` succeeded |
| Production build | CONFIRMED | `npm run build` succeeded |
| Process manager | CONFIRMED | systemd service configured |
| Local application | CONFIRMED | HTTP 200 |
| Application listener | CONFIRMED | Next.js observed on `*:3000` |
| UFW | CONFIRMED | Active; 22/80/443 allowed |
| Caddy | UNKNOWN | Current runtime/config not established |
| OCI 80/443 ingress | UNKNOWN | Current rules need verification |
| DNS | UNKNOWN | Current live records need verification |
| Cloudflare proxy | UNKNOWN | Current state needs verification |
| Public TCP 80 | UNKNOWN | Not established at stopping point |
| Public TCP 443 | UNKNOWN | Not established at stopping point |

---

## 5. Known Unknowns

### Oracle

- Exact VM display name.
- Exact shape.
- Region/availability domain.
- Current reserved public IPv4.
- Current private IPv4.
- VNIC details.
- VCN.
- Subnet.
- Route table.
- Internet gateway.
- Security List ingress.
- NSG membership/rules.

### Ubuntu

- Exact Ubuntu release.
- Exact Node version.
- Exact npm version.
- Exact systemd unit name/content.
- Current service logs.
- Whether Caddy is installed/running.
- Caddy configuration.
- Any nginx involvement.
- Current listeners besides the known `*:3000` listener.

### Application

- Exact production start command should be re-read from `package.json`.
- Exact environment-variable names should be re-verified without printing values.
- Current runtime health should be rechecked.
- Current database runtime path should be rechecked.

### Domain/Cloudflare

- Exact production hostname.
- Current A/AAAA/CNAME records.
- Cloudflare proxy status.
- Cloudflare SSL/TLS mode.
- Whether Cloudflare is actually involved in the failure.

---

## 6. Infrastructure Architecture

```text
Internet client
      |
      v
Cloudflare DNS / proxy
      |
      v
Oracle reserved public IPv4
      |
      v
Oracle VCN / subnet / route / VNIC
      |
      v
Ubuntu VM
      |
      +--> UFW :22
      +--> UFW :80
      +--> UFW :443
      |
      v
Caddy / HTTPS reverse proxy (intended; current state UNKNOWN)
      |
      v
Next.js / FreeModelWatch :3000
      |
      v
SQLite: data/freeai.db
```

The critical distinction is that the application being healthy on `:3000` does not prove that anything is accepting public connections on `:80` or `:443`.

---

## 7. Oracle Cloud Configuration

**CONFIRMED:** FreeModelWatch is hosted on Oracle Cloud.

**CONFIRMED:** A reserved public IP was configured.

**CONFIRMED:** The project is intentionally using Oracle Cloud Always Free resources.

Current exact OCI values must be re-verified from the live console rather than guessed:

- Public IPv4: **UNKNOWN — needs verification**
- Private IPv4: **UNKNOWN — needs verification**
- VCN: **UNKNOWN — needs verification**
- Subnet: **UNKNOWN — needs verification**
- VNIC: **UNKNOWN — needs verification**
- Route table: **UNKNOWN — needs verification**
- Internet Gateway: **UNKNOWN — needs verification**
- Security List: **UNKNOWN — needs verification**
- NSG: **UNKNOWN — needs verification**

Expected public ingress is TCP 80 and 443. Inspect current rules before changing them.

**Do not enable any paid Oracle resource.**

---

## 8. Ubuntu Server Configuration

Known shell prompt:

```text
ubuntu@freemodelwatch-vnic:/opt/freemodelwatch$
```

Known project path:

```text
/opt/freemodelwatch
```

**CONFIRMED:** Dependencies installed with `npm ci`.

**CONFIRMED:** Production build completed.

**CONFIRMED:** systemd is used for the application.

**CONFIRMED:** Next.js was observed listening on `*:3000`.

**CONFIRMED:** Local HTTP returned 200.

### UFW

Latest known state:

```text
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

22/tcp (OpenSSH) ALLOW IN Anywhere
80/tcp          ALLOW IN Anywhere
443/tcp         ALLOW IN Anywhere
```

This makes UFW an unlikely blocker based on the known state, but current state should still be verified.

Do not reset UFW.

Ubuntu version: **UNKNOWN — needs verification**.

Use:

```bash
cat /etc/os-release
```

---

## 9. Application Architecture

**CONFIRMED:** Next.js + Node/npm.

**CONFIRMED:** SQLite database.

**CONFIRMED:** Database path observed/established as:

```text
data/freeai.db
```

**CONFIRMED:** Dependencies install successfully.

**CONFIRMED:** Production build succeeds.

**CONFIRMED:** Local HTTP request returns 200.

**CONFIRMED:** Next.js listens on `*:3000` in the latest known socket inspection.

### Environment

The deployment uses `.env.local`.

Known sensitive configuration includes `ADMIN_PASSWORD_HASH`; `GEMINI_API_KEY` is optional according to deployment documentation.

**SECURITY:** Never print values from `.env.local` into chat, logs, commits, or this handoff.

### Commands to re-inspect

```bash
cd /opt/freemodelwatch
cat package.json
node --version
npm --version
sudo ss -lntp
```

Use the current `package.json` as the source of truth for exact scripts.

---

## 10. Domain & Cloudflare Configuration

**CONFIRMED:** The user owns `freeai.today`.

**CONFIRMED:** The domain was purchased through Cloudflare.

**CONFIRMED:** Cloudflare is part of the intended DNS/domain path.

**UNKNOWN:** Exact production hostname.

**UNKNOWN:** Current DNS records.

**UNKNOWN:** Cloudflare proxy status.

**UNKNOWN:** Cloudflare SSL/TLS mode.

Do not assume Cloudflare is the cause simply because it manages the domain.

---

## 11. DNS Status

DNS has **not** been established as the root cause.

Inspect the exact production hostname:

```bash
getent hosts <HOSTNAME>
dig <HOSTNAME> A
dig <HOSTNAME> AAAA
dig <HOSTNAME> CNAME
```

Compare the A record with the actual OCI reserved public IPv4.

Explicitly check AAAA because a stale IPv6 record can cause clients to take an unintended path.

Also inspect live Cloudflare DNS using browser control if needed.

---

## 12. Firewall & Network Security

### Ubuntu/UFW

Known current/latest state:

```text
Status: active
Default: deny incoming, allow outgoing
22/tcp ALLOW IN Anywhere
80/tcp ALLOW IN Anywhere
443/tcp ALLOW IN Anywhere
```

### OCI

**UNKNOWN:** Current security-list and NSG rules.

Verify before changing:

- TCP 80 ingress.
- TCP 443 ingress.
- Correct destination subnet/VNIC.
- Route table.
- Internet gateway.
- Public IP attached to the correct VNIC.

Do not broadly open all ports.

---

## 13. Reverse Proxy / HTTPS

**LIKELY:** Caddy is intended as the public reverse proxy and HTTPS endpoint.

**UNKNOWN:** Current Caddy installation/runtime/configuration.

Inspect:

```bash
which caddy
caddy version
sudo systemctl status caddy --no-pager
sudo ss -lntp | grep -E ':(80|443)\b'
```

If present:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo journalctl -u caddy --no-pager -n 200
```

The intended relationship should ultimately be:

```text
public :80/:443 → Caddy → 127.0.0.1:3000 (or the current app target)
```

Do not assume the target until the Caddyfile and application config are inspected.

nginx involvement: **UNKNOWN — needs verification**.

HTTPS certificate status: **UNKNOWN — needs verification**.

---

## 14. Deployment History

### Oracle infrastructure

**CONFIRMED:** Oracle Cloud VM created for the project.

**CONFIRMED:** Reserved public IP configured.

VCN/subnet/route/security-list/NSG exact current values: **UNKNOWN — verify live state**.

### Application deployment

**CONFIRMED:** Repository deployed to `/opt/freemodelwatch`.

**CONFIRMED:** `.env.local` configured.

**CONFIRMED:** SQLite database exists at `data/freeai.db`.

**CONFIRMED:** `npm ci` succeeded.

**CONFIRMED:** `npm run build` succeeded.

**CONFIRMED:** systemd service configured.

**CONFIRMED:** Local application returns HTTP 200.

**CONFIRMED:** Next.js listens on `*:3000`.

### Firewall

**CONFIRMED:** UFW active with 22/80/443 allowed.

### Public deployment

The remaining work has been focused on public HTTP/HTTPS reachability rather than reinstalling the application.

---

## 15. Troubleshooting Already Performed

### `npm ci`

**SUCCESS:**

```text
added 96 packages, and audited 97 packages in 9s
25 packages are looking for funding
  run `npm fund` for details
found 0 vulnerabilities
```

### Production build

**SUCCESS:** `npm run build` completed.

### Local application

**SUCCESS:** Local HTTP request returned HTTP 200.

### Listener inspection

**SUCCESS:** Next.js observed on `*:3000`.

### UFW inspection

**SUCCESS:** UFW is active and known web ports 80/443 are allowed.

### Packet capture attempt

The following command was attempted:

```bash
sudo tcpdump -ni any 'tcp port 80 or tcp port 443'
```

Result:

```text
sudo: tcpdump: command not found
```

Therefore packet capture was **NOT performed**.

### External TCP tests

The planned tests were:

```powershell
Test-NetConnection <PUBLIC_IP> -Port 80
Test-NetConnection <PUBLIC_IP> -Port 443
```

**IMPORTANT: These tests had NOT been performed at the stated stopping point. Do not claim otherwise.**

---

## 16. Current Failure

**CONFIRMED:** The deployed FreeModelWatch service is not currently reachable through its intended public domain.

**UNKNOWN:** Root cause.

The application itself has strong evidence of being healthy locally, so the remaining investigation should focus on the public exposure path while still rechecking the local proxy/service state.

---

## 17. Exact Point Where Investigation Stopped

The exact stopping point was:

```text
ubuntu@freemodelwatch-vnic:/opt/freemodelwatch$
```

Attempted:

```bash
sudo tcpdump -ni any 'tcp port 80 or tcp port 443'
```

Failed because:

```text
sudo: tcpdump: command not found
```

The planned next external tests were:

```powershell
Test-NetConnection <PUBLIC_IP> -Port 80
Test-NetConnection <PUBLIC_IP> -Port 443
```

They had **NOT been run** at that point.

This is the continuity boundary. Continue from here rather than pretending those tests have results.

---

## 18. Recommended Investigation Strategy

Work from evidence outward and identify the **first failing layer**.

### A. Server/application inspection

```bash
cd /opt/freemodelwatch
pwd
ls -la
cat package.json
node --version
npm --version
sudo ss -lntp
ps aux
```

Inspect systemd and logs without exposing secrets.

### B. Confirm local application

```bash
curl -i http://127.0.0.1:3000/
```

If current config says another port, use that instead.

### C. Inspect Caddy

```bash
which caddy
caddy version
sudo systemctl status caddy --no-pager
sudo ss -lntp | grep -E ':(80|443)\b'
sudo caddy validate --config /etc/caddy/Caddyfile
sudo journalctl -u caddy --no-pager -n 200
```

Only run Caddy-specific commands if Caddy exists.

### D. Inspect UFW

```bash
sudo ufw status verbose
sudo ufw status numbered
```

Do not reset it.

### E. Inspect OCI

Using Oracle Console/browser control, verify the actual reserved IP, VNIC, subnet, route table, internet gateway, security list, and NSGs.

### F. Direct public-IP tests

From an external machine:

```powershell
Test-NetConnection <PUBLIC_IP> -Port 80
Test-NetConnection <PUBLIC_IP> -Port 443
```

Interpretation:

- Both fail → prioritize OCI/public path, listeners, firewall, or packet capture.
- 80 succeeds / 443 fails → focus HTTPS/Caddy/TLS/443 ingress.
- 443 succeeds / 80 fails → focus HTTP/Caddy/80 ingress.
- Both succeed → move upward to hostname/DNS/Cloudflare/Caddy host routing.

### G. Packet capture

If needed, install `tcpdump` and capture only during reproduction:

```bash
sudo tcpdump -ni any 'tcp port 80 or tcp port 443'
```

Interpretation:

- No SYN arrives → upstream/OCI/public path.
- SYN arrives but no useful response → host listener/firewall/service.
- TCP handshake succeeds but HTTP fails → Caddy/TLS/application layer.

### H. DNS/Cloudflare

Only after direct IP behavior is understood, verify the exact hostname, A/AAAA/CNAME, proxy status, and TLS mode.

---

## 19. Immediate Next Actions

1. Inspect `/opt/freemodelwatch` and current `package.json`.
2. Inspect the systemd service and recent logs.
3. Confirm Node/npm versions and current sockets.
4. Reconfirm local HTTP 200.
5. Inspect Caddy and determine whether it is actually serving 80/443.
6. Inspect UFW without changing it.
7. Verify OCI reserved public IP and current VNIC/network/security configuration.
8. Run the pending external tests:

```powershell
Test-NetConnection <PUBLIC_IP> -Port 80
Test-NetConnection <PUBLIC_IP> -Port 443
```

9. Check packet capture if public tests remain unexplained.
10. Identify exact production hostname and inspect Cloudflare/DNS.
11. Make only the smallest necessary fix.
12. Verify each changed layer and then test the real hostname end-to-end.

---

## 20. Verification Checklist

### Application

- [ ] Repository intact.
- [ ] Dependencies installed.
- [ ] Production build successful.
- [ ] systemd service enabled/running.
- [ ] Relevant logs healthy.
- [ ] Next.js listening on expected port.
- [ ] Local HTTP returns 200.
- [ ] SQLite database accessible.

### Reverse proxy

- [ ] Caddy presence confirmed.
- [ ] Caddy service running if intended.
- [ ] Caddy config validates.
- [ ] Caddy listens on 80/443.
- [ ] Caddy routes to Next.js.
- [ ] TLS is valid.

### Ubuntu

- [ ] UFW 80/443 confirmed.
- [ ] No unexpected host firewall rule blocks traffic.

### Oracle

- [ ] Reserved public IP confirmed.
- [ ] Correct VNIC confirmed.
- [ ] Correct subnet confirmed.
- [ ] Route table confirmed.
- [ ] Internet gateway confirmed.
- [ ] Security-list 80/443 ingress confirmed.
- [ ] NSG 80/443 ingress confirmed if applicable.

### Public path

- [ ] External TCP 80 tested.
- [ ] External TCP 443 tested.
- [ ] Packet capture used if necessary.
- [ ] Public HTTP response works.
- [ ] Public HTTPS response works.

### DNS/Cloudflare

- [ ] Exact production hostname confirmed.
- [ ] A record confirmed.
- [ ] AAAA checked.
- [ ] CNAME checked.
- [ ] Cloudflare proxy status confirmed.
- [ ] Cloudflare SSL/TLS mode confirmed.
- [ ] Production hostname resolves correctly.
- [ ] Production hostname serves FreeModelWatch.

### Safety

- [ ] No secrets exposed.
- [ ] No paid Oracle resource enabled.
- [ ] No destructive change made without explicit approval.

---

## 21. Important Constraints

### Oracle Always Free

**CONFIRMED:** The project is intended to cost $0 on Oracle Cloud using Always Free resources.

Do not:

- resize to paid compute,
- create a paid load balancer,
- enable paid services,
- create paid database resources,
- enable anything that could unexpectedly generate charges.

If an action could potentially incur a charge, stop and ask the user first.

### Preserve existing infrastructure

Do not delete/recreate the VM, VCN, DNS records, database, application, or firewall configuration without strong evidence and explicit approval.

---

## 22. Security Rules

Never expose:

- API keys.
- Passwords.
- SSH private keys.
- Cloudflare tokens.
- Cookies/session credentials.
- Database credentials.
- `.env.local` values.
- `ADMIN_PASSWORD_HASH`.
- `GEMINI_API_KEY`.

If authentication is required, use the authenticated browser/session or have the user authenticate. Do not ask the user to paste secrets into chat.

Do not weaken security globally just to make a connectivity test pass.

---

## 23. OpenCode Operating Instructions

### ACT AS AN AGENT, NOT A TUTORIAL GENERATOR

Do not simply give the user a long list of commands and wait for them to relay results.

Use available tools to:

- inspect files,
- inspect configurations,
- execute commands,
- inspect logs,
- test networking,
- inspect the application,
- inspect browser-accessible Cloudflare/Oracle interfaces,
- diagnose,
- make appropriate changes,
- verify changes.

The user wants an AI working **with them**, not a passive command generator.

### VERIFY BEFORE CHANGING

Before modifying infrastructure:

1. Inspect current state.
2. Identify the actual failure.
3. Make the smallest appropriate change.
4. Verify the result.

### NO PAID RESOURCES

Treat Oracle Always Free as a hard constraint.

### DO NOT DESTROY THINGS

Do not delete/recreate working infrastructure, reset UFW, reinstall the OS, delete DNS records, or rotate credentials unless strong evidence makes it necessary and the user explicitly approves it.

### KEEP THE USER INFORMED

When something important is discovered, briefly explain:

- what was wrong,
- how it was established,
- what is being changed,
- how it will be verified.

---

## 24. Browser / Playwright MCP Role

The intended OpenCode environment may include Microsoft Playwright MCP/browser control.

Workflow:

```text
OpenCode
  ↓
local project files
  ↓
SSH / terminal
  ↓
Oracle server
  ↓
Playwright/browser control when useful
  ↓
Cloudflare / Oracle Cloud Console
```

### Prefer terminal/SSH for

- repository inspection,
- package/build state,
- Node/systemd,
- processes,
- ports,
- Caddy,
- UFW,
- local HTTP,
- logs,
- packet capture.

### Use browser control for

- Cloudflare DNS.
- Cloudflare proxy status.
- Cloudflare SSL/TLS settings.
- Oracle instance/VNIC details.
- Oracle reserved public IP.
- VCN/subnet.
- Security lists.
- NSGs.
- Route tables.
- Internet gateway.

Use browser control only when it gives information or control that terminal access cannot provide.

---

## 25. Known Commands

### Project

```bash
cd /opt/freemodelwatch
pwd
ls -la
git status --short
git log -1 --oneline
cat package.json
```

### Install/build

```bash
npm ci
npm run build
```

### Runtime

```bash
node --version
npm --version
sudo ss -lntp
ps aux
```

### systemd

```bash
sudo systemctl --type=service --state=running
sudo systemctl status <SERVICE> --no-pager
sudo journalctl -u <SERVICE> --no-pager -n 200
```

### UFW

```bash
sudo ufw status verbose
sudo ufw status numbered
```

### Local app

```bash
curl -i http://127.0.0.1:3000/
```

### Caddy

```bash
which caddy
caddy version
sudo systemctl status caddy --no-pager
sudo caddy validate --config /etc/caddy/Caddyfile
sudo journalctl -u caddy --no-pager -n 200
```

### DNS

```bash
getent hosts <HOSTNAME>
dig <HOSTNAME> A
dig <HOSTNAME> AAAA
dig <HOSTNAME> CNAME
```

### External tests — pending at stopping point

```powershell
Test-NetConnection <PUBLIC_IP> -Port 80
Test-NetConnection <PUBLIC_IP> -Port 443
```

### Packet capture

```bash
sudo tcpdump -ni any 'tcp port 80 or tcp port 443'
```

Previously this returned `sudo: tcpdump: command not found`.

---

## 26. Known Paths

Application:

```text
/opt/freemodelwatch
```

SQLite:

```text
/opt/freemodelwatch/data/freeai.db
```

Environment:

```text
/opt/freemodelwatch/.env.local
```

Likely Caddy config:

```text
/etc/caddy/Caddyfile
```

**UNKNOWN:** Must verify Caddy path/file exists.

Systemd unit name/path: **UNKNOWN — needs verification**.

---

## 27. Known IPs / Hostnames

| Value | Status |
|---|---|
| `freeai.today` | CONFIRMED domain |
| `freemodelwatch-vnic` | CONFIRMED server hostname |
| `ubuntu` | CONFIRMED server username |
| `/opt/freemodelwatch` | CONFIRMED application path |
| `data/freeai.db` | CONFIRMED database path |
| `*:3000` | CONFIRMED latest Next.js listener |
| Oracle reserved public IPv4 | UNKNOWN — verify in OCI |
| Oracle private IPv4 | UNKNOWN — verify |
| Production hostname | UNKNOWN — verify |
| Public Caddy listener | UNKNOWN — verify |

Do not fill unknown IPs from memory or guesswork.

---

## 28. Configuration Inventory

| Component | State | Confidence |
|---|---|---|
| Oracle VM | Existing | CONFIRMED |
| Reserved public IP | Configured | CONFIRMED |
| Ubuntu | Running | CONFIRMED |
| Project path | `/opt/freemodelwatch` | CONFIRMED |
| `.env.local` | Present/configured | CONFIRMED |
| SQLite | `data/freeai.db` | CONFIRMED |
| npm dependencies | Installed | CONFIRMED |
| Production build | Successful | CONFIRMED |
| systemd | Application service configured | CONFIRMED |
| Next.js | Running/observed | CONFIRMED |
| Next.js listener | `*:3000` | CONFIRMED |
| localhost HTTP | 200 | CONFIRMED |
| UFW | Active | CONFIRMED |
| UFW 80/443 | Allowed | CONFIRMED |
| OCI 80/443 ingress | Unknown | UNKNOWN |
| Caddy | Intended/likely | LIKELY |
| Caddy runtime | Unknown | UNKNOWN |
| DNS A | Unknown | UNKNOWN |
| DNS AAAA | Unknown | UNKNOWN |
| Cloudflare proxy | Unknown | UNKNOWN |
| Cloudflare TLS | Unknown | UNKNOWN |
| Public TCP 80 | Not established | UNKNOWN |
| Public TCP 443 | Not established | UNKNOWN |
| tcpdump | Not installed at previous attempt | CONFIRMED |

---

## 29. Decision Log

### Preserve the existing deployment

**CONFIRMED decision:** The application already installs, builds, runs under systemd, listens on `*:3000`, and serves localhost HTTP 200. Rebuilding from scratch is unjustified.

### Investigate the public path separately

The local application evidence means the investigation must distinguish application health from public exposure.

### Test direct public IP

Direct TCP tests to the public IP intentionally bypass DNS and Cloudflare hostname resolution and therefore help isolate the network boundary.

### Use packet capture when needed

Packet capture can distinguish traffic that never reaches the VM from traffic that reaches the host but fails at the listener/proxy layer.

### Superseded information

Any older project state saying that the application had not been built, started, or locally verified is **SUPERSEDED** by the newer evidence summarized here.

Current known state is:

```text
npm ci successful
npm build successful
systemd configured
Next.js :3000
localhost HTTP 200
UFW 22/80/443 allowed
```

The remaining unresolved issue is public reachability.

---

## 30. Final Takeover Instructions

Treat this document as a technical state snapshot, not a generic tutorial.

Use:

```text
INSPECT
  ↓
IDENTIFY FIRST FAILURE
  ↓
MAKE MINIMAL CHANGE
  ↓
VERIFY
  ↓
TEST END-TO-END
```

Do not assume the failure is DNS, Cloudflare, Oracle, UFW, Caddy, or Node.

Classify every layer as:

```text
CONFIRMED WORKING
CONFIRMED FAILED
UNKNOWN
```

The application layer has strong evidence of being healthy locally. The public request path is the unresolved area.

---

# OPENING TASK FOR OPENCODE

**Take ownership of the existing FreeModelWatch deployment and diagnose the actual public-connectivity failure.**

Do **not** blindly follow a prewritten troubleshooting script.

First inspect the existing deployment in `/opt/freemodelwatch`, the Node/Next.js runtime, systemd service, current sockets, UFW, Caddy, and application configuration.

Then determine the first failing layer in:

```text
Browser
→ freeai.today / production hostname
→ Cloudflare DNS/proxy
→ Oracle public IP
→ OCI VCN/VNIC/security rules
→ Ubuntu/UFW
→ Caddy
→ Next.js :3000
```

Continue from the exact previous diagnostic stopping point:

```bash
sudo tcpdump -ni any 'tcp port 80 or tcp port 443'
```

That command was attempted but failed because `tcpdump` was not installed:

```text
sudo: tcpdump: command not found
```

The next planned external tests were:

```powershell
Test-NetConnection <PUBLIC_IP> -Port 80
Test-NetConnection <PUBLIC_IP> -Port 443
```

**Those tests had NOT been performed at the stopping point. Do not claim they were.**

Obtain the actual current public IP from OCI before substituting it.

Use terminal/SSH for server-side diagnosis and Playwright/browser control for authenticated Cloudflare/Oracle inspection when useful.

Do not rebuild the server. Do not delete infrastructure. Do not reset the firewall. Do not expose secrets. Do not enable paid Oracle resources.

**Primary objective:** determine exactly why the production FreeModelWatch hostname is unreachable, fix only the established fault, and verify the real public hostname end-to-end.

---

## 31. Post-Audit Verification (completed 2026-08-18)

The public-reachability investigation concluded. The deployment is now **healthy** and is
treated as the **known-good baseline**. This section supersedes the UNKNOWN items above for
the layers that were verified during the audit.

### Verified production state (CONFIRMED)

| Layer | Status |
|---|---|
| `https://freeai.today/` | HTTP 200 |
| `https://www.freeai.today/` | 301 → `https://freeai.today/` |
| `https://freemodelwatch.freeai.today/` | 301 → `https://freeai.today/` |
| HTTP → HTTPS | redirect on all three hostnames |
| TLS | Let's Encrypt, valid |
| Caddy | active (reverse proxy / TLS termination) |
| FreeModelWatch service | active (systemd `freeai`) |
| Next.js | serving on `127.0.0.1:3000` |
| UFW | active, default-deny incoming; 22/80/443 allowed |
| Pre-UFW iptables | no unexpected REJECT remains |
| Oracle resources | Always Free / $0 |
| `SITE_URL` | `https://freeai.today` |
| Authoritative/public DNS | `freeai.today` → `161.153.82.168` (Google DNS confirmed) |

### Canonical hostname

The canonical production URL is **`https://freeai.today/`** (the apex). `www.freeai.today` and
`freemodelwatch.freeai.today` are alias hostnames that 301-redirect to the apex; they are not
independent deployments.

### Do-not-change constraints (still in force)

- **Do not change production DNS.** The user's local ISP resolver currently returns NODATA for
  `freeai.today`, but Google DNS resolves it correctly. This is a **local resolver issue, not a
  production DNS failure** — authoritative/public DNS is working. (See maintenance item below.)
- Do not change Cloudflare, Oracle resources, Caddy, UFW, or the application architecture.

### Maintenance backlog (non-blocking, tracked separately)

1. **Node upgrade.** Production runs Node v22.23.2; DEPLOY.md recommends Node ≥ 24. Upgrade to
   ≥ 24 later (verify `node:sqlite` + `next build` first). Not done yet.
2. **Caddyfile formatting.** `caddy fmt` the `/etc/caddy/Caddyfile` (cosmetic). Not done yet.
3. **`Server Reference ID did not match` errors.** Monitor for recurrence after future
   restarts/deployments; investigate only if they persist.
4. **ISP resolver NODATA.** Local ISP resolver returns NODATA for `freeai.today` while Google
   DNS resolves it. Local resolver issue — do not alter production DNS/Cloudflare.
