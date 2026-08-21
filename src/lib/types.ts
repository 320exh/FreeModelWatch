export type AccessType =
  | "completely_free"
  | "free_tier"
  | "free_credits"
  | "free_with_limits"
  | "free_through_aggregator"
  | "free_through_harness"
  | "free_local"
  | "temporarily_free"
  | "community_unofficial"
  | "direct_api";

export type AvailabilityStatus =
  | "available"
  | "limited"
  | "degraded"
  | "unavailable"
  | "unknown"
  | "temporarily_free";

export type ProviderCategory =
  | "direct_api"
  | "aggregator"
  | "inference"
  | "coding_harness"
  | "cloud"
  | "local_platform"
  | "hosted_oss";

export type VerificationConfidence = "verified" | "likely" | "unverified" | "stale";

// Tri-state for payment requirement (req 9 / 18). Critically: the ABSENCE of a
// payment requirement must NOT be read as "no card required" unless a source
// actually supports that claim. `unknown` means exactly that — we don't know.
export type PaymentRequirement = "required" | "not_required" | "unknown";

// Where a row came from. Seed/demo data is NOT the same as verified production data.
// `live_collector` marks rows written by an automated provider collector (e.g. OpenRouter).
// They are NOT human-verified unless a later admin verification sets them to `production`.
export type DataOrigin = "seed" | "production" | "user_report" | "live_collector";

// How the availability row was collected.
export type CollectionMode = "live" | "frozen" | "seed";

// Computed freshness tier shown in the UI. Never let seed data look "live verified".
export type FreshnessTier =
  | "live_verified" // production origin, confidence verified, recently checked
  | "likely" // production/seed claim, confidence likely, not confirmed
  | "unverified" // no positive verification
  | "seed_demo" // seeded demo row, not a live claim
  | "stale" // once verified but last check is older than the stale threshold
  | "expired" // a temporary/promotional offer whose expires_at is in the past
  | "unavailable"; // the route is currently down/unavailable

export type ChangeType =
  | "added"
  | "removed"
  | "status_change"
  | "quota_change"
  | "rate_limit_change"
  | "pricing_change"
  | "provider_change"
  | "harness_compatibility_change";

export interface Model {
  id: string;
  name: string;
  providerId: string;
  family: string | null;
  version: string | null;
  releaseDate: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  visionSupport: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  reasoningSupport: boolean;
  codingCapability: number | null;
  isOpenSource: boolean;
  license: string | null;
  officialPageUrl: string | null;
  documentationUrl: string | null;
  description: string | null;
}

export interface Provider {
  id: string;
  name: string;
  category: ProviderCategory;
  websiteUrl: string | null;
  apiDocsUrl: string | null;
  pricingUrl: string | null;
  hasFreeTier: boolean;
  freeCreditsAmount: number | null;
  freeCreditsCurrency: string;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  dailyRequestLimit: number | null;
  monthlyTokenLimit: number | null;
  requiresPaymentMethod: boolean;
  requiresSignup: boolean;
  geographicRestrictions: string[];
  termsRestrictions: string | null;
  status: AvailabilityStatus;
  lastVerifiedAt: string | null;
  verificationConfidence: VerificationConfidence;
  dataOrigin?: DataOrigin;
}

export interface Harness {
  id: string;
  name: string;
  websiteUrl: string | null;
  documentationUrl: string | null;
  supportsCustomOpenaiEndpoint: boolean;
  supportsAnthropicEndpoint: boolean;
  supportsOpenrouterRouting: boolean;
  authMethods: string[];
  description: string | null;
}

export interface Availability {
  id: string;
  modelId: string;
  providerId: string;
  harnessId: string | null;
  accessType: AccessType;
  freeQuotaValue: number | null;
  freeQuotaUnit: string | null;
  freeQuotaPeriod: string | null;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  currency: string;
  requiresApiKey: boolean;
  requiresPaymentMethod: boolean;
  // Whether the payment requirement is *evidenced*. When false, the boolean
  // above is treated as unknown — never as "no card required".
  paymentRequirementKnown: boolean;
  requiresSignup: boolean;
  geographicRestrictions: string[];
  apiFormat: string | null;
  customEndpointUrl: string | null;
  status: AvailabilityStatus;
  isActive: boolean;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceType: string | null;
  lastVerifiedAt: string | null;
  verificationMethod: string | null;
  verificationConfidence: VerificationConfidence;
  verificationNotes: string | null;
  dataOrigin?: DataOrigin;
  collectionMode?: CollectionMode;
  expiresAt?: string | null;
  verifiedBy?: string | null;
}

export interface Source {
  id: string;
  url: string;
  title: string | null;
  sourceType: string | null;
  providerId: string | null;
  modelId: string | null;
  availabilityId: string | null;
  claimSupported: string | null;
  dateDiscovered: string | null;
  dateLastChecked: string | null;
  isVerified: boolean;
  reliability?: VerificationConfidence;
  lastCheckedAt?: string | null;
  lastChangedAt?: string | null;
  notes?: string | null;
}

export interface ChangeHistory {
  id: string;
  entityType: string;
  entityId: string;
  fieldChanged: string | null;
  oldValue: string | null;
  newValue: string | null;
  changeSource: string | null;
  sourceUrl: string | null;
  detectedAt: string;
  verifiedAt: string | null;
  verifiedBy?: string | null;
  notes: string | null;
}

export interface VerificationHistory {
  id: string;
  availabilityId: string;
  modelId: string | null;
  providerId: string | null;
  verifiedBy: string | null;
  verifiedAt: string;
  previousConfidence: VerificationConfidence | null;
  previousStatus: AvailabilityStatus | null;
  newConfidence: VerificationConfidence | null;
  newStatus: AvailabilityStatus | null;
  sourceIds: string | null;
  notes: string | null;
}

export interface HarnessCompat {
  id: string;
  modelId: string;
  harnessId: string;
  providerId: string | null;
  authMethod: string | null;
  requiresApiKey: boolean;
  supportsDirectly: boolean;
  worksWithCustomEndpoint: boolean;
  worksWithOpenrouter: boolean;
  setupDifficulty: string | null;
  knownLimitations: string | null;
  freeStatus: string | null;
  lastVerifiedAt: string | null;
  verificationConfidence: VerificationConfidence;
  sourceUrl: string | null;
  dataOrigin?: DataOrigin;
}
