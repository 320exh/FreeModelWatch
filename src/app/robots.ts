import type { MetadataRoute } from "next";
import { getAllModels, getAllProviders, getAllHarnesses } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.SITE_URL ?? "https://freemodelwatch.example";
  const models = getAllModels();
  const providers = getAllProviders();
  const harnesses = getAllHarnesses();
  // Only index entity pages that carry verified/production data so demo seed
  // pages are not the canonical surface. Admin + API + compare stay private.
  const allow = ["/", "/models", "/providers", "/harnesses", "/best", "/changes", "/api-docs"];
  for (const m of models) allow.push(`/models/${m.id}`);
  for (const p of providers) allow.push(`/providers/${p.id}`);
  for (const h of harnesses) allow.push(`/harnesses/${h.id}`);
  return {
    rules: [
      {
        userAgent: "*",
        allow,
        disallow: ["/admin", "/api/", "/compare"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
