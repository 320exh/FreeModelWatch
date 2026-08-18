import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { DataBanner } from "@/components/DataBanner";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://freeai.today"),
  title: {
    default: "FreeModelWatch — Free AI Model Availability Tracker",
    template: "%s · FreeModelWatch",
  },
  alternates: {
    canonical: "/",
  },
  description:
    "Track which AI models are free right now: free tiers, free credits, aggregators, local models, and coding-harness compatibility. Verified sources, change history, live status.",
  keywords: ["free AI models", "free LLM", "free AI API", "open source models", "AI coding harness", "Claude Code", "OpenCode"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Nav />
        <DataBanner />
        <main className="flex-1 w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-6">{children}</main>
        <footer className="border-t border-[var(--border)] mt-10 py-6 text-center text-xs text-[var(--fg-mute)]">
          FreeModelWatch · Community-curated free AI availability · Verify sources before relying on data.
        </footer>
      </body>
    </html>
  );
}
