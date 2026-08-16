import { beforeAll, vi } from "vitest";
import { createRequire } from "node:module";
import { scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// The app imports `node:sqlite` directly (so Next.js can externalize the builtin
// at build time). Vitest's Vite transform can't resolve that builtin, so we mock
// it with the real module loaded through Node's CommonJS require at runtime.
vi.mock("node:sqlite", async () => {
  const req = createRequire(import.meta.url);
  const mod = req("node:sqlite") as any;
  return { DatabaseSync: mod.DatabaseSync };
});

// Pre-compute a password hash for "test-password" for test auth
async function setupTestAuth() {
  const salt = "0123456789abcdef0123456789abcdef"; // 16 bytes = 32 hex chars
  const derivedKey = (await scryptAsync("test-password", salt, 64)) as Buffer;
  process.env.ADMIN_PASSWORD_HASH = `${salt}:${derivedKey.toString("hex")}`;
  process.env.ADMIN_USERNAME = "admin";
}

beforeAll(async () => {
  await setupTestAuth();
  process.env.FREEAI_DB_PATH = ":memory:";
  const { resetDb } = await import("./src/lib/db");
  const { seedDatabase } = await import("./src/lib/seed");
  await resetDb();
  await seedDatabase();
});
