import { NextResponse } from "next/server";
import { getHarness, getHarnessCompat, getModel, getProvider, classifyFreshness } from "@/lib/queries";
import { getAvailability } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return params.then(({ id }) => {
      const h = getHarness(id);
      if (!h) return NextResponse.json({ error: "Harness not found" }, { status: 404 });
      const hc = getHarnessCompat({ harnessId: id }).filter((c) => c.freeStatus === "free");
      const avail = getAvailability({ activeOnly: true });
      const availMap = new Map(avail.map((a) => [`${a.modelId}__${a.providerId}`, a]));
      const models = hc
        .map((c) => {
          const m = getModel(c.modelId);
          const p = c.providerId ? getProvider(c.providerId) : null;
          const a = c.providerId ? availMap.get(`${c.modelId}__${c.providerId}`) : null;
          if (!m) return null;
          return {
            id: m.id,
            name: m.name,
            providerId: c.providerId,
            providerName: p?.name ?? null,
            authMethod: c.authMethod,
            requiresApiKey: c.requiresApiKey,
            worksWithCustomEndpoint: c.worksWithCustomEndpoint,
            worksWithOpenrouter: c.worksWithOpenrouter,
            setupDifficulty: c.setupDifficulty,
            knownLimitations: c.knownLimitations,
            freeStatus: c.freeStatus,
            freshness: a ? classifyFreshness(a) : "unverified",
            verificationConfidence: c.verificationConfidence,
            lastVerifiedAt: c.lastVerifiedAt,
          };
        })
        .filter(Boolean);
      return NextResponse.json({ harness: h.name, count: models.length, freeModels: models });
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load harness models", detail: String(err) }, { status: 500 });
  }
}
