import { getVerificationQueue, detectContradictions, getAllModels, getAllProviders, getStaleCount, getLastCollectorRuns, type QueueSeverity, type CollectorRunRow } from "@/lib/queries";
import { getDataQualityStats } from "@/lib/intelligence";
import { markVerified, adminVerifyRoute, addAvailability, reportChange } from "@/lib/actions";
import { AccessBadge, ConfidenceBadge, FreshnessBadge } from "@/components/ui";
import CollectorRunner from "@/components/CollectorRunner";
import { daysAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin — Data Management",
  robots: { index: false, follow: false },
};

const ACCESS_OPTIONS = [
  "completely_free", "free_tier", "free_credits", "free_with_limits",
  "free_through_aggregator", "free_local", "temporarily_free", "community_unofficial", "direct_api",
];
const CONF_OPTIONS = ["verified", "likely", "unverified", "stale"];

// Next's <form action> expects (FormData) => void; our server actions return a
// result object. Cast keeps the JSX typing honest without changing the actions.
const act = (fn: (fd: FormData | Record<string, any>) => Promise<unknown>) =>
  fn as unknown as (fd: FormData) => void;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const provider = typeof sp.provider === "string" ? sp.provider : undefined;
  const model = typeof sp.model === "string" ? sp.model : undefined;
  const severity = (typeof sp.severity === "string" ? sp.severity : "all") as QueueSeverity;

  const models = getAllModels();
  const providers = getAllProviders();
  const queue = getVerificationQueue({ provider, model, severity });
  const issues = detectContradictions();
  const stale = getStaleCount();
  const runs = getLastCollectorRuns(10);
  const dq = getDataQualityStats();

  const sevCounts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Admin · Data Management</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px]">Maintain the database, verify freshness, and review the moderation queue.</p>
        <div className="card p-3 text-[12.5px] text-[#34d399] border" style={{ borderColor: "#1e5a2e", background: "#0c1f12" }}>
          <strong>Auth enabled:</strong> This admin area is protected by HTTP Basic Auth (see <code className="mono">ADMIN_USERNAME</code>/<code className="mono">ADMIN_PASSWORD_HASH</code> env vars).
          All mutating actions and collector endpoints require valid credentials. The authenticated username is recorded as <code className="mono">verified_by</code>.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-4"><div className="text-2xl font-bold">{models.length}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Models</div></div>
        <div className="card p-4"><div className="text-2xl font-bold">{providers.length}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Providers</div></div>
        <div className="card p-4"><div className="text-2xl font-bold text-[#fbbf24]">{queue.length}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Needs verify</div></div>
        <div className="card p-4"><div className="text-2xl font-bold text-[#f87171]">{issues.length}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Contradictions</div></div>
        <div className="card p-4"><div className="text-2xl font-bold text-[#fb923c]">{stale}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Stale (30d+)</div></div>
      </div>

      {/* Verification queue */}
      <section className="flex flex-col gap-3">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <h2 className="text-lg font-semibold w-full">Verification Queue <span className="text-[var(--fg-mute)] text-[12px]">(sorted by urgency)</span></h2>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Provider
            <select name="provider" className="input" defaultValue={provider ?? ""}>
              <option value="">Any</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Model
            <select name="model" className="input" defaultValue={model ?? ""}>
              <option value="">Any</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Severity
            <select name="severity" className="input" defaultValue={severity}>
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit">Filter</button>
        </form>

        <div className="card divide-y divide-[var(--border)]">
          {queue.length === 0 ? (
            <div className="p-5 text-[13px] text-[var(--fg-dim)]">Nothing in the queue for these filters. ✅</div>
          ) : (
            queue.slice(0, 50).map((q) => (
              <details key={q.availabilityId} className="p-3">
                <summary className="flex items-center gap-3 flex-wrap cursor-pointer list-none">
                  <span className="font-medium">{q.modelName}</span>
                  <span className="text-[12px] text-[var(--fg-dim)]">via {q.providerName}</span>
                  <AccessBadge type={q.accessType} short />
                  <ConfidenceBadge conf={q.confidence} />
                  <FreshnessBadge tier={q.freshness} />
                  <span className="text-[12px] text-[var(--fg-mute)]">verified {daysAgo(q.lastVerifiedAt)}</span>
                  <span className="text-[12px] text-[#fbbf24] ml-auto">{q.reason}</span>
                </summary>
                <form action={act(adminVerifyRoute)} className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 card p-3">
                  <input type="hidden" name="id" value={q.availabilityId} />
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Status
                    <select name="status" className="input">{["available", "limited", "degraded", "temporarily_free", "unavailable"].map((o) => <option key={o} value={o} selected={o === q.status}>{o}</option>)}</select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Access type
                    <select name="accessType" className="input">{ACCESS_OPTIONS.map((o) => <option key={o} value={o} selected={o === q.accessType}>{o}</option>)}</select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Confidence
                    <select name="confidence" className="input">{CONF_OPTIONS.map((o) => <option key={o} value={o} selected={o === q.confidence}>{o}</option>)}</select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Free quota value
                    <input name="freeQuotaValue" type="number" className="input" placeholder="e.g. 1500" />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Quota unit
                    <input name="freeQuotaUnit" className="input" placeholder="requests / dollars" />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Quota period
                    <input name="freeQuotaPeriod" className="input" placeholder="day / month / once" />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Expires (promo)
                    <input name="expiresAt" className="input" placeholder="YYYY-MM-DD" />
                  </label>
                  <label className="flex items-center gap-2 text-[13px] col-span-2"><input type="checkbox" name="requiresPaymentMethod" /> Requires payment method</label>
                  <label className="flex items-center gap-2 text-[13px] col-span-2"><input type="checkbox" name="paymentRequirementKnown" /> Payment requirement is evidenced (uncheck = unknown, shown as &ldquo;unknown&rdquo; not &ldquo;no card&rdquo;)</label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)] col-span-2">Source URL
                    <input name="sourceUrl" className="input" placeholder="https://…" />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)] col-span-2">Notes
                    <input name="notes" className="input" placeholder="What changed / why" />
                  </label>
                  <div className="col-span-2">
                    <button type="submit" className="btn btn-primary">Save verification</button>
                  </div>
                </form>
                <form action={act(markVerified)} className="mt-2">
                  <input type="hidden" name="id" value={q.availabilityId} />
                  <button type="submit" className="btn">Quick mark verified (no edits)</button>
                </form>
              </details>
            ))
          )}
        </div>
      </section>

      {/* Contradictions */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Data Quality · Contradictions</h2>
        {issues.length === 0 ? (
          <div className="card p-5 text-[13px] text-[var(--fg-dim)]">No contradictions detected. ✅</div>
        ) : (
          <div className="card divide-y divide-[var(--border)]">
            {issues.map((i, idx) => (
              <div key={idx} className="p-3 flex items-start gap-3">
                <span className="chip mt-0.5" style={{
                  color: i.severity === "critical" ? "#f87171" : i.severity === "warning" ? "#fbbf24" : "#60a5fa",
                  borderColor: i.severity === "critical" ? "#5e2a1f" : i.severity === "warning" ? "#5e4d18" : "#274a73",
                  background: i.severity === "critical" ? "#231014" : i.severity === "warning" ? "#1f1a08" : "#0d1929",
                }}>{i.severity}</span>
                <div className="min-w-0">
                  <div className="text-[13px]"><span className="font-mono text-[11px] text-[var(--fg-mute)]">{i.entityId}</span> — {i.message}</div>
                  <div className="text-[11px] text-[var(--fg-mute)]">code: {i.code}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="text-[12px] text-[var(--fg-mute)]">
          Critical {sevCounts.critical} · Warning {sevCounts.warning} · Info {sevCounts.info}
        </div>
      </section>

      {/* Data quality (transparency) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Data Quality · Transparency</h2>
        <p className="text-[13px] text-[var(--fg-dim)]">
          Per the evidence rule, &ldquo;unknown&rdquo; payment requirements must never render as &ldquo;no card&rdquo;. This panel shows coverage so gaps are visible.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-4"><div className="text-2xl font-bold">{dq.totalFreeRoutes}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Free routes</div></div>
          <div className="card p-4"><div className="text-2xl font-bold text-[#34d399]">{dq.paymentRequirementKnown}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Payment requirement known</div></div>
          <div className="card p-4"><div className="text-2xl font-bold text-[#fbbf24]">{dq.paymentRequirementUnknown}</div><div className="text-[12.5px] text-[var(--fg-dim)]">Payment requirement UNKNOWN</div></div>
          <div className="card p-4"><div className="text-2xl font-bold text-[#60a5fa]">{dq.coveragePct}%</div><div className="text-[12.5px] text-[var(--fg-dim)]">Payment req. coverage</div></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="card p-4">
            <div className="text-[12.5px] text-[var(--fg-dim)] mb-1">Freshness breakdown</div>
            {dq.byFreshness.map((f) => (
              <div key={f.tier} className="flex items-center justify-between text-[13px]"><span>{f.label}</span><span className="text-[var(--fg-mute)]">{f.count}</span></div>
            ))}
          </div>
          <div className="card p-4 md:col-span-2">
            <div className="text-[12.5px] text-[var(--fg-dim)] mb-1">Providers with unknown payment requirement</div>
            {dq.unknownByProvider.length === 0 ? (
              <div className="text-[13px] text-[var(--fg-dim)]">None — every free route has a known payment requirement. ✅</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {dq.unknownByProvider.map((p) => (
                  <span key={p.providerId} className="chip" style={{ color: "#fbbf24", borderColor: "#5e4d18", background: "#1f1a08" }}>{p.providerName}: {p.unknownCount}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Live collectors (administrative) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Live Collectors <span className="text-[var(--fg-mute)] text-[12px]">(administrative)</span></h2>
        <div className="card p-3 text-[12.5px] text-[#34d399] border" style={{ borderColor: "#1e5a2e", background: "#0c1f12" }}>
          <strong>Administrative operation.</strong> Runs the OpenRouter/Gemini live collectors, which write rows with{" "}
          <code className="mono">data_origin = &apos;live_collector&apos;</code> (auto, confidence <em>likely</em> — not human-verified).
          Protected by HTTP Basic Auth — requires valid admin credentials. CLI execution bypasses HTTP auth.
        </div>

        <CollectorRunner />

        <h3 className="text-[13px] font-semibold text-[var(--fg-dim)] uppercase tracking-wider">Last runs</h3>
        {runs.length === 0 ? (
          <div className="card p-4 text-[13px] text-[var(--fg-dim)]">No collector runs recorded yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-[var(--fg-mute)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">When</th>
                  <th className="text-right p-2">Disc.</th>
                  <th className="text-right p-2">Free</th>
                  <th className="text-right p-2">+Routes</th>
                  <th className="text-right p-2">−Routes</th>
                  <th className="text-right p-2">+Models</th>
                  <th className="text-right p-2">~Changed</th>
                  <th className="text-right p-2">Err</th>
                  <th className="text-right p-2">Warn</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r: CollectorRunRow) => {
                  const finished = r.finished_at ?? r.started_at;
                  const started = new Date(r.started_at).getTime();
                  const end = new Date(finished).getTime();
                  const durMs = Math.max(0, end - started);
                  const dur = durMs < 1000 ? `${durMs}ms` : `${(durMs / 1000).toFixed(1)}s`;
                  const statusColor = r.status === "success" ? "#34d399" : r.status === "partial" ? "#fbbf24" : "#f87171";
                  return (
                    <tr key={r.id} className="border-b border-[var(--border)]">
                      <td className="p-2" style={{ color: statusColor }}>{r.status}{r.dry_run ? " (dry)" : ""}</td>
                      <td className="p-2 text-[var(--fg-dim)]">{daysAgo(r.started_at)}</td>
                      <td className="p-2 text-right">{r.models_discovered}</td>
                      <td className="p-2 text-right">{r.free_models}</td>
                      <td className="p-2 text-right">{r.free_routes_added}</td>
                      <td className="p-2 text-right">{r.free_routes_removed}</td>
                      <td className="p-2 text-right">{r.models_added}</td>
                      <td className="p-2 text-right">{r.models_changed}</td>
                      <td className="p-2 text-right" style={{ color: r.error_count ? "#f87171" : undefined }}>{r.error_count}</td>
                      <td className="p-2 text-right">{r.warning_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Add free-access route</h2>
          <form action={act(addAvailability)} className="card p-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Model
                <select name="modelId" className="input" required>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Provider
                <select name="providerId" className="input" required>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Access type
                <select name="accessType" className="input">{ACCESS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Status
                <select name="status" className="input">{["available", "limited", "degraded", "temporarily_free", "unavailable"].map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Free quota value
                <input name="freeQuotaValue" type="number" className="input" placeholder="e.g. 1500" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Quota unit
                <input name="freeQuotaUnit" className="input" placeholder="requests / dollars" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Quota period
              <input name="freeQuotaPeriod" className="input" placeholder="day / month / once" />
            </label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="requiresPaymentMethod" /> Requires payment method</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="paymentRequirementKnown" checked /> Payment requirement evidenced</label>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Source URL
              <input name="sourceUrl" className="input" placeholder="https://…" />
            </label>
            <button type="submit" className="btn btn-primary self-start">Add route</button>
          </form>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Report a change (moderation queue)</h2>
          <form action={act(reportChange)} className="card p-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Entity ID
                <input name="entityId" className="input" placeholder="model__provider" required />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Change type
                <select name="fieldChanged" className="input">
                  {["status_change", "quota_change", "pricing_change", "removed", "added"].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">New value / description
              <input name="newValue" className="input" placeholder="e.g. free tier reduced to 500/day" required />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Notes
              <textarea name="notes" className="input" rows={2} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Source URL
              <input name="sourceUrl" className="input" placeholder="https://…" />
            </label>
            <button type="submit" className="btn btn-primary self-start">Submit report</button>
          </form>
          <p className="text-[12px] text-[var(--fg-mute)]">Reports enter the change history as <span className="text-[#fbbf24]">UNVERIFIED</span> until an admin confirms them.</p>
        </section>
      </div>
    </div>
  );
}
