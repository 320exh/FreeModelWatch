import type { AccessType, AvailabilityStatus, VerificationConfidence } from "../types";

/**
 * Future data-collector architecture.
 *
 * The product is designed to support many collectors (one per provider / source
 * of truth) without rewriting the rest of the application:
 *
 *   ProviderSource → discover models → discover pricing → normalize → validate → store → verify → publish
 *
 * A Collector only knows how to TALK to one upstream (its API / docs / HTML).
 * Normalization, validation, storage and publishing are shared. Adding a new
 * provider means implementing one `Collector` and registering it — no changes to
 * queries, pages, or the API.
 */

export interface RawModelListing {
  externalId: string;
  displayName: string;
  family?: string;
  version?: string;
}

export interface RawPricing {
  externalId: string;
  freeAccess: boolean;
  accessType?: AccessType;
  status?: AvailabilityStatus;
  freeQuotaValue?: number | null;
  freeQuotaUnit?: string | null;
  freeQuotaPeriod?: string | null;
  requiresPaymentMethod?: boolean;
  requiresApiKey?: boolean;
  requiresSignup?: boolean;
  pricePerMillionIn?: number | null;
  pricePerMillionOut?: number | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceType?: string | null;
  expiresAt?: string | null;
}

export interface NormalizedModel {
  id: string;
  name: string;
  providerId: string;
  family?: string;
  version?: string;
}

export interface NormalizedAvailability extends RawPricing {
  id: string;
  modelId: string;
  providerId: string;
  accessType: AccessType;
  status: AvailabilityStatus;
  confidence: VerificationConfidence;
}

export interface CollectorResult {
  models: NormalizedModel[];
  availabilities: NormalizedAvailability[];
  collectedAt: string;
}

export interface Collector {
  readonly id: string;
  readonly displayName: string;
  /** List models the upstream exposes (may be empty if discovery is skipped). */
  discover(): Promise<RawModelListing[]>;
  /** Fetch raw pricing/availability for one external model id. */
  fetchPricing(externalId: string): Promise<RawPricing | null>;
  /** Turn a raw external id + pricing into our stable internal ids. */
  normalize(externalId: string, raw: RawPricing): NormalizedAvailability;
  /** Validate a normalized record; return issues (contradictions) if any. */
  validate(a: NormalizedAvailability): string[];
}

export interface CollectorSink {
  upsertModel(m: NormalizedModel): Promise<void>;
  upsertAvailability(a: NormalizedAvailability, issues: string[]): Promise<void>;
  finish(result: CollectorResult): Promise<void>;
}
