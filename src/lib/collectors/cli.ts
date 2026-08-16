import { runOpenRouterCollector, formatRunReport } from "./run";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  try {
    const report = await runOpenRouterCollector({ dryRun });
    console.log(formatRunReport(report));
    process.exit(report.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error("Collector crashed:", err);
    process.exit(1);
  }
}

main();
