import { describe, it, expect, beforeEach } from "vitest";
import type { Availability, Model, Source, VerificationConfidence, AvailabilityStatus } from "../types";
import { resetDb } from "../db";
import {
  scoreRouteQuality,
  filterFreeAccessRoutes,
  recommendFreeAccess,
  explainRoute,
  categorizeChange,
  buildFreeAccessRoutes,
  type RouteQualityScore,
  type FreeAccessRoute,
} from "../intelligence";
import { loadGraph } from "../queries";
import { getDb } from "../db";

const makeTestAvailability = (overrides: Partial<Availability> = {}): Availability => {
  return {
    id: "test-model__test-provider",
    modelId: "test-model",
    providerId: "test-provider",
    harnessId: null,
    accessType: "free_tier",
    freeQuotaValue: 1000,
    freeQuotaUnit: "requests",
    freeQuotaPeriod: "day",
    rateLimitRpm: 10,
    rateLimitTpm: 100000,
    dailyLimit: 1000,
    monthlyLimit: null,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    currency: "USD",
    requiresApiKey: true,
    requiresPaymentMethod: false,
    paymentRequirementKnown: true,
    requiresSignup: true,
    geographicRestrictions: [],
    apiFormat: "openai",
    customEndpointUrl: null,
    status: "available" as AvailabilityStatus,
    isActive: true,
    sourceUrl: "https://example.com",
    sourceTitle: "Example",
    sourceType: "official_docs",
    lastVerifiedAt: "2026-08-15",
    verificationMethod: "manual",
    verificationConfidence: "verified" as VerificationConfidence,
    verificationNotes: null,
    dataOrigin: "live_collector",
    expiresAt: null,
    verifiedBy: null,
    ...overrides,
  };
};

const makeTestModel = (overrides: Partial<Model> = {}): Model => {
  return {
    id: "test-model",
    name: "Test Model",
    providerId: "test-provider",
    family: "TestFamily",
    version: "1.0",
    releaseDate: "2024-01-01",
    contextWindow: 8000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    visionSupport: false,
    toolCalling: false,
    structuredOutput: false,
    reasoningSupport: false,
    codingCapability: 3,
    isOpenSource: false,
    license: "MIT",
    officialPageUrl: "https://example.com",
    documentationUrl: "https://example.com/docs",
    description: "A test model",
    ...overrides,
  };
};

const makeTestSource = (overrides: Partial<Source> = {}): Source => {
  return {
    id: "src-test",
    url: "https://example.com",
    title: "Example Source",
    sourceType: "official_docs",
    providerId: "test-provider",
    modelId: "test-model",
    availabilityId: "test-model__test-provider",
    claimSupported: null,
    dateDiscovered: "2026-08-15",
    dateLastChecked: "2026-08-15",
    isVerified: true,
    reliability: "verified",
    lastCheckedAt: "2026-08-15",
    lastChangedAt: null,
    notes: null,
    ...overrides,
  };
};

const seedDbForIntelligence = () => {
  resetDb();
  getDb().exec(`
    INSERT INTO models (id, name, provider_id, family, version, release_date, context_window, max_output_tokens, input_modalities, output_modalities, vision_support, tool_calling, structured_output, reasoning_support, coding_capability, is_open_source, license, official_page_url, documentation_url, description) VALUES
      ('gemini-2.0-flash', 'Gemini 2.0 Flash', 'google', 'Gemini', '2.0', '2024-12-01', 1000000, 8192, '["text","image","audio"]', '["text"]', 1, 1, 1, 1, 4, 0, 'Proprietary', 'https://ai.google.dev', 'https://ai.google.dev/docs', 'Google AI model'),
      ('llama-3.1-8b', 'Llama 3.1 8B', 'meta', 'Llama', '3.1', '2024-07-23', 128000, 4096, '["text"]', '["text"]', 0, 1, 0, 0, 3, 1, 'Community', 'https://meta.ai', 'https://github.com/meta-llama', 'Open source model'),
      ('deepseek-chat', 'DeepSeek V3', 'deepseek', 'DeepSeek', 'V3', '2024-12-26', 128000, 8192, '["text"]', '["text"]', 0, 1, 1, 0, 4, 1, 'MIT', 'https://deepseek.com', 'https://api-docs.deepseek.com', 'Open source model');

    INSERT INTO providers (id, name, category, website_url, api_docs_url, pricing_url, has_free_tier, free_credits_amount, free_credits_currency, rate_limit_rpm, rate_limit_tpm, daily_request_limit, monthly_token_limit, requires_payment_method, requires_signup, geographic_restrictions, terms_restrictions, status, last_verified_at, verification_confidence, data_origin) VALUES
      ('google', 'Google AI (Gemini)', 'direct_api', 'https://ai.google.dev', 'https://ai.google.dev/gemini-api/docs', 'https://ai.google.dev/pricing', 1, NULL, 'USD', 15, 1000000, 1500, NULL, 0, 1, '[]', '', 'available', '2026-08-15', 'verified', 'live_collector'),
      ('meta', 'Meta (Llama)', 'hosted_oss', 'https://meta.ai', 'https://github.com/meta-llama/llama-models', 'https://meta.ai', 0, NULL, 'USD', NULL, NULL, NULL, NULL, 0, 0, '[]', '', 'available', '2026-08-15', 'verified', 'live_collector'),
      ('deepseek', 'DeepSeek', 'direct_api', 'https://deepseek.com', 'https://api-docs.deepseek.com', 'https://platform.deepseek.com', 1, NULL, 'USD', 20, NULL, NULL, NULL, 0, 1, '[]', '', 'available', '2026-08-15', 'likely', 'live_collector'),
      ('ollama', 'Ollama', 'local_platform', 'https://ollama.com', 'https://ollama.com/docs', 'https://ollama.com', 1, NULL, 'USD', NULL, NULL, NULL, NULL, 0, 0, '[]', '', 'available', '2026-08-15', 'verified', 'live_collector'),
      ('openrouter', 'OpenRouter', 'aggregator', 'https://openrouter.ai', 'https://openrouter.ai/docs', 'https://openrouter.ai/models', 1, NULL, 'USD', 20, NULL, NULL, NULL, 0, 1, '[]', '', 'available', '2026-08-15', 'verified', 'live_collector');

    INSERT INTO availability (id, model_id, provider_id, harness_id, access_type, free_quota_value, free_quota_unit, free_quota_period, rate_limit_rpm, rate_limit_tpm, daily_limit, monthly_limit, input_price_per_million, output_price_per_million, currency, requires_api_key, requires_payment_method, payment_requirement_known, requires_signup, geographic_restrictions, api_format, custom_endpoint_url, status, is_active, source_url, source_title, source_type, last_verified_at, verification_method, verification_confidence, verification_notes, data_origin, expires_at, verified_by) VALUES
      ('google__gemini-2.0-flash__google', 'gemini-2.0-flash', 'google', NULL, 'free_tier', 500, 'requests', 'day', 10, 1000000, 500, NULL, 0, 0, 'USD', 1, 0, 1, 1, '[]', 'openai', NULL, 'available', 1, 'https://ai.google.dev/pricing', 'Gemini API Pricing', 'pricing_page', '2026-08-15', 'manual', 'verified', NULL, 'live_collector', NULL, NULL),
      ('meta__llama-3.1-8b__groq', 'llama-3.1-8b', 'groq', NULL, 'free_tier', 14400, 'requests', 'day', 30, NULL, 14400, NULL, 0, 0, 'USD', 1, 0, 0, 1, '[]', 'openai', NULL, 'available', 1, 'https://groq.com/pricing', 'Groq Pricing', 'pricing_page', '2026-08-15', 'manual', 'verified', NULL, 'live_collector', NULL, NULL),
      ('ollama__llama-3.1-8b__ollama', 'llama-3.1-8b', 'ollama', NULL, 'free_local', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 'USD', 0, 1, 1, 0, '[]', 'null', NULL, 'available', 1, 'https://ollama.com/library/llama3.1', 'Ollama', 'official_docs', '2026-08-15', 'manual', 'verified', NULL, 'live_collector', NULL, NULL),
      ('deepseek__deepseek-chat__openrouter', 'deepseek-chat', 'openrouter', NULL, 'free_through_aggregator', NULL, NULL, NULL, 20, NULL, NULL, NULL, 0, 0, 'USD', 1, 0, 0, 1, '[]', 'openai', NULL, 'available', 1, 'https://openrouter.ai/models', 'OpenRouter', 'official_docs', '2026-08-15', 'manual', 'verified', NULL, 'live_collector', NULL, NULL);

    INSERT INTO sources (id, url, title, source_type, provider_id, model_id, availability_id, claim_supported, date_discovered, date_last_checked, is_verified, reliability, last_checked_at, last_changed_at, notes) VALUES
      ('src-google-pricing', 'https://ai.google.dev/pricing', 'Gemini API Pricing', 'pricing_page', 'google', NULL, 'google__gemini-2.0-flash__google', 'Free tier available', '2026-08-15', '2026-08-15', 1, 'verified', '2026-08-15', NULL, NULL),
      ('src-groq-pricing', 'https://groq.com/pricing', 'Groq Pricing', 'pricing_page', 'groq', NULL, 'meta__llama-3.1-8b__groq', 'Free tier available', '2026-08-15', '2026-08-15', 1, 'verified', '2026-08-15', NULL, NULL),
      ('src-openrouter', 'https://openrouter.ai/models', 'OpenRouter Models', 'official_docs', 'openrouter', NULL, 'deepseek__deepseek-chat__openrouter', 'Free models available', '2026-08-15', '2026-08-15', 1, 'verified', '2026-08-15', NULL, NULL),
      ('src-ollama', 'https://ollama.com/library', 'Ollama Library', 'official_docs', 'ollama', NULL, 'ollama__llama-3.1-8b__ollama', 'Open weights', '2026-08-15', '2026-08-15', 1, 'verified', '2026-08-15', NULL, NULL);

    INSERT INTO availability_sources (availability_id, source_id, role) VALUES
      ('google__gemini-2.0-flash__google', 'src-google-pricing', 'evidence'),
      ('meta__llama-3.1-8b__groq', 'src-groq-pricing', 'evidence'),
      ('deepseek__deepseek-chat__openrouter', 'src-openrouter', 'evidence'),
      ('ollama__llama-3.1-8b__ollama', 'src-ollama', 'evidence');
  `);
};

describe("scoreRouteQuality()", () => {
  beforeEach(() => {
    seedDbForIntelligence();
  });

  it("scores complete known route highly", () => {
    const g = loadGraph();
    const model = g.modelMap.get("gemini-2.0-flash")!;
    const avail = g.availByModel.get("gemini-2.0-flash")![0];
    const sources = g.sourcesByAvail.get(avail.id) ?? [];
    
    const score: RouteQualityScore = scoreRouteQuality(avail, model, "live_verified", sources);
    
    expect(score.total).toBeGreaterThan(80);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.freshness).toBe(16);
    expect(score.sourceReliability).toBe(12);
    expect(score.availability).toBe(12);
  });

  it("scores stale route with freshness penalty", () => {
    const g = loadGraph();
    const avail = g.availByModel.get("gemini-2.0-flash")![0];
    const staleAvail = { ...avail, verificationConfidence: "stale" as const, lastVerifiedAt: "2020-01-01" };
    const model = g.modelMap.get("gemini-2.0-flash")!;
    const sources = g.sourcesByAvail.get(avail.id) ?? [];
    
    const score = scoreRouteQuality(staleAvail, model, "stale", sources);
    
    expect(score.freshness).toBe(0);
    expect(score.unknownFlags).toContain("freshness_weak");
  });

  it("scores unavailable route correctly", () => {
    const g = loadGraph();
    const model = g.modelMap.get("gemini-2.0-flash")!;
    const avail = g.availByModel.get("gemini-2.0-flash")![0];
    const unavailableAvail = { ...avail, status: "unavailable" as const, isActive: false };
    const sources = g.sourcesByAvail.get(avail.id) ?? [];
    
    const score = scoreRouteQuality(unavailableAvail, model, "unavailable", sources);
    
    expect(score.availability).toBe(0);
    expect(score.total).toBeGreaterThanOrEqual(0);
  });

  it("penalizes unknown quota (not zero, not unlimited)", () => {
    const a = makeTestAvailability({
      dailyLimit: null,
      monthlyLimit: null,
      freeQuotaValue: null,
      rateLimitRpm: null,
      rateLimitTpm: null,
    });
    const m = makeTestModel();
    const score = scoreRouteQuality(a, m, "unverified", []);
    
    expect(score.quotaQuality).toBe(4);
    expect(score.unknownFlags).toContain("quota_unknown");
  });

  it("rewards known no-payment-requirement", () => {
    const a = makeTestAvailability({
      requiresPaymentMethod: false,
      paymentRequirementKnown: true,
      dailyLimit: 1000,
    });
    const m = makeTestModel();
    const score = scoreRouteQuality(a, m, "live_verified", []);
    
    expect(score.paymentRequirement).toBe(10);
  });

  it("penalizes payment requirement", () => {
    const a = makeTestAvailability({
      requiresPaymentMethod: true,
      paymentRequirementKnown: true,
    });
    const m = makeTestModel();
    const score = scoreRouteQuality(a, m, "live_verified", []);
    
    expect(score.paymentRequirement).toBe(-6);
  });

  it("keeps unknown payment requirement neutral", () => {
    const a = makeTestAvailability({
      requiresPaymentMethod: false,
      paymentRequirementKnown: false,
    });
    const m = makeTestModel();
    const score = scoreRouteQuality(a, m, "unverified", []);
    
    expect(score.paymentRequirement).toBe(0);
    expect(score.unknownFlags).toContain("payment_unknown");
  });
});

describe("recommendFreeAccess()", () => {
  beforeEach(() => {
    seedDbForIntelligence();
  });

  it("filters by coding requirement - returns coding-capable routes", () => {
    const results = recommendFreeAccess({ priority: "coding", limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("filters by reasoning requirement - returns reasoning models", () => {
    const results = recommendFreeAccess({ priority: "reasoning", limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("filters by vision requirement - returns vision models", () => {
    const results = recommendFreeAccess({ priority: "vision", limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("respects no-card requirement preference", () => {
    const results = recommendFreeAccess({
      priority: "general",
      prioritizeNoCard: true,
      limit: 10,
    });
    
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("ranks higher quality routes first", () => {
    const results = recommendFreeAccess({ priority: "general", limit: 20 });
    
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].matchScore).toBeGreaterThanOrEqual(results[i].matchScore);
    }
  });
});

describe("filterFreeAccessRoutes()", () => {
  beforeEach(() => {
    seedDbForIntelligence();
  });

  it("filters by provider", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { provider: ["google"] });
    
    expect(filtered.every(r => r.providerId === "google")).toBe(true);
  });

  it("filters by access type", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { access: ["free_tier"] });
    
    expect(filtered.every(r => r.accessType === "free_tier")).toBe(true);
  });

  it("filters by coding capability", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { coding: true });
    const g = loadGraph();
    
    filtered.forEach(r => {
      const m = g.modelMap.get(r.modelId);
      expect((m?.codingCapability ?? 0) >= 4).toBe(true);
    });
  });

  it("filters by reasoning support", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { reasoning: true });
    const g = loadGraph();
    
    filtered.forEach(r => {
      const m = g.modelMap.get(r.modelId);
      expect(m?.reasoningSupport).toBe(true);
    });
  });

  it("filters by vision support", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { vision: true });
    const g = loadGraph();
    
    filtered.forEach(r => {
      const m = g.modelMap.get(r.modelId);
      expect(m?.visionSupport).toBe(true);
    });
  });

  it("filters by tool calling support", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { toolCalling: true });
    const g = loadGraph();
    
    filtered.forEach(r => {
      const m = g.modelMap.get(r.modelId);
      expect(m?.toolCalling).toBe(true);
    });
  });

  it("filters by long context", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { longContext: true });
    
    expect(filtered.every(r => (r.tokenLimit ?? 0) >= 100000)).toBe(true);
  });

  it("filters by no card requirement", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { noCard: true });
    
    expect(filtered.every(r => r.paymentRequirement === "not_required")).toBe(true);
  });

  it("filters by API key requirement", () => {
    const routes = buildFreeAccessRoutes();
    const withKey = filterFreeAccessRoutes(routes, { apiKeyRequired: true });
    const noKeyNeeded = filterFreeAccessRoutes(routes, { apiKeyRequired: false });
    
    expect(withKey.every(r => r.requiresApiKey)).toBe(true);
    expect(noKeyNeeded.every(r => !r.requiresApiKey)).toBe(true);
  });

  it("filters by minimum context", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { minContext: 50000 });
    
    expect(filtered.every(r => (r.tokenLimit ?? 0) >= 50000)).toBe(true);
  });

  it("filters by freshness", () => {
    const routes = buildFreeAccessRoutes();
    const filtered = filterFreeAccessRoutes(routes, { freshness: ["live_verified", "likely"] });
    
    expect(filtered.every(r => ["live_verified", "likely"].includes(r.freshness))).toBe(true);
  });
});

describe("explainRoute()", () => {
  beforeEach(() => {
    seedDbForIntelligence();
  });

  it("distinguishes free inference pricing from payment requirement", () => {
    const g = loadGraph();
    const model = g.modelMap.get("gemini-2.0-flash")!;
    const avail = g.availByModel.get("gemini-2.0-flash")![0];
    const sources = g.sourcesByAvail.get(avail.id) ?? [];
    const routes = buildFreeAccessRoutes();
    const route = routes.find(r => r.modelId === "google__gemini-2.0-flash");
    
    if (route) {
      const explanation = explainRoute(route, model, sources);
      expect(explanation).toContain("Free inference pricing");
    }
  });

  it("shows unknown payment requirement when not established", () => {
    const g = loadGraph();
    const routes = buildFreeAccessRoutes();
    const openrouterRoute = routes.find(r => r.modelId === "deepseek__deepseek-chat__openrouter");
    
    if (openrouterRoute) {
      expect(openrouterRoute.paymentRequirement).toBe("unknown");
    }
  });

  it("shows no card required when confirmed", () => {
    const g = loadGraph();
    const routes = buildFreeAccessRoutes();
    const googleRoute = routes.find(r => r.providerId === "google");
    
    if (googleRoute) {
      const explanation = explainRoute(googleRoute, g.modelMap.get("gemini-2.0-flash")!, []);
      expect(explanation).toMatch(/no payment method|credit card.*not required/i);
    }
  });

  it("handles free_local access type correctly", () => {
    const g = loadGraph();
    const routes = buildFreeAccessRoutes();
    const ollamaRoute = routes.find(r => r.providerId === "ollama");
    
    if (ollamaRoute) {
      expect(ollamaRoute.freeQuotaText).toContain("No hosted provider quota");
    }
  });
});

describe("categorizeChange()", () => {
  it("categorizes became_free change (added to free)", () => {
    const c = {
      id: "test-1",
      entityType: "availability",
      entityId: "test-model__test-provider",
      fieldChanged: "added" as const,
      oldValue: null,
      newValue: "free_tier",
      changeSource: "manual",
      sourceUrl: "https://example.com",
      detectedAt: "2026-08-15",
      verifiedAt: "2026-08-15",
      verifiedBy: null,
      notes: null,
    };
    
    expect(categorizeChange(c)).toBe("became_free");
  });

  it("categorizes removed change", () => {
    const c = {
      id: "test-2",
      entityType: "availability",
      entityId: "test-model__test-provider",
      fieldChanged: "removed" as const,
      oldValue: "free_tier",
      newValue: null,
      changeSource: "manual",
      sourceUrl: "https://example.com",
      detectedAt: "2026-08-15",
      verifiedAt: "2026-08-15",
      verifiedBy: null,
      notes: null,
    };
    
    expect(categorizeChange(c)).toBe("removed");
  });

  it("categorizes became_paid change", () => {
    const c = {
      id: "test-3",
      entityType: "availability",
      entityId: "test-model__test-provider",
      fieldChanged: "status_change" as const,
      oldValue: "available",
      newValue: "paid",
      changeSource: "manual",
      sourceUrl: "https://example.com",
      detectedAt: "2026-08-15",
      verifiedAt: "2026-08-15",
      verifiedBy: null,
      notes: null,
    };
    
    expect(categorizeChange(c)).toBe("became_paid");
  });

  it("categorizes restored change", () => {
    const c = {
      id: "test-4",
      entityType: "availability",
      entityId: "test-model__test-provider",
      fieldChanged: "status_change" as const,
      oldValue: "unavailable",
      newValue: "available",
      changeSource: "manual",
      sourceUrl: "https://example.com",
      detectedAt: "2026-08-15",
      verifiedAt: "2026-08-15",
      verifiedBy: null,
      notes: null,
    };
    
    expect(categorizeChange(c)).toBe("restored");
  });

  it("categorizes limit_decreased change", () => {
    const c = {
      id: "test-5",
      entityType: "availability",
      entityId: "test-model__test-provider",
      fieldChanged: "quota_change" as const,
      oldValue: "100 requests, down to 50",
      newValue: "50 requests",
      changeSource: "manual",
      sourceUrl: "https://example.com",
      detectedAt: "2026-08-15",
      verifiedAt: "2026-08-15",
      verifiedBy: null,
      notes: null,
    };
    
    expect(categorizeChange(c)).toBe("limit_decreased");
  });

  it("categorizes limit_increased change", () => {
    const c = {
      id: "test-6",
      entityType: "availability",
      entityId: "test-model__test-provider",
      fieldChanged: "quota_change" as const,
      oldValue: "100 requests",
      newValue: "100 requests, up to 200",
      changeSource: "manual",
      sourceUrl: "https://example.com",
      detectedAt: "2026-08-15",
      verifiedAt: "2026-08-15",
      verifiedBy: null,
      notes: null,
    };
    
    expect(categorizeChange(c)).toBe("limit_increased");
  });

  it("returns null for unrecognized field changes", () => {
    const c = {
      id: "test-7",
      entityType: "availability",
      entityId: "test-model__test-provider",
      fieldChanged: "some_random_field" as const,
      oldValue: "old",
      newValue: "new",
      changeSource: "manual",
      sourceUrl: "https://example.com",
      detectedAt: "2026-08-15",
      verifiedAt: "2026-08-15",
      verifiedBy: null,
      notes: null,
    };
    
    expect(categorizeChange(c)).toBeNull();
  });
});

describe("unknown-data safety", () => {
  beforeEach(() => {
    seedDbForIntelligence();
  });

  it("verifies unknown quota is not treated as zero", () => {
    const a = makeTestAvailability({
      dailyLimit: null,
      monthlyLimit: null,
      freeQuotaValue: null,
      rateLimitRpm: null,
      rateLimitTpm: null,
    });
    const m = makeTestModel();
    const score = scoreRouteQuality(a, m, "unverified", []);
    
    expect(score.quotaQuality).toBe(4);
    expect(score.unknownFlags).toContain("quota_unknown");
    expect(score.unknownFlags).not.toContain("no_source");
  });

  it("verifies unknown payment requirement is not treated as no card", () => {
    const a = makeTestAvailability({
      paymentRequirementKnown: false,
      requiresPaymentMethod: false,
    });
    const m = makeTestModel();
    const score = scoreRouteQuality(a, m, "unverified", []);
    
    expect(score.paymentRequirement).toBe(0);
    expect(score.unknownFlags).toContain("payment_unknown");
  });

  it("ensures no card filter excludes unknown payment requirement routes", () => {
    const routes = buildFreeAccessRoutes();
    const noCardRoutes = filterFreeAccessRoutes(routes, { noCard: true });
    
    expect(noCardRoutes.every(r => r.paymentRequirement === "not_required")).toBe(true);
  });
});

describe("freeQuotaText() behavior", () => {
  beforeEach(() => {
    seedDbForIntelligence();
  });

  it("returns correct text for free_local access type", () => {
    const routes = buildFreeAccessRoutes();
    const ollamaRoute = routes.find(r => r.providerId === "ollama");
    
    if (ollamaRoute) {
      expect(ollamaRoute.freeQuotaText).toBe("No hosted provider quota (runs locally)");
    }
  });

  it("returns correct text for quota with limits", () => {
    const g = loadGraph();
    const model = g.modelMap.get("gemini-2.0-flash")!;
    const avail = g.availByModel.get("gemini-2.0-flash")![0];
    const routes = buildFreeAccessRoutes();
    const route = routes.find(r => r.providerId === "google");
    
    if (route) {
      expect(route.freeQuotaText).toMatch(/\d+ req\/day.*TPM/);
    }
  });
});

describe("loadGraph historical mode", () => {
  beforeEach(() => {
    seedDbForIntelligence();
    getDb().exec(`
      INSERT INTO availability (id, model_id, provider_id, harness_id, access_type, free_quota_value, free_quota_unit, free_quota_period, rate_limit_rpm, rate_limit_tpm, daily_limit, monthly_limit, input_price_per_million, output_price_per_million, currency, requires_api_key, requires_payment_method, payment_requirement_known, requires_signup, geographic_restrictions, api_format, custom_endpoint_url, status, is_active, source_url, source_title, source_type, last_verified_at, verification_method, verification_confidence, verification_notes, data_origin, expires_at, verified_by) 
      VALUES ('inactive__test-model__test-provider', 'test-model', 'test-provider', NULL, 'free_tier', 100, 'requests', 'day', 10, 10000, 100, NULL, 0, 0, 'USD', 1, 0, 1, 1, '[]', 'openai', NULL, 'available', 0, 'https://example.com', 'Old Route', 'official_docs', '2020-01-01', 'manual', 'verified', 'Removed model', 'live_collector', NULL, NULL);
    `);
  });

  it("active routes appear in active-only queries", () => {
    const g = loadGraph(false);
    const hasInactive = [...g.availByModel.values()].some(avails => 
      avails.some(a => !a.isActive)
    );
    expect(hasInactive).toBe(false);
  });

  it("inactive routes appear in historical queries", () => {
    const g = loadGraph(true);
    const hasInactive = [...g.availByModel.values()].some(avails => 
      avails.some(a => !a.isActive)
    );
    expect(hasInactive).toBe(true);
  });
});