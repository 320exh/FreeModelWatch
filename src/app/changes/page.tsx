import { getChanges, getModel, getProvider } from "@/lib/queries";
import { daysAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Free Model Change History",
  description: "A timeline of free AI model availability changes: newly free, removed, quota changes, and pricing shifts.",
};

const FIELD_LABEL: Record<string, string> = {
  added: "Added",
  removed: "Removed",
  status_change: "Status change",
  quota_change: "Quota change",
  rate_limit_change: "Rate limit change",
  pricing_change: "Pricing change",
  provider_change: "Provider change",
  harness_compatibility_change: "Harness compat",
};

function entityName(entityId: string): string {
  const model = getModel(entityId.split("__")[0]);
  if (model) return model.name;
  return entityId;
}

export default function ChangesPage() {
  const changes = getChanges(100);

  const buckets: { key: string; label: string; color: string; icon: string }[] = [
    { key: "added", label: "Newly free", color: "#34d399", icon: "🆕" },
    { key: "removed", label: "Removed", color: "#f87171", icon: "🔴" },
    { key: "quota_change", label: "Quota changes", color: "#fbbf24", icon: "📉" },
    { key: "status_change", label: "Status changes", color: "#60a5fa", icon: "🔄" },
    { key: "pricing_change", label: "Pricing", color: "#c084fc", icon: "💲" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Change History</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px]">A timeline of free-access changes across tracked models and providers.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {buckets.map((b) => {
          const n = changes.filter((c) => c.fieldChanged === b.key).length;
          return (
            <div key={b.key} className="card px-3 py-2 flex items-center gap-2" style={{ borderColor: b.color }}>
              <span>{b.icon}</span>
              <span className="text-[13px]">{b.label}</span>
              <span className="text-[var(--fg-dim)] text-[12px]">{n}</span>
            </div>
          );
        })}
      </div>

      <div className="card divide-y divide-[var(--border)]">
        {changes.length === 0 ? (
          <div className="p-6 text-[var(--fg-dim)]">No changes recorded yet.</div>
        ) : (
          changes.map((c) => {
            const color = buckets.find((b) => b.key === c.fieldChanged)?.color ?? "#9ca3af";
            return (
              <div key={c.id} className="p-4 flex gap-4">
                <div className="flex flex-col items-center gap-1 w-14 shrink-0">
                  <span className="text-[var(--fg-dim)] text-[11px]">{daysAgo(c.detectedAt)}</span>
                </div>
                <div className="w-1 rounded" style={{ background: color }} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold" style={{ color }}>{c.fieldChanged ? (FIELD_LABEL[c.fieldChanged] ?? c.fieldChanged) : "—"}</span>
                    <span className="font-medium">{entityName(c.entityId)}</span>
                    {c.verifiedAt ? (
                      <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>VERIFIED</span>
                    ) : (
                      <span className="chip" style={{ color: "#fbbf24", borderColor: "#5e4d18", background: "#1f1a08" }}>UNVERIFIED</span>
                    )}
                  </div>
                  <div className="text-[13px] text-[var(--fg-dim)] mt-1">
                    {c.oldValue && <span className="line-through opacity-60">{c.oldValue}</span>}
                    {c.oldValue && c.newValue && " → "}
                    {c.newValue && <span className="text-[var(--fg)]">{c.newValue}</span>}
                  </div>
                  {c.notes && <div className="text-[12.5px] text-[var(--fg-dim)] mt-0.5">{c.notes}</div>}
                  {c.sourceUrl && (
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--accent)] hover:underline">
                      Source ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
