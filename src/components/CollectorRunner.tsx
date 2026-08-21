"use client";

import { useState, useTransition } from "react";
import { adminRunCollector } from "@/lib/actions";

type Report = {
  status: string;
  collector?: string;
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

const COLLECTORS = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Gemini (Google AI Studio)" },
  { id: "groq", label: "Groq" },
];

export default function CollectorRunner() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; report?: Report; error?: string } | null>(null);

  function run(collectorId: string, dryRun: boolean) {
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("collectorId", collectorId);
      fd.set("dryRun", dryRun ? "true" : "");
      const res = await adminRunCollector(fd);
      setResult(res);
    });
  }

  return (
    <div className="flex flex-col gap-3 card p-4">
      <div className="flex flex-wrap items-end gap-3">
        {COLLECTORS.map((c) => (
          <div key={c.id} className="flex gap-2">
            <button className="btn btn-primary" disabled={pending} onClick={() => run(c.id, false)}>
              {pending ? "Running…" : `Run ${c.label}`}
            </button>
            <button className="btn" disabled={pending} onClick={() => run(c.id, true)}>
              {pending ? "Running…" : `${c.label} (dry run)`}
            </button>
          </div>
        ))}
        <span className="text-[12px] text-[var(--fg-mute)]">
          Dry run fetches + normalizes without writing. LIVE updates the database.
        </span>
      </div>

      {pending && (
        <div className="text-[12.5px] text-[#60a5fa]">⌛ Collector running — fetching the live provider catalog…</div>
      )}

      {!pending && result && result.ok && result.report && result.report.status !== "failed" && (
        <div className="text-[12.5px] border rounded p-3" style={{ borderColor: "#1f5e47", background: "#0e1f18", color: "#34d399" }}>
          <div className="font-semibold">✓ Collector finished — status: {result.report.status}</div>
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
          <div className="mt-1 text-[var(--fg-dim)]">{result.error ?? result.report?.errorMessage ?? "Unknown error"}</div>
          <div className="mt-1 text-[#fbbf24]">No existing availability data was modified.</div>
        </div>
      )}

      <div className="text-[12px] text-[#fbbf24] border rounded p-2" style={{ borderColor: "#5e4d18", background: "#1f1a08" }}>
        <strong>Live-data banner:</strong> Rows written by a collector are stamped{" "}
        <code className="mono">data_origin = &apos;live_collector&apos;</code> with confidence <em>likely</em> (auto, not human-verified).
        They appear as live data but should be manually verified before being treated as authoritative.
      </div>
    </div>
  );
}
