"use client";

import { useState, useTransition } from "react";
import { adminRunCollector } from "@/lib/actions";

type Report = {
  status: string;
  modelsDiscovered: number;
  freeModels: number;
  freeRoutesAdded: number;
  freeRoutesRemoved: number;
  modelsAdded: number;
  modelsChanged: number;
  errors: string[];
  warnings: string[];
  errorMessage: string | null;
  dryRun?: boolean;
};

export default function CollectorRunner() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; report?: Report; error?: string } | null>(null);

  function run(dryRun: boolean) {
    setResult(null);
    startTransition(async () => {
      // Build a FormData so the server action's toFields() path works identically.
      const fd = new FormData();
      fd.set("collectorId", "openrouter");
      fd.set("dryRun", dryRun ? "true" : "");
      const res = await adminRunCollector(fd);
      setResult(res);
    });
  }

  return (
    <div className="flex flex-col gap-3 card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <button className="btn btn-primary" disabled={pending} onClick={() => run(false)}>
          {pending ? "Running…" : "Run OpenRouter collector (dry run)"}
        </button>
        <button className="btn" disabled={pending} onClick={() => run(true)}>
          {pending ? "Running…" : "Run OpenRouter collector (LIVE)"}
        </button>
        <span className="text-[12px] text-[var(--fg-mute)]">
          Dry run fetches + normalizes without writing. LIVE updates the database.
        </span>
      </div>

      {pending && (
        <div className="text-[12.5px] text-[#60a5fa]">⌛ Collector running — fetching the live OpenRouter catalog…</div>
      )}

      {!pending && result && result.ok && result.report && result.report.status !== "failed" && (
        <div className="text-[12.5px] border rounded p-3" style={{ borderColor: "#1f5e47", background: "#0e1f18", color: "#34d399" }}>
          <div className="font-semibold">✓ Collector finished — status: {result.report.status}{result.report.status === "dry" ? "" : ""}</div>
          <div className="mt-1 text-[var(--fg-dim)]">
            Discovered <strong>{result.report.modelsDiscovered}</strong> models ·{" "}
            <strong>{result.report.freeModels}</strong> free ·{" "}
            +{result.report.freeRoutesAdded} routes · −{result.report.freeRoutesRemoved} routes ·{" "}
            {result.report.modelsAdded} new models · {result.report.modelsChanged} changed ·{" "}
            {result.report.errors.length} errors · {result.report.warnings.length} warnings
          </div>
          {result.report.warnings.length > 0 && (
            <div className="mt-1 text-[#fbbf24]">⚠ See warnings above — a partial response may have been refused.</div>
          )}
        </div>
      )}

      {!pending && result && (!result.ok || result.report?.status === "failed") && (
        <div className="text-[12.5px] border rounded p-3" style={{ borderColor: "#5e2a1f", background: "#231014", color: "#f87171" }}>
          <div className="font-semibold">✗ Collector failed</div>
          <div className="mt-1 text-[var(--fg-dim)]">{result.error ?? "Unknown error"}</div>
          <div className="mt-1 text-[#fbbf24]">No existing availability data was modified.</div>
        </div>
      )}

      <div className="text-[12px] text-[#fbbf24] border rounded p-2" style={{ borderColor: "#5e4d18", background: "#1f1a08" }}>
        <strong>Live-data banner:</strong> Rows written by this collector are stamped{" "}
        <code className="mono">data_origin = 'live_collector'</code> with confidence <em>likely</em> (auto, not human-verified).
        They appear as live data but should be manually verified before being treated as authoritative.
      </div>
    </div>
  );
}
