import Link from "next/link";
import { getAllProviders, getAvailability } from "@/lib/queries";
import { CategoryBadge, ConfidenceBadge, FreshnessBadge, StatusPill } from "@/components/ui";
import { daysAgo } from "@/lib/format";
import type { FreshnessTier } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Free AI Providers & Aggregators",
  description: "Providers and aggregators offering free AI model access — free tiers, credits, rate limits, and signup requirements.",
};

function providerTier(p: { dataOrigin?: string; verificationConfidence: string }): FreshnessTier {
  if (p.dataOrigin === "seed") return "seed_demo";
  if (p.verificationConfidence === "verified") return "live_verified";
  if (p.verificationConfidence === "likely") return "likely";
  return "unverified";
}

export default function ProvidersPage() {
  const providers = getAllProviders();
  const allAvail = getAvailability({ activeOnly: true });

  const counts = new Map<string, number>();
  for (const a of allAvail) {
    if (["available", "limited", "degraded", "temporarily_free"].includes(a.status)) {
      counts.set(a.providerId, (counts.get(a.providerId) ?? 0) + 1);
    }
  }

  const sorted = [...providers].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Providers & Aggregators</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px]">{providers.length} tracked. Each shows its current free-access footprint.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((p) => (
          <Link key={p.id} href={`/providers/${p.id}`} className="card card-hover p-4 flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{p.name}</div>
              <StatusPill status={p.status} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <CategoryBadge category={p.category} />
              {p.hasFreeTier && <span className="chip" style={{ color: "#60a5fa", borderColor: "#274a73", background: "#0d1929" }}>FREE TIER</span>}
              {p.freeCreditsAmount != null && (
                <span className="chip" style={{ color: "#c084fc", borderColor: "#4a2e6b", background: "#1a1024" }}>
                  ${p.freeCreditsAmount} CREDITS
                </span>
              )}
              {!p.requiresPaymentMethod && <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>NO CARD</span>}
            </div>
            <div className="flex items-center justify-between text-[12.5px] text-[var(--fg-dim)] border-t border-[var(--border)] pt-2.5">
              <span className="text-[var(--accent)] font-semibold">{counts.get(p.id) ?? 0} free models</span>
              <FreshnessBadge tier={providerTier(p)} />
            </div>
            <div className="text-[11.5px] text-[var(--fg-mute)]">verified {daysAgo(p.lastVerifiedAt)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
