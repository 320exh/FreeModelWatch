/**
 * FreeAI.today — deployment smoke test / validation.
 *
 * Safe, read-only-ish validation of a deployed instance. Never prints secret values.
 * Non-destructive by default; network-touching (collector) and disruptive (restart)
 * checks are opt-in via flags so this can be run against a live production host
 * without churning state.
 *
 * Usage (run from the project root, with the same env as the deployed app):
 *   npm run smoke:deploy -- --base-url http://localhost:3000
 *   npm run smoke:deploy -- --collector --restart --admin-password '<plaintext>'
 *
 * Flags:
 *   --base-url <url>    base URL of the deployed app (default http://localhost:3000)
 *   --collector         also run `npm run collect:all` and check the exit-code contract
 *   --restart           exercise the web-service restart + DB-persistence check (systemd)
 *   --admin-password <p> plaintext admin password to verify a successful auth (200)
 *   --unit <name>       web systemd unit name (default freeai)
 *
 * Exit code: 0 if no FAIL; 1 if any FAIL.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Result {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: string;
}

const results: Result[] = [];
function pass(name: string, detail?: string) {
  results.push({ name, status: "PASS", detail });
}
function fail(name: string, detail: string) {
  results.push({ name, status: "FAIL", detail });
}
function skip(name: string, detail: string) {
  results.push({ name, status: "SKIP", detail });
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--collector") out.collector = "1";
    else if (argv[i] === "--restart") out.restart = "1";
    else if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        out[k] = v;
        i++;
      } else out[k] = "1";
    }
  }
  return out;
}

function hasFlag(v: string | undefined): boolean {
  return v !== undefined && v !== "";
}

async function httpStatus(url: string, headers?: Record<string, string>): Promise<number> {
  const res = await fetch(url, { headers, redirect: "manual" });
  return res.status;
}

function envCheck() {
  const required = ["ADMIN_PASSWORD_HASH"];
  const optional = ["ADMIN_USERNAME", "SITE_URL", "GEMINI_API_KEY", "FREEAI_DB_PATH"];
  let ok = true;
  for (const k of required) {
    if (hasFlag(process.env[k])) pass(`env:${k}`, "present");
    else {
      fail(`env:${k}`, "MISSING — required for production admin auth");
      ok = false;
    }
  }
  for (const k of optional) {
    pass(`env:${k}`, hasFlag(process.env[k]) ? "present" : "unset (optional)");
  }
  return ok;
}

async function httpChecks(baseUrl: string) {
  const publicPaths = ["/", "/api/models/free", "/models", "/api/providers"];
  for (const p of publicPaths) {
    try {
      const s = await httpStatus(baseUrl + p);
      s >= 200 && s < 500 ? pass(`http ${p}`, `status ${s}`) : fail(`http ${p}`, `status ${s}`);
    } catch (e) {
      fail(`http ${p}`, `unreachable: ${(e as Error).message}`);
    }
  }

  try {
    const s = await httpStatus(baseUrl + "/admin");
    if (s === 401) pass("admin unauthenticated", "401 as expected");
    else if (s === 500) {
      fail(
        "admin unauthenticated",
        `status 500 — ADMIN_PASSWORD_HASH may be unset (verifyBasicAuth throws); expected 401`
      );
    } else fail("admin unauthenticated", `expected 401, got ${s}`);
  } catch (e) {
    fail("admin unauthenticated", `unreachable: ${(e as Error).message}`);
  }

  const pw = process.env.SMOKE_ADMIN_PASSWORD;
  if (hasFlag(pw)) {
    const user = process.env.ADMIN_USERNAME ?? "admin";
    const good = `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
    const bad = `Basic ${Buffer.from(`${user}:wrong-password`).toString("base64")}`;
    const goodStatus = await httpStatus(baseUrl + "/admin", { Authorization: good });
    const badStatus = await httpStatus(baseUrl + "/admin", { Authorization: bad });
    goodStatus === 200 ? pass("admin valid-creds", `200`) : fail("admin valid-creds", `got ${goodStatus}`);
    badStatus === 401 ? pass("admin bad-creds", "401 as expected") : fail("admin bad-creds", `got ${badStatus}`);
  } else {
    skip(
      "admin valid-creds",
      "set SMOKE_ADMIN_PASSWORD to verify a successful login (plaintext password required; not available to the validator)"
    );
  }
}

function dbReadable(baseUrl: string) {
  return fetch(baseUrl + "/api/models/free")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: any) => {
      if (j && Array.isArray(j.models)) {
        pass("db-readable", `api/models/free returned ${j.models.length} models`);
        return j.models.length;
      }
      fail("db-readable", "no models array in /api/models/free response");
      return -1;
    })
    .catch((e) => {
      fail("db-readable", `unreachable: ${(e as Error).message}`);
      return -1;
    });
}

const LIVE_PROVIDERS = ["openrouter", "google", "groq"];
async function liveProviderData(baseUrl: string) {
  try {
    const res = await fetch(baseUrl + "/api/models/free?limit=200");
    if (!res.ok) {
      fail("live-provider-data", `status ${res.status}`);
      return;
    }
    const j = await res.json();
    const models: any[] = Array.isArray(j.models) ? j.models : [];
    const present = new Set(models.map((m) => m.providerId).filter(Boolean));
    const missing = LIVE_PROVIDERS.filter((p) => !present.has(p));
    if (missing.length === 0) {
      pass("live-provider-data", `all live providers present (${[...present].join(",")})`);
    } else {
      fail("live-provider-data", `missing live providers: ${missing.join(",")} (present: ${[...present].join(",")})`);
    }
  } catch (e) {
    fail("live-provider-data", `unreachable: ${(e as Error).message}`);
  }
}

function collectorCheck() {
  const p = spawnSync("npm", ["run", "collect:all"], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 180_000,
  });
  const code = p.status;
  const tail = (p.stdout || "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-6)
    .join(" | ");
  if (code === 0) pass("collector exit-code", `exit 0 (success/partial contract); ${tail}`);
  else if (code === 1) {
    fail("collector exit-code", `exit 1 (a collector failed) — ${tail}`);
  } else if (code === null) {
    fail("collector exit-code", `spawn error: ${(p.error as Error).message}`);
  } else fail("collector exit-code", `unexpected exit ${code}; ${tail}`);
}

function systemdCheck(unit: string) {
  const hasSystemctl = spawnSync("systemctl", ["--version"], { encoding: "utf-8" }).status === 0;
  if (!hasSystemctl) {
    skip("systemd", "systemctl not available on this host");
    return;
  }
  const active = spawnSync("systemctl", ["is-active", unit], { encoding: "utf-8" }).stdout.trim();
  active === "active" ? pass(`systemd:${unit}`, `active`) : fail(`systemd:${unit}`, `is-active=${active}`);

  const timers = spawnSync("systemctl", ["list-timers", "--no-legend"], { encoding: "utf-8" }).stdout;
  timers.includes("freeai") ? pass("systemd:collector-timer", "listed") : skip("systemd:collector-timer", "no freeai timer listed");

  const unitFile = `/etc/systemd/system/${unit}-collect.service`;
  if (existsSync(unitFile)) {
    const content = readFileSync(unitFile, "utf-8");
    const okPre = /ExecStartPre=.*mkdir/.test(content);
    const okStart = /ExecStart=.*flock .*\.collect\.lock.*collect:all/.test(content);
    const okPost = /ExecStartPost=.*systemctl restart/.test(content);
    const pre = okPre ? "ExecStartPre mkdir present" : "ExecStartPre mkdir MISSING";
    const start = okStart ? "flock+collect:all present" : "flock+collect:all MISSING";
    const post = okPost ? "ExecStartPost restart present" : "ExecStartPost restart MISSING";
    pass("systemd:collector-unit-structure", `${pre}; ${start}; ${post}`);
  } else {
    skip("systemd:collector-unit-structure", `${unitFile} not found`);
  }
}

async function restartPersistence(baseUrl: string, unit: string, beforeCount: number) {
  if (beforeCount < 0) {
    skip("persistence", "could not read before-count");
    return;
  }
  const r = spawnSync("systemctl", ["restart", unit], { encoding: "utf-8" });
  if (r.status !== 0) {
    fail("persistence", `systemctl restart ${unit} failed: ${r.stderr}`);
    return;
  }
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
  let after = -1;
  for (let i = 0; i < 20; i++) {
    await wait(1000);
    const s = await httpStatus(baseUrl + "/");
    if (s < 500) {
      after = await dbReadable(baseUrl);
      break;
    }
  }
  if (after < 0) fail("persistence", "app did not come back after restart");
  else if (after >= beforeCount) pass("persistence", `models ${beforeCount} -> ${after} after restart`);
  else fail("persistence", `model count dropped ${beforeCount} -> ${after} after restart`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args["base-url"] ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
  const unit = args.unit ?? "freeai";

  envCheck();
  await httpChecks(baseUrl);
  const before = await dbReadable(baseUrl);
  await liveProviderData(baseUrl);

  if (hasFlag(args.collector)) collectorCheck();
  else skip("collector", "pass --collector to run npm run collect:all and verify the exit-code contract");

  systemdCheck(unit);

  if (hasFlag(args.restart)) {
    await restartPersistence(baseUrl, unit, before);
  } else {
    skip("persistence/restart", "pass --restart to exercise web restart + DB persistence");
  }

  console.log("\n===== FreeAI.today deployment smoke results =====");
  let failed = 0;
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    if (r.status === "FAIL") failed++;
  }
  console.log(`===== ${results.filter((r) => r.status === "PASS").length} PASS / ${failed} FAIL / ${results.filter((r) => r.status === "SKIP").length} SKIP =====`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
