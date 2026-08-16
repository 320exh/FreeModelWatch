"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/models", label: "Models" },
  { href: "/providers", label: "Providers" },
  { href: "/harnesses", label: "Harnesses" },
  { href: "/compare", label: "Compare" },
  { href: "/best", label: "Best Free" },
  { href: "/changes", label: "Changes" },
  { href: "/api-docs", label: "API" },
  { href: "/admin", label: "Admin" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur">
      <div className="w-full mx-auto max-w-[1400px] px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold shrink-0">
          <span className="text-[var(--accent)] text-lg">◆</span>
          <span>FreeModel<span className="text-[var(--accent)]">Watch</span></span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`nav-link ${active ? "active" : ""}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto md:hidden" />
      </div>
      <nav className="md:hidden flex items-center gap-1 overflow-x-auto scrollbar-thin px-3 pb-2">
        {LINKS.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`nav-link ${active ? "active" : ""}`}>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
