import {
  runOpenRouterCollector,
  runGeminiCollector,
  runGroqCollector,
  formatRunReport,
  type CollectorRunReport,
} from "../src/lib/collectors/run";
import { loadEnv } from "../src/lib/collectors/loadEnv";

export type CollectorFn = () => Promise<CollectorRunReport>;

export interface RunAllOptions {
  dryRun?: boolean;
  /** Override the runner list (used by tests to inject fakes). */
  runners?: CollectorFn[];
}

/**
 * Run every collector sequentially with failure isolation: one collector failing
 * (or crashing) must not prevent the others from running. The batch exits non-zero
 * only if ANY collector reported `failed` or threw — a `partial` result (some writes
 * succeeded) does NOT fail the batch, because a `failed` run writes no rows and is the
 * only status that represents lost work (see failure-safety in the collector docs).
 */
export async function runAll(opts: RunAllOptions = {}): Promise<number> {
  const dryRun = !!opts.dryRun;
  const runners: CollectorFn[] =
    opts.runners ?? [
      () => runOpenRouterCollector({ dryRun }),
      () => runGeminiCollector({ dryRun }),
      () => runGroqCollector({ dryRun }),
    ];

  let anyFailed = false;
  for (let i = 0; i < runners.length; i++) {
    try {
      const report = await runners[i]();
      console.log(formatRunReport(report));
      if (report.status === "failed") anyFailed = true;
    } catch (err) {
      console.error(`Collector #${i + 1} crashed:`, err);
      anyFailed = true;
    }
  }

  return anyFailed ? 1 : 0;
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  process.argv[1].endsWith("collect-all.ts");

if (isMain) {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  runAll({ dryRun })
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("collect-all fatal error:", err);
      process.exit(1);
    });
}
