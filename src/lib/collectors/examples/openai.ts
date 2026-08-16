import type { Collector, NormalizedAvailability, RawModelListing, RawPricing } from "../types";

/**
 * Example skeleton for a provider collector. The network calls are stubbed because
 * this project does not ship live scrapers — the point is to demonstrate the shape
 * the architecture expects. Implement `discover` / `fetchPricing` with the real
 * upstream (API / docs / OpenAPI spec), then register the collector in
 * `src/lib/collectors/registry.ts`.
 */
const PROVIDER_ID = "openai";

export class OpenAICollector implements Collector {
  readonly id = PROVIDER_ID;
  readonly displayName = "OpenAI";

  async discover(): Promise<RawModelListing[]> {
    // TODO: fetch https://api.openai.com/v1/models with an API key, or scrape the pricing page.
    return [
      { externalId: "gpt-4o-mini", displayName: "GPT-4o mini", family: "gpt-4o" },
      { externalId: "gpt-4.1", displayName: "GPT-4.1" },
    ];
  }

  async fetchPricing(externalId: string): Promise<RawPricing | null> {
    // TODO: read the live pricing page / structured endpoint.
    const free: Record<string, boolean> = { "gpt-4o-mini": true };
    const freeQuota: Record<string, { value: number; unit: string; period: string } | undefined> = {
      "gpt-4o-mini": { value: 1000000, unit: "tokens", period: "day" },
    };
    return {
      externalId,
      freeAccess: !!free[externalId],
      accessType: free[externalId] ? "free_tier" : "free_with_limits",
      status: free[externalId] ? "available" : "limited",
      freeQuotaValue: freeQuota[externalId]?.value ?? null,
      freeQuotaUnit: freeQuota[externalId]?.unit ?? null,
      freeQuotaPeriod: freeQuota[externalId]?.period ?? null,
      requiresApiKey: true,
      requiresSignup: true,
      sourceUrl: "https://openai.com/api/pricing/",
      sourceTitle: "OpenAI pricing",
      sourceType: "pricing_page",
    };
  }

  normalize(externalId: string, raw: RawPricing): NormalizedAvailability {
    const modelId = `${externalId}__${PROVIDER_ID}`;
    const { externalId: _omit, ...rest } = raw;
    return {
      id: `${PROVIDER_ID}__${externalId}`,
      modelId,
      providerId: PROVIDER_ID,
      accessType: raw.accessType ?? (raw.freeAccess ? "free_tier" : "free_with_limits"),
      status: raw.status ?? (raw.freeAccess ? "available" : "limited"),
      confidence: "likely",
      externalId,
      ...rest,
    };
  }

  validate(a: NormalizedAvailability): string[] {
    const issues: string[] = [];
    if (a.freeAccess && !a.accessType) issues.push("freeAccess set without accessType");
    if (a.freeQuotaValue != null && !a.freeQuotaUnit) issues.push("freeQuotaValue without unit");
    if (a.status === "available" && a.requiresPaymentMethod) issues.push("available but requires payment method");
    return issues;
  }
}
