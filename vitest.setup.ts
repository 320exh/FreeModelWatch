import { beforeAll, vi } from "vitest";
import { createRequire } from "node:module";

// The app imports `node:sqlite` directly (so Next.js can externalize the builtin
// at build time). Vitest's Vite transform can't resolve that builtin, so we mock
// it with the real module loaded through Node's CommonJS require at runtime.
vi.mock("node:sqlite", async () => {
  const req = createRequire(import.meta.url);
  const mod = req("node:sqlite") as any;
  return { DatabaseSync: mod.DatabaseSync };
});

beforeAll(async () => {
  process.env.FREEAI_DB_PATH = ":memory:";
  const { resetDb } = await import("./src/lib/db");
  const { seedDatabase } = await import("./src/lib/seed");
  await resetDb();
  await seedDatabase();
});
