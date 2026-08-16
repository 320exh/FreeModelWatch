import Link from "next/link";
import { notFound } from "next/navigation";
import { getModelView, getAllProviders, getProvider, getVerificationHistory } from "@/lib/queries";
import { AccessBadge, ConfidenceBadge, FreshnessBadge, OpenBadge, StatusPill, CategoryBadge } from "@/components/ui";
import { formatQuota, daysAgo, STATUS_ICONS, ACCESS_WHY } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getModelView(id);
  if (!m) return { title: "Model not found" };
  return {
    title: `Free access to ${m.name}`,
    description: `Where can you use ${m.name} for free? ${m.freeRouteCount} free route(s) tracked across ${m.routes.length} provider(s). Verified sources & change history.`,
  };
}

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getModelView(id);
  if (!m) notFound();

  const providers = getAllProviders();
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/models" className="text-[13px] text-[var(--fg-dim)] hover:text-[var(--fg)]">
          ← All models
        </Link>
      </div>

      <header className="flex flex-col md:flex-row md:items-start gap-4 justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{m.name}</h1>
            <OpenBadge open={m.isOpenSource} />
            {m.codingCapability ? (
              <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>
                CODING {m.codingCapability}/5
              </span>
            ) : null}
            {m.visionSupport && <span className="chip" style={{ color: "#22d3ee", borderColor: "#1d4e57", background: "#08222a" }}>VISION</span>}
            {m.reasoningSupport && <span className="chip" style={{ color: "#c084fc", borderColor: "#4a2e6b", background: "#1a1024" }}>REASONING</span>}
            {m.toolCalling && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>TOOLS</span>}
            {m.structuredOutput && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>JSON</span>}
          </div>
          <div className="text-[var(--fg-dim)] text-[13.5px]">
            {m.family}
            {m.version ? ` · ${m.version}` : ""} · by <Link href={`/providers/${m.providerId}`} className="text-[var(--accent)] hover:underline">{providerMap.get(m.providerId)?.name ?? m.providerId}</Link>
            {m.releaseDate ? ` · released ${m.releaseDate}` : ""}
          </div>
          {m.description && <p className="text-[14px] text-[var(--fg-dim)] max-w-3xl mt-1">{m.description}</p>}
          <div className="flex items-center gap-3 text-[12.5px] text-[var(--fg-dim)] mt-1">
            <span>Context: <span className="text-[var(--fg)] mono">{m.contextWindow?.toLocaleString()}</span></span>
            {m.maxOutputTokens && <span>Max out: <span className="text-[var(--fg)] mono">{m.maxOutputTokens.toLocaleString()}</span></span>}
            {m.license && <span>License: <span className="text-[var(--fg)]">{m.license}</span></span>}
          </div>
          <div className="flex items-center gap-3 mt-1">
            {m.officialPageUrl && <a href={m.officialPageUrl} target="_blank" rel="noreferrer" className="btn py-1">Official page ↗</a>}
            {m.documentationUrl && <a href={m.documentationUrl} target="_blank" rel="noreferrer" className="btn py-1">Docs ↗</a>}
          </div>
        </div>
        <div className="card p-4 flex flex-col gap-2 min-w-[220px]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] uppercase tracking-wider text-[var(--fg-mute)]">Best status</span>
            <StatusPill status={m.bestStatus ?? "unknown"} />
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--fg-dim)]">Confidence</span>
            <ConfidenceBadge conf={m.bestConfidence} />
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--fg-dim)]">Free routes</span>
            <span className="text-[var(--accent)] font-semibold">{m.freeRouteCount}</span>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--fg-dim)]">Harnesses</span>
            <span className="text-[var(--fg)] font-semibold">{m.harnessCount}</span>
          </div>
          <div className="text-[12px] text-[var(--fg-mute)] border-t border-[var(--border)] pt-2">
            Last verified {daysAgo(m.routes[0]?.availability.lastVerifiedAt)}
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Where can I use this for free? 🔎</h2>
        {m.routes.length === 0 ? (
          <div className="card p-6 text-[var(--fg-dim)]">No currently-free routes tracked for this model.</div>
        ) : (
          <div className="grid gap-3">
            {m.routes.map(({ availability: a, provider: p, freshness, sources }) => (
              <div key={a.id} className="card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{STATUS_ICONS[a.status]}</span>
                    <Link href={`/providers/${p.id}`} className="font-semibold hover:text-[var(--accent)]">{p.name}</Link>
                    <CategoryBadge category={p.category} />
                    <AccessBadge type={a.accessType} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <FreshnessBadge tier={freshness} />
                    <ConfidenceBadge conf={a.verificationConfidence} />
                    <span className="text-[12px] text-[var(--fg-mute)]">verified {daysAgo(a.lastVerifiedAt)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12.5px]">
                  <Field label="Free quota" value={formatQuota(a)} />
                  <Field label="Rate limit" value={a.rateLimitRpm ? `${a.rateLimitRpm}/min` : a.rateLimitTpm ? `${a.rateLimitTpm.toLocaleString()}/min tok` : "—"} />
                  <Field label="Payment" value={a.requiresPaymentMethod ? "Required" : "Not required"} />
                  <Field label="Access" value={[a.requiresApiKey ? "API key" : "No key", a.requiresSignup ? "Signup" : "No signup"].join(" · ")} />
                  {a.apiFormat && <Field label="API format" value={a.apiFormat} />}
                  {a.inputPricePerMillion != null && <Field label="After free" value={`$${a.inputPricePerMillion}/M in`} />}
                  {a.expiresAt && <Field label="Free until" value={a.expiresAt} />}
                  {a.dataOrigin && <Field label="Data origin" value={a.dataOrigin === "seed" ? "Demo seed" : a.dataOrigin === "production" ? "Verified" : a.dataOrigin === "user_report" ? "User report" : "Live collector"} />}
                </div>
                {a.isActive && a.dataOrigin === "live_collector" && !a.freeQuotaValue && !a.dailyLimit && !a.monthlyLimit && !a.rateLimitRpm && !a.rateLimitTpm && (
                  <div className="text-[12px] text-[#fbbf24] border rounded p-2" style={{ borderColor: "#5e4d18", background: "#1f1a08" }}>
                    Free inference pricing; usage limits (rate / request / token caps) are <strong>not specified by the source</strong>. This is not unlimited access.
                  </div>
                )}
                <div className="text-[12px] text-[var(--fg-dim)]">
                  <span className="text-[var(--fg-mute)] uppercase tracking-wider text-[10.5px]">Why free: </span>
                  {ACCESS_WHY[a.accessType]}
                </div>
                {a.verificationNotes && (
                  <div className="text-[12px] text-[var(--fg-dim)] italic">Note: {a.verificationNotes}</div>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-mute)] font-semibold">
                    Sources {sources.length > 0 ? `(${sources.length})` : ""}
                  </span>
                  {sources.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {a.sourceUrl && (
                        <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-[12.5px] text-[var(--accent)] hover:underline w-fit font-medium">
                          {a.sourceTitle ?? a.sourceUrl} ↗ <span className="text-[var(--fg-mute)]">(model-specific)</span>
                        </a>
                      )}
                      {sources.map((s) => (
                        <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="text-[12.5px] text-[var(--fg-dim)] hover:underline w-fit">
                          {s.title ?? s.url} {s.isVerified ? "✓" : ""} ↗
                        </a>
                      ))}
                    </div>
                  ) : a.sourceUrl ? (
                    <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-[12.5px] text-[var(--accent)] hover:underline w-fit">
                      {a.sourceTitle ?? a.sourceUrl} ↗
                    </a>
                  ) : (
                    <span className="text-[12px] text-[#fbbf24]">No source linked — treat as unverified.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Coding-harness compatibility</h2>
        {m.harnessCompat.length === 0 ? (
          <div className="card p-6 text-[var(--fg-dim)]">No harness compatibility recorded yet.</div>
        ) : (
          <div className="card overflow-x-auto scrollbar-thin">
            <table className="w-full text-[13px]">
              <thead className="text-[var(--fg-mute)] text-[11px] uppercase tracking-wider">
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left font-semibold p-3">Harness</th>
                  <th className="text-left font-semibold p-3">Provider</th>
                  <th className="text-left font-semibold p-3">Auth</th>
                  <th className="text-left font-semibold p-3">Free</th>
                  <th className="text-left font-semibold p-3">Custom EP</th>
                  <th className="text-left font-semibold p-3">OpenRouter</th>
                  <th className="text-left font-semibold p-3">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {m.harnessCompat.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="p-3"><Link href={`/harnesses/${c.harnessId}`} className="text-[var(--accent)] hover:underline">{c.harnessId}</Link></td>
                    <td className="p-3 text-[var(--fg-dim)]">{c.providerId ? providerMap.get(c.providerId)?.name ?? c.providerId : "any"}</td>
                    <td className="p-3">{c.requiresApiKey ? "API key" : "None"}</td>
                    <td className="p-3">{c.freeStatus === "free" ? <span className="text-[#34d399]">✓ free</span> : c.freeStatus ?? "—"}</td>
                    <td className="p-3">{c.worksWithCustomEndpoint ? "✓" : "—"}</td>
                    <td className="p-3">{c.worksWithOpenrouter ? "✓" : "—"}</td>
                    <td className="p-3"><ConfidenceBadge conf={c.verificationConfidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Sources</h2>
          {m.sources.length === 0 ? (
            <div className="card p-5 text-[var(--fg-dim)] text-[13px]">No dedicated sources linked to this model.</div>
          ) : (
            <div className="card divide-y divide-[var(--border)]">
              {m.sources.map((s) => (
                <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block p-3 hover:bg-[var(--bg-elev2)]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.title ?? s.url}</span>
                    {s.isVerified && <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>VERIFIED</span>}
                  </div>
                  {s.claimSupported && <div className="text-[12px] text-[var(--fg-dim)] mt-1">{s.claimSupported}</div>}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Change history</h2>
          {m.changes.length === 0 ? (
            <div className="card p-5 text-[var(--fg-dim)] text-[13px]">No recorded changes for this model.</div>
          ) : (
            <div className="card divide-y divide-[var(--border)]">
              {m.changes.map((c) => (
                <div key={c.id} className="p-3">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-medium">{c.fieldChanged}</span>
                    <span className="text-[var(--fg-mute)] ml-auto text-[11px]">{daysAgo(c.detectedAt)}</span>
                  </div>
                  {c.notes && <div className="text-[12px] text-[var(--fg-dim)] mt-0.5">{c.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Verification history</h2>
        {(() => {
          const hist = m.routes.flatMap((r) => getVerificationHistory(r.availability.id));
          if (hist.length === 0) {
            return <div className="card p-5 text-[13px] text-[var(--fg-dim)]">No verification events recorded yet for this model's routes.</div>;
          }
          return (
            <div className="card divide-y divide-[var(--border)]">
              {hist.map((h) => (
                <div key={h.id} className="p-3">
                  <div className="flex items-center gap-2 text-[13px] flex-wrap">
                    <span className="font-medium">{daysAgo(h.verifiedAt)}</span>
                    <span className="text-[var(--fg-dim)]">
                      {h.previousConfidence ?? "?"} → <span className="text-[var(--accent)]">{h.newConfidence}</span>
                      {" · "}{h.previousStatus ?? "?"} → {h.newStatus}
                    </span>
                    {h.verifiedBy && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>{h.verifiedBy}</span>}
                  </div>
                  {h.notes && <div className="text-[12px] text-[var(--fg-dim)] mt-0.5">{h.notes}</div>}
                </div>
              ))}
            </div>
          );
        })()}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-mute)]">{label}</span>
      <span className="mono text-[var(--fg)]">{value}</span>
    </div>
  );
}
