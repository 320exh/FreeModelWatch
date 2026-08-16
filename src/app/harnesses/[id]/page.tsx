import Link from "next/link";
import { notFound } from "next/navigation";
import { getHarness, getHarnessCompat, getAllModels, getAvailability, getProvider } from "@/lib/queries";
import { ConfidenceBadge, StatusPill, OpenBadge } from "@/components/ui";
import { formatQuota, daysAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = getHarness(id);
  if (!h) return { title: "Harness not found" };
  return { title: `Free models for ${h.name}`, description: `Every free AI model currently usable with ${h.name}, with auth, limits and setup difficulty.` };
}

export default async function HarnessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = getHarness(id);
  if (!h) notFound();

  const models = getAllModels();
  const modelMap = new Map(models.map((m) => [m.id, m]));
  const hc = getHarnessCompat({ harnessId: id });
  const avail = getAvailability({ activeOnly: true });
  const availMap = new Map(avail.map((a) => [`${a.modelId}__${a.providerId}`, a]));

  const rows = hc
    .map((c) => {
      const m = modelMap.get(c.modelId);
      const p = c.providerId ? getProvider(c.providerId) : null;
      const a = c.providerId ? availMap.get(`${c.modelId}__${c.providerId}`) : null;
      return { c, m, p, a };
    })
    .filter((r) => r.m)
    .sort((x, y) => (y.c.freeStatus === "free" ? 1 : 0) - (x.c.freeStatus === "free" ? 1 : 0));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/harnesses" className="text-[13px] text-[var(--fg-dim)] hover:text-[var(--fg)]">← All harnesses</Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Free models for {h.name}</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px] max-w-3xl">{h.description}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {h.websiteUrl && <a href={h.websiteUrl} target="_blank" rel="noreferrer" className="btn py-1">Website ↗</a>}
          {h.documentationUrl && <a href={h.documentationUrl} target="_blank" rel="noreferrer" className="btn py-1">Docs ↗</a>}
          <div className="flex items-center gap-1.5 ml-1">
            {h.supportsCustomOpenaiEndpoint && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>OpenAI-compatible EP</span>}
            {h.supportsAnthropicEndpoint && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>Anthropic EP</span>}
            {h.supportsOpenrouterRouting && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>OpenRouter</span>}
            {h.authMethods.map((am) => <span key={am} className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>{am}</span>)}
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{rows.length} compatibility record(s)</h2>
        <div className="card overflow-x-auto scrollbar-thin">
          <table className="w-full text-[13px]">
            <thead className="text-[var(--fg-mute)] text-[11px] uppercase tracking-wider">
              <tr className="border-b border-[var(--border)]">
                <th className="text-left font-semibold p-3">Model</th>
                <th className="text-left font-semibold p-3">Provider</th>
                <th className="text-left font-semibold p-3">Auth</th>
                <th className="text-left font-semibold p-3">Free limit</th>
                <th className="text-left font-semibold p-3">Setup</th>
                <th className="text-left font-semibold p-3">Compat</th>
                <th className="text-left font-semibold p-3">Verified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, m, p, a }) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elev2)]">
                  <td className="p-3">
                    <Link href={`/models/${m!.id}`} className="font-medium hover:text-[var(--accent)]">{m!.name}</Link>
                    <div className="flex gap-1 mt-0.5">
                      <OpenBadge open={m!.isOpenSource} />
                      {m!.codingCapability ? <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>C{m!.codingCapability}</span> : null}
                      {m!.visionSupport && <span className="chip" style={{ color: "#22d3ee", borderColor: "#1d4e57", background: "#08222a" }}>V</span>}
                    </div>
                  </td>
                  <td className="p-3 text-[var(--fg-dim)]">{p ? <Link href={`/providers/${p.id}`} className="hover:text-[var(--accent)]">{p.name}</Link> : "any"}</td>
                  <td className="p-3">{c.requiresApiKey ? "API key" : "None"}</td>
                  <td className="p-3 mono text-[12px]">{a ? formatQuota(a) : "—"}</td>
                  <td className="p-3 capitalize">{c.setupDifficulty ?? "—"}</td>
                  <td className="p-3">
                    {c.freeStatus === "free" ? <span className="text-[#34d399]">✓ free</span> : c.freeStatus ?? "—"}
                    {c.worksWithCustomEndpoint && <span className="text-[var(--fg-mute)] text-[11px]"> · custom EP</span>}
                  </td>
                  <td className="p-3"><div className="flex flex-col gap-0.5"><ConfidenceBadge conf={c.verificationConfidence} /><span className="text-[11px] text-[var(--fg-mute)]">{daysAgo(c.lastVerifiedAt)}</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.some((r) => r.c.knownLimitations) && (
          <div className="card p-3 flex flex-col gap-1.5 text-[12.5px]">
            <span className="text-[var(--fg-mute)] uppercase tracking-wider text-[10.5px]">Known limitations</span>
            {rows.filter((r) => r.c.knownLimitations).map((r) => (
              <div key={r.c.id} className="text-[var(--fg-dim)]">• <span className="text-[var(--fg)]">{r.m!.name}</span> ({r.p?.name ?? "any"}): {r.c.knownLimitations}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
