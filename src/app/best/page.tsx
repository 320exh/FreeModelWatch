import Link from "next/link";
import { getModelViews, rankModels, getHarnessCompat, getAllHarnesses, type ScoredModel } from "@/lib/queries";
import { recommendFreeAccess, type RecommendRequirements } from "@/lib/intelligence";
import { AccessBadge, ConfidenceBadge, OpenBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Best Free AI Models — Rankings",
  description: "Automatically ranked free AI models for coding, reasoning, vision, long context, and coding harnesses like OpenCode and Claude Code.",
};

function harnessModelIds(harnessId: string): Set<string> {
  return new Set(getHarnessCompat({ harnessId }).filter((h) => h.freeStatus === "free").map((h) => h.modelId));
}

const HIGHLIGHT = "#34d399";

const PRIORITIES = [
  { v: "coding", label: "Coding" },
  { v: "reasoning", label: "Reasoning" },
  { v: "vision", label: "Vision" },
  { v: "longContext", label: "Long context" },
  { v: "general", label: "General" },
];

export default async function BestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const priority = (one("priority") as RecommendRequirements["priority"]) || "coding";
  const prioritizeNoCard = one("noCard") === "1" || one("noCard") === "true";
  const prioritizeNoSignup = one("noSignup") === "1" || one("noSignup") === "true";
  const prioritizeNoApiKey = one("noApiKey") === "1" || one("noApiKey") === "true";
  const openSourceOnly = one("openSource") === "1" || one("openSource") === "true";
  const contextMin = one("contextMin") ? Number(one("contextMin")) : undefined;
  const harness = one("harness") || undefined;

  const reqs: RecommendRequirements = {
    priority,
    prioritizeNoCard,
    prioritizeNoSignup,
    prioritizeNoApiKey,
    openSourceOnly,
    contextMin: contextMin && Number.isFinite(contextMin) ? contextMin : undefined,
    harness,
    limit: 10,
  };
  const recommendations = recommendFreeAccess(reqs);

  const views = getModelViews().filter((m) => m.freeRouteCount > 0);
  const opencodeIds = harnessModelIds("opencode");
  const claudeCodeIds = harnessModelIds("claude-code");
  const harnesses = getAllHarnesses();
  const hasFilters = !!one("priority") || prioritizeNoCard || prioritizeNoSignup || prioritizeNoApiKey || openSourceOnly || !!contextMin || !!harness;

  const sections: {
    title: string;
    desc: string;
    scored: ScoredModel[];
  }[] = [
    { title: "Best Free Coding Models", desc: "Highest coding capability among free routes.", scored: rankModels(views, (m) => (m.codingCapability ?? 0) >= 4) },
    { title: "Best Free Reasoning Models", desc: "Models with explicit reasoning support.", scored: rankModels(views, (m) => m.reasoningSupport) },
    { title: "Best Free Vision Models", desc: "Multimodal models that accept images.", scored: rankModels(views, (m) => m.visionSupport) },
    { title: "Best Free Long-Context Models", desc: "Free models with 100K+ token context.", scored: rankModels(views, (m) => (m.contextWindow ?? 0) >= 100000) },
    { title: "Best Free Models for OpenCode", desc: "Free models confirmed compatible with OpenCode.", scored: rankModels(views, (m) => opencodeIds.has(m.id)) },
    { title: "Best Free Models for Claude Code", desc: "Free models usable via Claude Code (incl. shims).", scored: rankModels(views, (m) => claudeCodeIds.has(m.id)) },
    { title: "Best Free APIs (no card)", desc: "Free routes that do not require a payment method.", scored: rankModels(views, (m) => m.noPaymentMethod) },
    { title: "Best Free Through Aggregators", desc: "Free via aggregators like OpenRouter.", scored: rankModels(views, (m) => m.routes.some((r) => r.availability.accessType === "free_through_aggregator")) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Best Free AI Models</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px] max-w-3xl">
          Rankings are <span className="text-[var(--fg)]">calculated</span>, not authoritative — a weighted score over capability, free quota, setup friction, verification confidence, context, and current status. Always check the linked source before relying on an entry.
        </p>
      </div>

      {/* Recommendation engine (req 4) */}
      <section className="card p-4 flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Find the right free model for your task 🎯</h2>
          <p className="text-[12.5px] text-[var(--fg-dim)]">
            Transparent ranking: each result explains <span className="text-[var(--fg)]">why it matched</span> your needs and{" "}
            <span className="text-[var(--fg)]">why it ranks above the next option</span>. No black-box scores.
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">I mostly need
            <select name="priority" className="input" defaultValue={priority}>
              {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Min context (tokens)
            <input name="contextMin" className="input" placeholder="100000" defaultValue={contextMin ?? ""} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-dim)]">Works in harness
            <select name="harness" className="input" defaultValue={harness ?? ""}>
              <option value="">Any</option>
              {harnesses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="noCard" value="1" defaultChecked={prioritizeNoCard} /> No card</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="noSignup" value="1" defaultChecked={prioritizeNoSignup} /> No signup</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="noApiKey" value="1" defaultChecked={prioritizeNoApiKey} /> No API key</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="openSource" value="1" defaultChecked={openSourceOnly} /> Open source</label>
          <button className="btn btn-primary" type="submit">Recommend</button>
          {hasFilters && <Link href="/best" className="btn">Clear</Link>}
        </form>

        {hasFilters && (
          <div className="card divide-y divide-[var(--border)] mt-1">
            {recommendations.length === 0 ? (
              <div className="p-4 text-[13px] text-[var(--fg-dim)]">No free route satisfies these requirements.</div>
            ) : (
              recommendations.map((rec, i) => (
                <div key={rec.routeId} className="p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="w-6 text-center font-bold text-[var(--fg-mute)]">{i + 1}</span>
                    <Link href={`/models/${rec.modelId}`} className="font-medium hover:underline">{rec.modelName}</Link>
                    <span className="chip" style={{ color: "#60a5fa", borderColor: "#1d4e57", background: "#08222a" }}>{rec.providerName}</span>
                    <AccessBadge type={rec.accessType} short />
                    <span className="ml-auto chip font-bold" style={{ color: HIGHLIGHT, borderColor: "#1f5e47" }}>score {rec.matchScore}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {rec.matchReasons.map((r, j) => (
                      <span key={j} className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18", fontSize: 11 }}>✓ {r}</span>
                    ))}
                  </div>
                  {rec.rankReasons.length > 0 && (
                    <div className="text-[11.5px] text-[var(--fg-dim)]">Why above the rest: {rec.rankReasons.join(" · ")}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {sections.map((s) => (
          <section key={s.title} className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="text-[12.5px] text-[var(--fg-dim)]">{s.desc}</p>
            </div>
            {s.scored.length === 0 ? (
              <div className="card p-5 text-[var(--fg-dim)] text-[13px]">No models match this category.</div>
            ) : (
              <div className="card divide-y divide-[var(--border)]">
                {s.scored.slice(0, 8).map(({ view, score }, i) => (
                  <Link key={view.id} href={`/models/${view.id}`} className="flex items-center gap-3 p-3 hover:bg-[var(--bg-elev2)]">
                    <span className="w-6 text-center font-bold text-[var(--fg-mute)]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{view.name}</span>
                        <OpenBadge open={view.isOpenSource} />
                        {view.codingCapability ? <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>C{view.codingCapability}</span> : null}
                        {view.visionSupport && <span className="chip" style={{ color: "#22d3ee", borderColor: "#1d4e57", background: "#08222a" }}>V</span>}
                        {view.reasoningSupport && <span className="chip" style={{ color: "#c084fc", borderColor: "#4a2e6b", background: "#1a1024" }}>R</span>}
                      </div>
                      <div className="text-[11.5px] text-[var(--fg-dim)] mt-0.5 truncate">
                        {view.routes[0]?.provider.name} · {view.routes.length} free route(s) · ctx {view.contextWindow?.toLocaleString()}
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        <ScoreChip label="cap" v={score.capability} title="Capability" />
                        <ScoreChip label="free" v={score.freeAccess} title="Free-access quality" />
                        <ScoreChip label="rel" v={score.reliability} title="Verification reliability" />
                        <ScoreChip label="fresh" v={score.freshness} title="Data freshness" />
                        <ScoreChip label="avail" v={score.availability} title="Availability status" />
                      </div>
                      {view.dataQuality !== "live" && (
                        <div className="text-[10.5px] text-[var(--fg-mute)]">
                          {view.dataQuality === "seed" ? "Ranked on demo/seed data." : view.dataQuality === "stale" ? "Ranked on stale/expired data." : "Ranked on mixed data quality."}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-bold" style={{ color: HIGHLIGHT }}>{score.total}</div>
                      <ConfidenceBadge conf={view.bestConfidence} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function ScoreChip({ label, v, title }: { label: string; v: number; title?: string }) {
  return (
    <span className="chip" style={{ color: "#6b7280", borderColor: "#23262f", background: "#0d0f14", fontSize: 10 }} title={title ? `${title}: ${v}` : undefined}>
      {label} {v}
    </span>
  );
}
