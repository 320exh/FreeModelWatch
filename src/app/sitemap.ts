import type { MetadataRoute } from "next";
import { getAllModels, getAllProviders, getAllHarnesses } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.SITE_URL ?? "https://freeai.today";
  const out: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/models`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/providers`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/harnesses`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/best`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/changes`, changeFrequency: "daily", priority: 0.6 },
  ];
  for (const m of getAllModels()) out.push({ url: `${base}/models/${m.id}`, changeFrequency: "daily", priority: 0.7 });
  for (const p of getAllProviders()) out.push({ url: `${base}/providers/${p.id}`, changeFrequency: "weekly", priority: 0.6 });
  for (const h of getAllHarnesses()) out.push({ url: `${base}/harnesses/${h.id}`, changeFrequency: "weekly", priority: 0.5 });
  return out;
}
