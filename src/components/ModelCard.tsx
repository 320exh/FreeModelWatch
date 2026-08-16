import Link from "next/link";
import type { ModelView } from "@/lib/queries";
import { AccessBadge, ConfidenceBadge, FreshnessBadge, OpenBadge, StatusPill } from "./ui";
import { formatNumber, daysAgo } from "@/lib/format";

export function ModelCard({ m }: { m: ModelView }) {
  const accessTypes = Array.from(new Set(m.routes.map((r) => r.availability.accessType)));
  const best = m.routes[0];
  return (
    <Link href={`/models/${m.id}`} className="card card-hover p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[15px] truncate">{m.name}</div>
          <div className="text-[12.5px] text-[var(--fg-dim)] truncate">
            {m.family}
            {m.version ? ` · ${m.version}` : ""} · {best ? best.provider.name : m.providerId}
          </div>
        </div>
        <div className="text-right shrink-0">
          <StatusPill status={m.bestStatus ?? "unknown"} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {accessTypes.slice(0, 3).map((a) => (
          <AccessBadge key={a} type={a} short />
        ))}
        <OpenBadge open={m.isOpenSource} />
        {m.codingCapability ? (
          <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>
            CODING {m.codingCapability}/5
          </span>
        ) : null}
        {m.visionSupport && (
          <span className="chip" style={{ color: "#22d3ee", borderColor: "#1d4e57", background: "#08222a" }}>VISION</span>
        )}
        {m.reasoningSupport && (
          <span className="chip" style={{ color: "#c084fc", borderColor: "#4a2e6b", background: "#1a1024" }}>REASON</span>
        )}
        {m.toolCalling && (
          <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>TOOLS</span>
        )}
      </div>

      <div className="flex items-center justify-between text-[12px] text-[var(--fg-dim)] border-t border-[var(--border)] pt-2.5">
        <div className="flex items-center gap-3">
          <span title="Context window">{formatNumber(m.contextWindow)} ctx</span>
          <span title="Free access routes" className="text-[var(--accent)]">
            {m.freeRouteCount} free {m.freeRouteCount === 1 ? "route" : "routes"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <FreshnessBadge tier={m.bestFreshness} />
          <ConfidenceBadge conf={m.bestConfidence} />
        </div>
      </div>
      {m.dataQuality !== "live" && (
        <div className="text-[11px] text-[var(--fg-mute)]">
          {m.dataQuality === "seed"
            ? "Based on demo/seed data — not live-verified."
            : m.dataQuality === "stale"
            ? "Ranked on stale/expired data — verify before relying."
            : "Mixed data quality — partly seed/stale."}
        </div>
      )}
    </Link>
  );
}
