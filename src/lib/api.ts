import type { ModelView, ScoredModel } from "./queries";
import type { Model, Availability, Provider, HarnessCompat, ChangeHistory, Source, VerificationConfidence, FreshnessTier, CollectionMode } from "./types";

export function serializeModelView(m: ModelView) {
  return {
    id: m.id,
    name: m.name,
    family: m.family,
    version: m.version,
    providerId: m.providerId,
    releaseDate: m.releaseDate,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    inputModalities: m.inputModalities,
    outputModalities: m.outputModalities,
    visionSupport: m.visionSupport,
    toolCalling: m.toolCalling,
    structuredOutput: m.structuredOutput,
    reasoningSupport: m.reasoningSupport,
    codingCapability: m.codingCapability,
    isOpenSource: m.isOpenSource,
    license: m.license,
    officialPageUrl: m.officialPageUrl,
    documentationUrl: m.documentationUrl,
    description: m.description,
    freeRouteCount: m.freeRouteCount,
    bestAccessType: m.bestAccessType,
    bestStatus: m.bestStatus,
    bestConfidence: m.bestConfidence,
    bestFreshness: m.bestFreshness,
    bestCollectionMode: m.bestCollectionMode,
    dataQuality: m.dataQuality,
    noPaymentMethod: m.noPaymentMethod,
    noCreditCard: m.noCreditCard,
    harnessCount: m.harnessCount,
    routes: m.routes.map((r) => ({
      availabilityId: r.availability.id,
      providerId: r.provider.id,
      providerName: r.provider.name,
      accessType: r.availability.accessType,
      status: r.availability.status,
      freshness: r.freshness,
      freeQuotaValue: r.availability.freeQuotaValue,
      freeQuotaUnit: r.availability.freeQuotaUnit,
      freeQuotaPeriod: r.availability.freeQuotaPeriod,
      dailyLimit: r.availability.dailyLimit,
      rateLimitRpm: r.availability.rateLimitRpm,
      requiresPaymentMethod: r.availability.requiresPaymentMethod,
      paymentRequirement: r.availability.paymentRequirementKnown
        ? (r.availability.requiresPaymentMethod ? "required" : "not_required")
        : "unknown",
      paymentRequirementKnown: r.availability.paymentRequirementKnown,
      requiresApiKey: r.availability.requiresApiKey,
      requiresSignup: r.availability.requiresSignup,
      apiFormat: r.availability.apiFormat,
      lastVerifiedAt: r.availability.lastVerifiedAt,
      verificationConfidence: r.availability.verificationConfidence,
      dataOrigin: r.availability.dataOrigin,
      collectionMode: r.availability.collectionMode,
      expiresAt: r.availability.expiresAt ?? null,
      sourceUrl: r.availability.sourceUrl,
      sources: r.sources.map(serializeSource),
    })),
  };
}

export function serializeSource(s: Source) {
  return {
    id: s.id,
    url: s.url,
    title: s.title,
    sourceType: s.sourceType,
    providerId: s.providerId,
    modelId: s.modelId,
    claimSupported: s.claimSupported,
    isVerified: s.isVerified,
    reliability: s.reliability,
    lastCheckedAt: s.lastCheckedAt,
    notes: s.notes,
  };
}

export function serializeProvider(p: Provider) {
  return { ...p };
}

export function serializeHarness(h: any) {
  return h;
}

export function serializeChange(c: ChangeHistory) {
  return c;
}

export function serializeHc(c: HarnessCompat) {
  return c;
}

export function serializeScoredModel(s: ScoredModel) {
  return {
    model: serializeModelView(s.view),
    score: s.score,
  };
}

export interface ApiFreshnessMeta {
  bestFreshness: FreshnessTier;
  dataQuality: ModelView["dataQuality"];
}

export type { VerificationConfidence };
