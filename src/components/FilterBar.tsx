"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import type { AccessType, Provider, Harness, DataOrigin, CollectionMode } from "@/lib/types";
import { ACCESS_LABELS } from "@/lib/format";

const ACCESS_TYPES: AccessType[] = [
  "completely_free",
  "free_tier",
  "free_credits",
  "free_with_limits",
  "free_through_aggregator",
  "free_local",
  "temporarily_free",
  "community_unofficial",
  "direct_api",
];

const CAPS = [
  { key: "coding", label: "Coding" },
  { key: "vision", label: "Vision" },
  { key: "reasoning", label: "Reasoning" },
  { key: "toolCalling", label: "Tools" },
  { key: "structuredOutput", label: "JSON" },
  { key: "longContext", label: "100K+ ctx" },
  { key: "openSource", label: "Open" },
];

const REQS = [
  { key: "nopay", label: "No payment" },
  { key: "nosignup", label: "No signup" },
];

const VERIFIED = [
  { key: "verified", label: "Verified" },
  { key: "likely", label: "Likely" },
  { key: "unverified", label: "Unverified" },
];

const ORIGINS: { key: DataOrigin; label: string }[] = [
  { key: "live_collector", label: "Live collector" },
  { key: "production", label: "Verified production" },
  { key: "seed", label: "Demo / Seed" },
  { key: "user_report", label: "User report" },
];

const COLLECTION_MODES: { key: CollectionMode; label: string; tooltip?: string }[] = [
  { key: "live", label: "Live" },
  { key: "frozen", label: "Frozen fallback", tooltip: "Collector fallback data (frozen snapshot used when live collection fails or no API key is available). Not live-verified." },
  { key: "seed", label: "Demo / Seed" },
];

const SORTS = [
  { key: "live-first", label: "Live First" },
  { key: "relevance", label: "Relevance" },
  { key: "context", label: "Context" },
  { key: "coding", label: "Coding" },
  { key: "recent", label: "Newest" },
  { key: "freshness", label: "Freshness" },
  { key: "reliability", label: "Reliability" },
];

export function FilterBar({ providers, harnesses }: { providers: Provider[]; harnesses: Harness[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  useEffect(() => {
    setQ(sp.get("q") ?? "");
  }, [sp]);

  function current(): URLSearchParams {
    return new URLSearchParams(Array.from(sp.entries()));
  }
  function toggleCSV(key: string, value: string) {
    const p = current();
    const set = new Set((p.get(key) ?? "").split(",").filter(Boolean));
    if (set.has(value)) set.delete(value);
    else set.add(value);
    if (set.size) p.set(key, Array.from(set).join(","));
    else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  }
  function setBool(key: string, on: boolean) {
    const p = current();
    if (on) p.set(key, "1");
    else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  }
  function setVal(key: string, value: string) {
    const p = current();
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  }
  function hasCSV(key: string, value: string) {
    return (sp.get(key) ?? "").split(",").includes(value);
  }
  function hasBool(key: string) {
    return sp.get(key) === "1";
  }
  function reset() {
    router.push(pathname);
  }

  const activeCount =
    (sp.get("q") ? 1 : 0) +
    ACCESS_TYPES.filter((a) => hasCSV("access", a)).length +
    CAPS.filter((c) => hasBool(c.key)).length +
    REQS.filter((r) => hasBool(r.key)).length +
    VERIFIED.filter((v) => hasCSV("verified", v.key)).length +
    ORIGINS.filter((o) => hasCSV("origin", o.key)).length +
    COLLECTION_MODES.filter((c) => hasCSV("collection_mode", c.key)).length +
    (sp.get("provider") ? 1 : 0) +
    (sp.get("harness") ? 1 : 0) +
    (sp.get("minctx") ? 1 : 0);

  return (
    <div className="card p-4 flex flex-col gap-3 sticky top-[112px]">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search models, providers, families…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setVal("q", q.trim());
          }}
        />
        <button className="btn btn-primary" onClick={() => setVal("q", q.trim())}>
          Search
        </button>
        {activeCount > 0 && (
          <button className="btn" onClick={reset} title="Clear filters">
            Clear ({activeCount})
          </button>
        )}
      </div>

      <FilterRow label="Access">
        {ACCESS_TYPES.map((a) => (
          <Toggle key={a} active={hasCSV("access", a)} onClick={() => toggleCSV("access", a)}>
            {ACCESS_LABELS[a]}
          </Toggle>
        ))}
      </FilterRow>

      <FilterRow label="Capability">
        {CAPS.map((c) => (
          <Toggle key={c.key} active={hasBool(c.key)} onClick={() => setBool(c.key, !hasBool(c.key))}>
            {c.label}
          </Toggle>
        ))}
      </FilterRow>

      <FilterRow label="Requirements">
        {REQS.map((r) => (
          <Toggle key={r.key} active={hasBool(r.key)} onClick={() => setBool(r.key, !hasBool(r.key))}>
            {r.label}
          </Toggle>
        ))}
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--fg-dim)] ml-1">
          API key
          <select
            className="input py-1"
            value={sp.get("apikey") ?? ""}
            onChange={(e) => setVal("apikey", e.target.value)}
          >
            <option value="">any</option>
            <option value="1">required</option>
            <option value="0">not required</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--fg-dim)]">
          Min ctx
          <select
            className="input py-1"
            value={sp.get("minctx") ?? ""}
            onChange={(e) => setVal("minctx", e.target.value)}
          >
            <option value="">any</option>
            <option value="32000">32K</option>
            <option value="100000">100K</option>
            <option value="128000">128K</option>
            <option value="1000000">1M</option>
          </select>
        </label>
      </FilterRow>

      <FilterRow label="Verification">
        {VERIFIED.map((v) => (
          <Toggle
            key={v.key}
            active={hasCSV("verified", v.key)}
            onClick={() => toggleCSV("verified", v.key)}
          >
            {v.label}
          </Toggle>
        ))}
      </FilterRow>

      <FilterRow label="Data Source">
        {ORIGINS.map((o) => (
          <Toggle
            key={o.key}
            active={hasCSV("origin", o.key)}
            onClick={() => toggleCSV("origin", o.key)}
          >
            {o.label}
          </Toggle>
        ))}
      </FilterRow>

      <FilterRow label="Collection Mode">
        {COLLECTION_MODES.map((c) => (
          <Toggle
            key={c.key}
            active={hasCSV("collection_mode", c.key)}
            onClick={() => toggleCSV("collection_mode", c.key)}
            title={c.tooltip}
          >
            {c.label}
          </Toggle>
        ))}
      </FilterRow>

      <FilterRow label="Provider">
        <select
          className="input"
          value={sp.get("provider") ?? ""}
          onChange={(e) => setVal("provider", e.target.value)}
        >
          <option value="">Any provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-[var(--fg-mute)] text-[11px]">(single select)</span>
      </FilterRow>

      <FilterRow label="Harness">
        <select
          className="input"
          value={sp.get("harness") ?? ""}
          onChange={(e) => setVal("harness", e.target.value)}
        >
          <option value="">Any harness</option>
          {harnesses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--fg-dim)] ml-auto">
          Sort
          <select className="input py-1" value={sp.get("sort") ?? "relevance"} onChange={(e) => setVal("sort", e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] uppercase tracking-wider text-[var(--fg-mute)] font-semibold">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Toggle({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      className="chip cursor-pointer select-none"
      style={
        active
          ? { color: "#06101f", background: "var(--accent)", borderColor: "var(--accent)" }
          : { color: "#9aa1b0", borderColor: "#2f3340", background: "#111319" }
      }
      title={title}
    >
      {children}
    </button>
  );
}
