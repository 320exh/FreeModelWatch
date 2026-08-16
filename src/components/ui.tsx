import {
  ACCESS_LABELS,
  ACCESS_SHORT,
  STATUS_ICONS,
  STATUS_LABELS,
  CATEGORY_LABELS,
  CONF_LABELS,
  FRESHNESS_LABELS,
  FRESHNESS_COLORS,
} from "@/lib/format";
import type {
  AccessType,
  AvailabilityStatus,
  ProviderCategory,
  VerificationConfidence,
  FreshnessTier,
} from "@/lib/types";

function colorForAccess(a: AccessType): { color: string; borderColor: string; background: string } {
  switch (a) {
    case "completely_free":
      return { color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" };
    case "free_tier":
      return { color: "#60a5fa", borderColor: "#274a73", background: "#0d1929" };
    case "free_credits":
      return { color: "#c084fc", borderColor: "#4a2e6b", background: "#1a1024" };
    case "free_with_limits":
      return { color: "#fbbf24", borderColor: "#5e4d18", background: "#1f1a08" };
    case "free_through_aggregator":
      return { color: "#22d3ee", borderColor: "#1d4e57", background: "#08222a" };
    case "free_through_harness":
      return { color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" };
    case "free_local":
      return { color: "#a3e635", borderColor: "#3f5420", background: "#16210a" };
    case "temporarily_free":
      return { color: "#fb923c", borderColor: "#5e3b21", background: "#1f1408" };
    default:
      return { color: "#9ca3af", borderColor: "#3a3f4a", background: "#1a1d24" };
  }
}

export function AccessBadge({ type, short = false }: { type: AccessType; short?: boolean }) {
  const label = short ? ACCESS_SHORT[type] : ACCESS_LABELS[type];
  return (
    <span className="chip" style={colorForAccess(type)} title={ACCESS_LABELS[type]}>
      {label}
    </span>
  );
}

export function StatusPill({ status }: { status: AvailabilityStatus }) {
  const color =
    status === "available"
      ? "#34d399"
      : status === "limited"
      ? "#fbbf24"
      : status === "degraded"
      ? "#fb923c"
      : status === "unavailable"
      ? "#f87171"
      : status === "temporarily_free"
      ? "#60a5fa"
      : "#9ca3af";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color }}>
      <span className="dot" style={{ background: color }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function StatusIcon({ status }: { status: AvailabilityStatus }) {
  return <span title={STATUS_LABELS[status]}>{STATUS_ICONS[status]}</span>;
}

export function CapBadge({ label, on }: { label: string; on: boolean }) {
  if (!on) return null;
  return <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>{label}</span>;
}

export function ConfidenceBadge({ conf }: { conf: VerificationConfidence }) {
  const color =
    conf === "verified"
      ? "#34d399"
      : conf === "likely"
      ? "#60a5fa"
      : conf === "unverified"
      ? "#fbbf24"
      : "#9ca3af";
  return (
    <span className="chip" style={{ color, borderColor: "#2f3340", background: "#111319" }} title={`Confidence: ${CONF_LABELS[conf]}`}>
      {CONF_LABELS[conf]}
    </span>
  );
}

export function FreshnessBadge({ tier }: { tier: FreshnessTier }) {
  const c = FRESHNESS_COLORS[tier];
  return (
    <span className="chip" style={{ color: c.color, borderColor: c.border, background: c.bg }} title={`Data freshness: ${FRESHNESS_LABELS[tier]}`}>
      {FRESHNESS_LABELS[tier]}
    </span>
  );
}

export function CategoryBadge({ category }: { category: ProviderCategory }) {
  return (
    <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export function OpenBadge({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <span className="chip" style={{ color: "#a3e635", borderColor: "#3f5420", background: "#16210a" }} title="Open weights / open source">
      OSS
    </span>
  );
}
