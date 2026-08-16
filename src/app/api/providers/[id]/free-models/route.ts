import { NextResponse } from "next/server";
import { getAvailability, getProvider, getModel, classifyFreshness } from "@/lib/queries";
import { serializeProvider } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return params.then(({ id }) => {
      const p = getProvider(id);
      if (!p) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
      const avail = getAvailability({ providerId: id, activeOnly: true }).filter((a) =>
        ["available", "limited", "degraded", "temporarily_free"].includes(a.status)
      );
      const models = avail
        .map((a) => getModel(a.modelId))
        .filter(Boolean)
        .map((m) => {
          const av = avail.find((x) => x.modelId === m!.id)!;
          return {
            id: m!.id,
            name: m!.name,
            accessType: av.accessType,
            status: av.status,
            freshness: classifyFreshness(av),
            freeQuotaValue: av.freeQuotaValue,
            freeQuotaUnit: av.freeQuotaUnit,
            freeQuotaPeriod: av.freeQuotaPeriod,
            dailyLimit: av.dailyLimit,
            rateLimitRpm: av.rateLimitRpm,
            requiresPaymentMethod: av.requiresPaymentMethod,
            dataOrigin: av.dataOrigin,
            lastVerifiedAt: av.lastVerifiedAt,
            verificationConfidence: av.verificationConfidence,
            sourceUrl: av.sourceUrl,
          };
        });
      return NextResponse.json({ provider: serializeProvider(p), count: models.length, freeModels: models });
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load provider models", detail: String(err) }, { status: 500 });
  }
}
