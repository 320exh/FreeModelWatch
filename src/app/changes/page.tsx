import { getChanges, getModel, getProvider } from "@/lib/queries";
import { getCategorizedChanges, CHANGE_CATEGORY_META } from "@/lib/intelligence";
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

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; prov?: string; model?: string }>;
}) {
  const sp = await searchParams;
  const changes = getChanges(200);
  const categorized = getCategorizedChanges(changes);

  const catFilter = sp.cat;
  const filtered = catFilter
    ? categorized.filter((c) => c.category === catFilter)
    : categorized;

  const counts = categorized.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1;
    return acc;
  }, {});

  const categories = Object.keys(CHANGE_CATEGORY_META) as Array<keyof typeof CHANGE_CATEGORY_META>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Change History</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px]">A timeline of free-access changes across tracked models and providers, grouped by category.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href="/changes" className={`card px-3 py-2 flex items-center gap-2 ${!catFilter ? "ring-1 ring-[var(--accent)]" : ""}`}>
          <span className="text-[13px]">All</span>
          <span className="text-[var(--fg-dim)] text-[12px]">{categorized.length}</span>
        </a>
        {categories.map((key) => {
          const meta = CHANGE_CATEGORY_META[key];
          const n = counts[key] ?? 0;
          const active = catFilter === key;
          return (
            <a key={key} href={`/changes?cat=${key}`} className={`card px-3 py-2 flex items-center gap-2 ${active ? "ring-1 ring-[var(--accent)]" : ""}`} style={{ borderColor: meta.color }}>
              <span>{meta.icon}</span>
              <span className="text-[13px]">{meta.label}</span>
              <span className="text-[var(--fg-dim)] text-[12px]">{n}</span>
            </a>
          );
        })}
      </div>

      <div className="card divide-y divide-[var(--border)]">
        {filtered.length === 0 ? (
          <div className="p-6 text-[var(--fg-dim)]">No changes recorded yet.</div>
        ) : (
          filtered.map((c) => {
            const meta = CHANGE_CATEGORY_META[c.category];
            const color = meta?.color ?? "#9ca3af";
            return (
              <div key={c.id} className="p-4 flex gap-4">
                <div className="flex flex-col items-center gap-1 w-14 shrink-0">
                  <span className="text-[var(--fg-dim)] text-[11px]">{daysAgo(c.detectedAt)}</span>
                </div>
                <div className="w-1 rounded" style={{ background: color }} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold" style={{ color }}>{meta?.icon} {meta?.label ?? c.category}</span>
                    <span className="font-medium">{entityName(c.entityId)}</span>
                    {c.scope !== "global" && c.providerId && (
                      <a href={`/providers/${c.providerId}`} className="chip" style={{ color: "#60a5fa", borderColor: "#1d4e57", background: "#08222a" }}>
                        {getProvider(c.providerId)?.name ?? c.providerId}
                      </a>
                    )}
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

      <details className="card p-4 text-[12.5px] text-[var(--fg-dim)]">
        <summary className="cursor-pointer text-[var(--fg)]">Raw field-level changes</summary>
        <div className="mt-3 divide-y divide-[var(--border)]">
          {changes.map((c) => (
            <div key={c.id} className="py-2 flex gap-3">
              <span className="w-40 shrink-0">{FIELD_LABEL[c.fieldChanged ?? ""] ?? c.fieldChanged ?? ""}</span>
              <span className="flex-1">{entityName(c.entityId)}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
