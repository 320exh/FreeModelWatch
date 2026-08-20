import { Suspense } from "react";
import Link from "next/link";
import { getAllProviders, getAllHarnesses, queryModels } from "@/lib/queries";
import { ModelCard } from "@/components/ModelCard";
import { FilterBar } from "@/components/FilterBar";
import type { ModelFilters } from "@/lib/queries";
import type { AccessType, VerificationConfidence, DataOrigin } from "@/lib/types";

export const dynamic = "force-dynamic";

function csv(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v[0] : v).split(",").filter(Boolean);
}
function bool(v: string | string[] | undefined): boolean {
  return v === "1" || v === "true";
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const providers = getAllProviders();
  const harnesses = getAllHarnesses();

  const filters: ModelFilters = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    access: csv(sp.access) as AccessType[],
    verified: csv(sp.verified) as VerificationConfidence[],
    origin: csv(sp.origin) as DataOrigin[],
    coding: bool(sp.coding),
    reasoning: bool(sp.reasoning),
    vision: bool(sp.vision),
    toolCalling: bool(sp.toolCalling),
    structuredOutput: bool(sp.structuredOutput),
    longContext: bool(sp.longContext),
    openSource: bool(sp.openSource),
    provider: csv(sp.provider),
    harness: typeof sp.harness === "string" ? sp.harness : undefined,
    noPayment: bool(sp.nopay) || bool(sp.noCard),
    noSignup: bool(sp.nosignup),
    apiKeyRequired: sp.apikey === "1" ? true : sp.apikey === "0" ? false : null,
    minContext: sp.minctx ? Number(sp.minctx) : undefined,
    sort: (typeof sp.sort === "string" ? (sp.sort as ModelFilters["sort"]) : "relevance"),
  };

  const results = queryModels(filters);
  const seedInResults = results.filter((m) => m.dataQuality === "seed" || m.dataQuality === "mixed").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Models</h1>
          <p className="text-[var(--fg-dim)] text-[13.5px]">
            {results.length} model{results.length === 1 ? "" : "s"} matching current filters
            {filters.q ? ` for “${filters.q}”` : ""}.
          </p>
          {seedInResults > 0 && (
            <p className="text-[12px] text-[#d9c27a] mt-1">
              {seedInResults} of these rely on demo/seed data — confirm against the linked source before relying.
            </p>
          )}
        </div>
        <Link href="/best" className="btn">
          Best free rankings →
        </Link>
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-5 items-start">
        <Suspense fallback={<div className="card p-4 text-[var(--fg-dim)]">Loading filters…</div>}>
          <FilterBar providers={providers} harnesses={harnesses} />
        </Suspense>

        <div>
          {results.length === 0 ? (
            <div className="card p-10 text-center text-[var(--fg-dim)]">
              No models match these filters. <Link href="/models" className="text-[var(--accent)] underline">Reset</Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {results.map((m) => (
                <ModelCard key={m.id} m={m} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
