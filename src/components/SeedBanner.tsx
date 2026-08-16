export function SeedBanner() {
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
