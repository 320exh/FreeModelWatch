import Link from "next/link";
import { getDashboardStats, getModelViews, rankModels } from "@/lib/queries";
import { ModelCard } from "@/components/ModelCard";
import { AccessBadge, ConfidenceBadge, StatusIcon } from "@/components/ui";
import { daysAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({ value, label, sub, href }: { value: string | number; label: string; sub?: string; href?: string }) {
  const inner = (
    <div className="card p-4 flex flex-col gap-1">
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="text-[13px] text-[var(--fg-dim)]">{label}</div>
      {sub ? <div className="text-[11px] text-[var(--fg-mute)]">{sub}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

const ALERT_STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  new: { bg: "#0e1f18", fg: "#34d399", icon: "🆕" },
  down: { bg: "#231014", fg: "#f87171", icon: "🔴" },
  warn: { bg: "#1f1a08", fg: "#fbbf24", icon: "⚠️" },
  info: { bg: "#0d1929", fg: "#60a5fa", icon: "ℹ️" },
};

export default function DashboardPage() {
  const stats = getDashboardStats();
  const views = getModelViews().filter((m) => m.freeRouteCount > 0);
  const bestCoding = rankModels(views, (m) => (m.codingCapability ?? 0) >= 4).slice(0, 6);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Free AI Model Availability</h1>
        <p className="text-[var(--fg-dim)] max-w-2xl text-[14px]">
          A living database of which AI models you can use <span className="text-[var(--accent)]">for free, right now</span> —
          through APIs, aggregators, local runtimes, and coding harnesses. Every claim links to its source and shows when it was last verified.
        </p>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat value={stats.totalFreeModels} label="Free models tracked" href="/models" />
        <Stat value={stats.freeApiProviders} label="Providers w/ free access" href="/providers" />
        <Stat value={stats.harnessFreeModels} label="Models free in harnesses" href="/harnesses" />
        <Stat value={stats.totalHarnesses} label="Coding harnesses" href="/harnesses" />
        <Stat value={stats.staleCount} label="Entries needing verify" sub="30+ days old" href="/admin" />
      </section>

      {stats.alerts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-[var(--fg-dim)] uppercase tracking-wider">Alerts</h2>
          <div className="flex flex-col gap-2">
            {stats.alerts.map((a, i) => {
              const s = ALERT_STYLE[a.level];
              const content = (
                <div className="card p-3 flex items-center gap-3" style={{ background: s.bg }}>
                  <span>{s.icon}</span>
                  <span className="text-[13.5px]" style={{ color: s.fg }}>
                    {a.text}
                  </span>
                </div>
              );
              return a.href ? <Link key={i} href={a.href}>{content}</Link> : <div key={i}>{content}</div>;
            })}
          </div>
        </section>
      )}

      <section className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Best free coding models</h2>
            <Link href="/best" className="text-[13px] text-[var(--accent)] hover:underline">
              Full rankings →
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {bestCoding.map(({ view, score }) => (
              <ModelCard key={view.id} m={view} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Recent changes</h2>
          <div className="card divide-y divide-[var(--border)]">
            {[...stats.newlyFree, ...stats.recentlyRemoved].slice(0, 8).map((c) => (
              <Link key={c.id} href="/changes" className="block p-3 hover:bg-[var(--bg-elev2)]">
                <div className="flex items-center gap-2 text-[13px]">
                  <StatusIcon status={c.fieldChanged === "removed" || /unavailable/i.test(c.newValue ?? "") ? "unavailable" : "available"} />
                  <span className="font-medium">{c.fieldChanged}</span>
                  <span className="text-[var(--fg-mute)] ml-auto text-[11px]">{daysAgo(c.detectedAt)}</span>
                </div>
                <div className="text-[12px] text-[var(--fg-dim)] mt-0.5 line-clamp-2">{c.notes}</div>
              </Link>
            ))}
            {stats.newlyFree.length + stats.recentlyRemoved.length === 0 && (
              <div className="p-3 text-[13px] text-[var(--fg-mute)]">No recent changes recorded.</div>
            )}
          </div>
          <Link href="/changes" className="text-[13px] text-[var(--accent)] hover:underline">
            View full change history →
          </Link>
        </div>
      </section>
    </div>
  );
}
