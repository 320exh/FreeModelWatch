import type { Collector, CollectorResult, RawModelListing, RawPricing } from "./types";

/**
 * Shared orchestration: run a collector's discovery + pricing loop, normalize and
 * validate each record, then hand off to a sink. The collector never touches the
 * database directly — it only exposes `discover` / `fetchPricing` / `normalize` /
 * `validate`. This keeps collectors trivially unit-testable.
 */
export class CollectorOrchestrator {
  constructor(private readonly collector: Collector, private readonly sink: import("./types").CollectorSink) {}

  async run(externalIds?: string[]): Promise<CollectorResult> {
    const listings: RawModelListing[] = externalIds
      ? externalIds.map((id) => ({ externalId: id, displayName: id }))
      : await this.collector.discover();

    const availabilities: CollectorResult["availabilities"] = [];
    const models = new Set<string>();

    for (const listing of listings) {
      const raw: RawPricing | null = await this.collector.fetchPricing(listing.externalId);
      if (!raw) continue;

      const normalized = this.collector.normalize(listing.externalId, raw);
      const issues = this.collector.validate(normalized);

      await this.sink.upsertModel({
        id: normalized.modelId,
        name: normalized.modelId.split("__")[0] ?? normalized.modelId,
        providerId: normalized.providerId,
        family: listing.family,
        version: listing.version,
      });
      await this.sink.upsertAvailability(normalized, issues);

      models.add(normalized.modelId);
      availabilities.push(normalized);
    }

    const result: CollectorResult = {
      models: [...models].map((id) => ({ id, name: id, providerId: this.collector.id })),
      availabilities,
      collectedAt: new Date().toISOString(),
    };
    await this.sink.finish(result);
    return result;
  }
}
