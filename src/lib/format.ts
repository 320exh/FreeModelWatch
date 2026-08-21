import type { AccessType, AvailabilityStatus, ProviderCategory, VerificationConfidence, FreshnessTier, DataOrigin, CollectionMode } from "./types";

export const ACCESS_LABELS: Record<AccessType, string> = {
  completely_free: "Completely Free",
  free_tier: "Free Tier",
  free_credits: "Free Credits",
  free_with_limits: "Free w/ Limits",
  free_through_aggregator: "Via Aggregator",
  free_through_harness: "Via Harness",
  free_local: "Local / Self-host",
  temporarily_free: "Temp Free",
  community_unofficial: "Community",
  direct_api: "Direct API Free Tier",
};

// WHY something is considered free — never collapse into a generic "FREE" badge.
export const ACCESS_WHY: Record<AccessType, string> = {
  completely_free: "No account, no payment, no quota caps — open for unrestricted use.",
  free_tier: "Provider's recurring free usage tier (rate/quota limited).",
  free_credits: "One-time sign-up credits you can spend on any model.",
  free_with_limits: "Free but heavily throttled (low RPM / tiny quota).",
  free_through_aggregator: "Free via an aggregator (e.g. OpenRouter) with zero-cost inference pricing. Payment method requirements vary by aggregator policy.",
  free_through_harness: "Free because the coding harness routes to a free endpoint.",
  free_local: "Open weights you run locally — fully free, no API bill.",
  temporarily_free: "Promotional / time-limited free access; may expire.",
  community_unofficial: "Community-shared or unofficial access; verify before relying on.",
  direct_api: "Direct provider free tier (e.g. Google AI Studio / Gemini API) — free inference from the vendor itself, not an aggregator.",
};

export const ACCESS_SHORT: Record<AccessType, string> = {
  completely_free: "FREE",
  free_tier: "TIER",
  free_credits: "CREDITS",
  free_with_limits: "LIMITED",
  free_through_aggregator: "AGG",
  free_through_harness: "HARNESS",
  free_local: "LOCAL",
  temporarily_free: "TEMP",
  community_unofficial: "COMMUNITY",
  direct_api: "DIRECT",
};

export const FRESHNESS_LABELS: Record<FreshnessTier, string> = {
  live_verified: "Live · Verified",
  likely: "Likely",
  unverified: "Unverified",
  seed_demo: "Seed / Demo",
  stale: "Stale",
  expired: "Expired",
  unavailable: "Unavailable",
};

// 5-tier freshness language required by the product spec (req 6). The internal
// 7-tier classification is collapsed into these for user-facing trust signals.
export const FRESHNESS_EMOJI: Record<FreshnessTier, string> = {
  live_verified: "🟢",
  likely: "🟡",
  unverified: "⚪",
  seed_demo: "⚪",
  stale: "🟠",
  expired: "🔴",
  unavailable: "🔴",
};

export const FRESHNESS_EMOJI_LABEL: Record<FreshnessTier, string> = {
  live_verified: "🟢 Recently verified",
  likely: "🟡 Likely current",
  unverified: "⚪ Unknown",
  seed_demo: "⚪ Unknown",
  stale: "🟠 Stale",
  expired: "🔴 Expired / unavailable",
  unavailable: "🔴 Expired / unavailable",
};

export const PAYMENT_LABELS: Record<"required" | "not_required" | "unknown", string> = {
  required: "Required",
  not_required: "No card required",
  unknown: "Payment requirement unknown",
};

export const FRESHNESS_COLORS: Record<FreshnessTier, { color: string; bg: string; border: string }> = {
  live_verified: { color: "#34d399", bg: "#0e1f18", border: "#1f5e47" },
  likely: { color: "#60a5fa", bg: "#0d1929", border: "#274a73" },
  unverified: { color: "#fbbf24", bg: "#1f1a08", border: "#5e4d18" },
  seed_demo: { color: "#d9c27a", bg: "#1a1407", border: "#5e4d18" },
  stale: { color: "#fb923c", bg: "#1f1408", border: "#5e3b21" },
  expired: { color: "#f87171", bg: "#231014", border: "#5e2a1f" },
  unavailable: { color: "#9ca3af", bg: "#1a1d24", border: "#3a3f4a" },
};

export const DATA_ORIGIN_LABELS: Record<DataOrigin, string> = {
  seed: "Demo seed",
  production: "Verified production",
  user_report: "User report",
  live_collector: "Live collector",
};

export const COLLECTION_MODE_LABELS: Record<CollectionMode, string> = {
  live: "Live",
  frozen: "Frozen fallback",
  seed: "Demo / Seed",
};

export const COLLECTION_MODE_EMOJI: Record<CollectionMode, string> = {
  live: "🟢",
  frozen: "❄️",
  seed: "⚪",
};

export const COLLECTION_MODE_COLORS: Record<CollectionMode, { color: string; bg: string; border: string }> = {
  live: { color: "#34d399", bg: "#0e1f18", border: "#1f5e47" },
  frozen: { color: "#60a5fa", bg: "#0d1929", border: "#274a73" },
  seed: { color: "#d9c27a", bg: "#1a1407", border: "#5e4d18" },
};

export const STATUS_LABELS: Record<AvailabilityStatus, string> = {
  available: "Available",
  limited: "Limited",
  degraded: "Degraded",
  unavailable: "Unavailable",
  unknown: "Unknown",
  temporarily_free: "Temporarily Free",
};

export const STATUS_ICONS: Record<AvailabilityStatus, string> = {
  available: "🟢",
  limited: "🟡",
  degraded: "🟠",
  unavailable: "🔴",
  unknown: "⚪",
  temporarily_free: "🔵",
};

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  direct_api: "Direct API",
  aggregator: "Aggregator",
  inference: "Inference",
  coding_harness: "Coding Harness",
  cloud: "Cloud",
  local_platform: "Local Platform",
  hosted_oss: "Hosted OSS",
};

export const CONF_LABELS: Record<VerificationConfidence, string> = {
  verified: "Verified",
  likely: "Likely",
  unverified: "Unverified",
  stale: "Stale",
};

export function daysAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const diff = Date.now() - d;
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function formatQuota(a: {
  freeQuotaValue?: number | null;
  freeQuotaUnit?: string | null;
  freeQuotaPeriod?: string | null;
  dailyLimit?: number | null;
  monthlyLimit?: number | null;
}): string {
  const parts: string[] = [];
  if (a.dailyLimit) parts.push(`${a.dailyLimit.toLocaleString()} req/day`);
  if (a.monthlyLimit) parts.push(`${a.monthlyLimit.toLocaleString()} tok/month`);
  if (a.freeQuotaValue != null && a.freeQuotaUnit) {
    const unit = a.freeQuotaUnit;
    const period = a.freeQuotaPeriod ? `/${a.freeQuotaPeriod}` : "";
    parts.push(`${a.freeQuotaValue.toLocaleString()} ${unit}${period}`);
  }
  return parts.join(" · ") || "Not specified";
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString();
}
