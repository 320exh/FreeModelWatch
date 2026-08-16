import Link from "next/link";

export const metadata = { title: "Public API" };

function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="chip" style={{ color: "#34d399", borderColor: "#1f5e47", background: "#0e1f18" }}>{method}</span>
        <code className="mono text-[13px] text-[var(--accent)]">{path}</code>
      </div>
      <p className="text-[13px] text-[var(--fg-dim)]">{desc}</p>
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Public API</h1>
        <p className="text-[var(--fg-dim)] text-[13.5px]">Read-only JSON endpoints. No auth required (rate-limited in production).</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Endpoints</h2>
        <Endpoint method="GET" path="/api/models/free" desc="All currently-free models with their routes. Supports filters: q, access, coding, vision, reasoning, toolCalling, openSource, provider, harness, noPayment, noSignup, minContext, sort." />
        <Endpoint method="GET" path="/api/models/{id}" desc="Full detail for one model: routes, harness compatibility, sources, change history." />
        <Endpoint method="GET" path="/api/providers" desc="All providers and aggregators." />
        <Endpoint method="GET" path="/api/providers/{id}/free-models" desc="Free models currently available through a given provider." />
        <Endpoint method="GET" path="/api/harnesses/{id}/free-models" desc="Free models usable with a given coding harness." />
        <Endpoint method="GET" path="/api/changes" desc="Recent change-history entries (free-status changes). Use ?limit=N." />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Example</h2>
        <div className="card p-4 flex flex-col gap-2">
          <code className="mono text-[12.5px] text-[var(--fg-dim)]"># Free coding models usable with OpenCode</code>
          <code className="mono text-[12.5px] text-[var(--accent)]">GET /api/models/free?harness=opencode&coding=true&vision=false</code>
          <pre className="mono text-[12px] bg-[var(--bg)] p-3 rounded-md overflow-x-auto scrollbar-thin text-[var(--fg-dim)]">{`{
  "count": 12,
  "models": [
    { "id": "deepseek-chat", "name": "DeepSeek V3 (Chat)",
      "bestAccessType": "free_tier", "bestStatus": "available",
      "routes": [ { "providerName": "DeepSeek", "accessType": "free_tier", ... } ] }
  ]
}`}</pre>
        </div>
      </section>

      <div className="text-[13px] text-[var(--fg-dim)]">
        Live tester: <Link href="/models?harness=opencode&coding=true" className="text-[var(--accent)] hover:underline">open the models page with filters →</Link>
      </div>
    </div>
  );
}
