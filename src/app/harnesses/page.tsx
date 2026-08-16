import Link from "next/link";
import { getAllHarnesses, getHarnessCompat } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Free Models for AI Coding Harnesses",
  description: "Which free AI models work with Claude Code, OpenCode, Cline, Roo Code, Aider, Continue, Cursor and Windsurf.",
};

export default function HarnessesPage() {
  const harnesses = getAllHarnesses();
  const hc = getHarnessCompat();
  const counts = new Map<string, number>();
  for (const c of hc) if (c.freeStatus === "free") counts.set(c.harnessId, (counts.get(c.harnessId) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Coding Harnesses</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px]">Track which free models plug into each AI coding environment.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {harnesses.map((h) => (
          <Link key={h.id} href={`/harnesses/${h.id}`} className="card card-hover p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{h.name}</div>
              <span className="text-[var(--accent)] font-semibold text-[13px]">{counts.get(h.id) ?? 0} free</span>
            </div>
            <p className="text-[12.5px] text-[var(--fg-dim)] line-clamp-3">{h.description}</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {h.supportsCustomOpenaiEndpoint && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>OpenAI EP</span>}
              {h.supportsAnthropicEndpoint && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>Anthropic EP</span>}
              {h.supportsOpenrouterRouting && <span className="chip" style={{ color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }}>OpenRouter</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
