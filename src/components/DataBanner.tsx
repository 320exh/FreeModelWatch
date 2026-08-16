import { getDataState } from "@/lib/queries";

/**
 * Distinguishes LIVE COLLECTOR data from DEMO/SEED data. When live OpenRouter
 * data has been imported, the banner no longer claims the entire application is
 * demo data — it communicates the accurate, mixed state instead.
 */
export async function DataBanner() {
  const state = getDataState();

  if (!state.hasSeed && !state.hasLive) return null;

  if (state.hasLive && state.hasSeed) {
    return (
      <div className="border-b border-[var(--border)] bg-[#0d1929] text-[#93c5fd] text-[12.5px]">
        <div className="w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-2 flex items-center gap-2 flex-wrap">
          <span className="font-bold text-[#34d399]">● LIVE COLLECTOR DATA</span>
          <span className="text-[#d9c27a] font-bold">● SEED DEMO DATA</span>
          <span className="text-[#b9c6da]">
            Mixed dataset: {state.liveRouteCount} live-collected route(s) from {state.liveProviders.join(", ")}
            {" "}coexist with {state.seedRouteCount} curated seed/demo route(s). Verify against the linked official source before relying.
          </span>
        </div>
      </div>
    );
  }

  if (state.hasLive) {
    return (
      <div className="border-b border-[var(--border)] bg-[#0e1f18] text-[#34d399] text-[12.5px]">
        <div className="w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-2 flex items-center gap-2">
          <span className="font-bold">● LIVE COLLECTOR DATA</span>
          <span className="text-[#a7d8c4]">
            {state.liveRouteCount} route(s) imported live from {state.liveProviders.join(", ")}. Auto-collected — confidence is
            {" "}<em>likely</em>, not human-verified. Verify against the linked source before relying.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--border)] bg-[#1a1407] text-[#fbbf24] text-[12.5px]">
      <div className="w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-2 flex items-center gap-2">
        <span className="font-bold">⚠ DEMO DATA</span>
        <span className="text-[#d9c27a]">
          This is a curated seed dataset to demonstrate the product. Free AI availability changes constantly — every
          entry carries a confidence level and last-verified date. Verify against the linked official source before relying on it.
        </span>
      </div>
    </div>
  );
}
