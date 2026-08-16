import Link from "next/link";
import { notFound } from "next/navigation";
import { getProvider, getAvailability, getAllModels, getSources, getChanges, classifyFreshness } from "@/lib/queries";
import { AccessBadge, CategoryBadge, ConfidenceBadge, FreshnessBadge, StatusPill, OpenBadge } from "@/components/ui";
import { formatQuota, daysAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getProvider(id);
  if (!p) return { title: "Provider not found" };
  return { title: `Free AI access via ${p.name}`, description: `${p.name}: free tier, credits, rate limits and signup requirements for AI models.` };
}

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getProvider(id);
  if (!p) notFound();

  const models = getAllModels();
  const modelMap = new Map(models.map((m) => [m.id, m]));
  const avail = getAvailability({ providerId: id, activeOnly: true }).filter((a) =>
    ["available", "limited", "degraded", "temporarily_free"].includes(a.status)
  );
  avail.sort((a, b) => (b.verificationConfidence === "verified" ? 1 : 0) - (a.verificationConfidence === "verified" ? 1 : 0));

  const sources = getSources({ providerId: id });
  const changes = getChanges().filter((c) => c.entityId.includes(id));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/providers" className="text-[13px] text-[var(--fg-dim)] hover:text-[var(--fg)]">← All providers</Link>

      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
            <CategoryBadge category={p.category} />
            <StatusPill status={p.status} />
          </div>
          <div className="flex items-center gap-3 text-[13px] text-[var(--fg-dim)]">
            {p.hasFreeTier && <span className="text-[#60a5fa]">● Free tier</span>}
            {p.freeCreditsAmount != null && <span className="text-[#c084fc]">● ${p.freeCreditsAmount} free credits</span>}
            {!p.requiresPaymentMethod && <span className="text-[#34d399]">● No card required</span>}
            {p.requiresSignup ? <span>● Signup required</span> : <span>● No signup</span>}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {p.websiteUrl && <a href={p.websiteUrl} target="_blank" rel="noreferrer" className="btn py-1">Website ↗</a>}
            {p.pricingUrl && <a href={p.pricingUrl} target="_blank" rel="noreferrer" className="btn py-1">Pricing ↗</a>}
            {p.apiDocsUrl && <a href={p.apiDocsUrl} target="_blank" rel="noreferrer" className="btn py-1">API docs ↗</a>}
          </div>
        </div>
        <div className="card p-4 flex flex-col gap-2 min-w-[220px]">
          <div className="flex justify-between text-[13px]"><span className="text-[var(--fg-dim)]">Free models</span><span className="text-[var(--accent)] font-semibold">{avail.length}</span></div>
          <div className="flex justify-between text-[13px]"><span className="text-[var(--fg-dim)]">Rate limit</span><span className="mono">{p.rateLimitRpm ? `${p.rateLimitRpm}/min` : "—"}</span></div>
          <div className="flex justify-between text-[13px]"><span className="text-[var(--fg-dim)]">Daily limit</span><span className="mono">{p.dailyRequestLimit?.toLocaleString() ?? "—"}</span></div>
          <div className="flex justify-between text-[13px]"><span className="text-[var(--fg-dim)]">Confidence</span><ConfidenceBadge conf={p.verificationConfidence} /></div>
          <div className="text-[11.5px] text-[var(--fg-mute)] border-t border-[var(--border)] pt-2">verified {daysAgo(p.lastVerifiedAt)}</div>
        </div>
      </header>

      {p.termsRestrictions && (
        <div className="card p-3 text-[13px] text-[var(--fg-dim)] border-l-2" style={{ borderLeftColor: "#fbbf24" }}>
          {p.termsRestrictions}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Free models available here</h2>
        {avail.length === 0 ? (
          <div className="card p-6 text-[var(--fg-dim)]">No currently-free models tracked for this provider.</div>
        ) : (
          <div className="grid gap-2">
            {avail.map((a) => {
              const m = modelMap.get(a.modelId);
              if (!m) return null;
              return (
                <Link key={a.id} href={`/models/${m.id}`} className="card card-hover p-3 flex items-center gap-3 flex-wrap">
                  <span className="text-lg">{a.status === "available" ? "🟢" : a.status === "limited" ? "🟡" : a.status === "degraded" ? "🟠" : "🔵"}</span>
                  <span className="font-medium min-w-[160px]">{m.name}</span>
                  <OpenBadge open={m.isOpenSource} />
                  <AccessBadge type={a.accessType} short />
                  <span className="text-[12.5px] text-[var(--fg-dim)] mono">{formatQuota(a)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <FreshnessBadge tier={classifyFreshness(a)} />
                    <ConfidenceBadge conf={a.verificationConfidence} />
                    <span className="text-[11.5px] text-[var(--fg-mute)]">{daysAgo(a.lastVerifiedAt)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Sources</h2>
          {sources.length === 0 ? <div className="card p-5 text-[var(--fg-dim)] text-[13px]">No sources linked.</div> : (
            <div className="card divide-y divide-[var(--border)]">
              {sources.map((s) => (
                <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block p-3 hover:bg-[var(--bg-elev2)]">
                  <div className="font-medium">{s.title ?? s.url}</div>
                  {s.claimSupported && <div className="text-[12px] text-[var(--fg-dim)] mt-0.5">{s.claimSupported}</div>}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Recent changes</h2>
          {changes.length === 0 ? <div className="card p-5 text-[var(--fg-dim)] text-[13px]">No recorded changes.</div> : (
            <div className="card divide-y divide-[var(--border)]">
              {changes.map((c) => (
                <div key={c.id} className="p-3">
                  <div className="flex items-center gap-2 text-[13px]"><span className="font-medium">{c.fieldChanged}</span><span className="text-[var(--fg-mute)] ml-auto text-[11px]">{daysAgo(c.detectedAt)}</span></div>
                  {c.notes && <div className="text-[12px] text-[var(--fg-dim)] mt-0.5">{c.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
