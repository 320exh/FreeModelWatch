import { runOpenRouterCollector, runGeminiCollector, runGroqCollector, formatRunReport } from "./run";
import { loadEnv } from "./loadEnv";

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const collectorArg = args.find((a) => a.startsWith("--collector="))?.split("=")[1] ?? args[0] ?? "openrouter";
  const dryRun = args.includes("--dry-run");

  const runners: Record<string, () => ReturnType<typeof runOpenRouterCollector>> = {
    openrouter: () => runOpenRouterCollector({ dryRun }),
    gemini: () => runGeminiCollector({ dryRun }),
    groq: () => runGroqCollector({ dryRun }),
  };

  const run = runners[collectorArg];
  if (!run) {
    console.error(`Unknown collector "${collectorArg}". Supported: openrouter, gemini, groq.`);
    process.exit(2);
  }

  try {
    const report = await run();
    console.log(formatRunReport(report));
    process.exit(report.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error("Collector crashed:", err);
    process.exit(1);
  }
}

main();
