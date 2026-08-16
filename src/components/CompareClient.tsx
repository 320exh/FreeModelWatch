"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

interface Route {
  providerName: string;
  accessType: string;
  status: string;
  dailyLimit: number | null;
  freeQuotaValue: number | null;
  freeQuotaUnit: string | null;
  freeQuotaPeriod: string | null;
  rateLimitRpm: number | null;
  requiresPaymentMethod: boolean;
  requiresApiKey: boolean;
  apiFormat: string | null;
  lastVerifiedAt: string | null;
}
interface ApiModel {
  id: string;
  name: string;
  family: string | null;
  providerId: string;
  contextWindow: number | null;
  codingCapability: number | null;
  visionSupport: boolean;
  reasoningSupport: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  isOpenSource: boolean;
  bestAccessType: string | null;
  bestStatus: string | null;
  bestConfidence: string;
  noPaymentMethod: boolean;
  harnessCount: number;
  freeRouteCount: number;
  routes: Route[];
}

const ACCESS_LABEL: Record<string, string> = {
  completely_free: "Completely Free",
  free_tier: "Free Tier",
  free_credits: "Free Credits",
  free_with_limits: "Free w/ Limits",
  free_through_aggregator: "Via Aggregator",
  free_through_harness: "Via Harness",
  free_local: "Local",
  temporarily_free: "Temp Free",
  community_unofficial: "Community",
  direct_api: "Direct API",
};

function daysAgo(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export function CompareClient() {
  const [models, setModels] = useState<ApiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/models/free")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 6 ? s : [...s, id]));
  };

  const chosen = useMemo(() => models.filter((m) => selected.includes(m.id)), [models, selected]);
  const filtered = useMemo(
    () => models.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()) || m.family?.toLowerCase().includes(q.toLowerCase())),
    [models, q]
  );

  const rows: { label: string; get: (m: ApiModel) => React.ReactNode }[] = [
    { label: "Provider", get: (m) => m.providerId },
    { label: "Free access", get: (m) => (m.bestAccessType ? ACCESS_LABEL[m.bestAccessType] : "—") },
    { label: "Free routes", get: (m) => m.freeRouteCount },
    { label: "Free quota", get: (m) => m.routes.map((r) => r.dailyLimit ? `${r.dailyLimit}/day` : r.freeQuotaValue ? `${r.freeQuotaValue}${r.freeQuotaUnit ? " " + r.freeQuotaUnit : ""}${r.freeQuotaPeriod ? "/" + r.freeQuotaPeriod : ""}` : "—").join(", ") || "—" },
    { label: "Rate limit", get: (m) => m.routes.map((r) => (r.rateLimitRpm ? `${r.rateLimitRpm}/min` : "—")).join(", ") || "—" },
    { label: "Context", get: (m) => (m.contextWindow ? m.contextWindow.toLocaleString() : "—") },
    { label: "Coding", get: (m) => (m.codingCapability ? `${m.codingCapability}/5` : "—") },
    { label: "Reasoning", get: (m) => (m.reasoningSupport ? "✓" : "—") },
    { label: "Vision", get: (m) => (m.visionSupport ? "✓" : "—") },
    { label: "Tool calling", get: (m) => (m.toolCalling ? "✓" : "—") },
    { label: "Structured out", get: (m) => (m.structuredOutput ? "✓" : "—") },
    { label: "Open source", get: (m) => (m.isOpenSource ? "✓" : "—") },
    { label: "API key", get: (m) => (m.routes.some((r) => r.requiresApiKey) ? "required" : "not required") },
    { label: "Payment", get: (m) => (m.noPaymentMethod ? "not required" : "required") },
    { label: "Harnesses", get: (m) => m.harnessCount },
    { label: "Confidence", get: (m) => m.bestConfidence },
    { label: "Last verified", get: (m) => daysAgo(m.routes[0]?.lastVerifiedAt ?? null) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compare Models</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px]">Select up to 6 models to compare free-access properties side by side.</p>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-5 items-start">
        <div className="card p-3 flex flex-col gap-2 sticky top-[112px]">
          <input className="input" placeholder="Filter models…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="text-[11px] text-[var(--fg-mute)]">{selected.length}/6 selected</div>
          <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="text-[var(--fg-dim)] text-[13px] p-2">Loading…</div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className="flex items-center gap-2 p-2 rounded-md text-left text-[13px] hover:bg-[var(--bg-elev2)]"
                  style={selected.includes(m.id) ? { background: "var(--bg-elev2)" } : undefined}
                >
                  <span className="w-4 h-4 rounded border flex items-center justify-center text-[11px]" style={{ borderColor: selected.includes(m.id) ? "var(--accent)" : "var(--border-strong)", color: "var(--accent)" }}>
                    {selected.includes(m.id) ? "✓" : ""}
                  </span>
                  <span className="truncate">{m.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div>
          {chosen.length === 0 ? (
            <div className="card p-10 text-center text-[var(--fg-dim)]">Select models from the left to compare.</div>
          ) : (
            <div className="card overflow-x-auto scrollbar-thin">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-3 sticky left-0 bg-[var(--bg-elev)] font-semibold text-[var(--fg-dim)] min-w-[120px]">Property</th>
                    {chosen.map((m) => (
                      <th key={m.id} className="text-left p-3 font-semibold border-l border-[var(--border)] min-w-[150px]">
                        <Link href={`/models/${m.id}`} className="hover:text-[var(--accent)]">{m.name}</Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label} className="border-t border-[var(--border)]">
                      <td className="p-3 sticky left-0 bg-[var(--bg-elev)] text-[var(--fg-dim)] text-[12px]">{row.label}</td>
                      {chosen.map((m) => (
                        <td key={m.id} className="p-3 border-l border-[var(--border)]">{row.get(m)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
