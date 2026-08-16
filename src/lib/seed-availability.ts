import type { Availability, Source, HarnessCompat, ChangeHistory } from "./types";

// Compact builder so the dataset stays readable.
type AvInput = {
  modelId: string;
  providerId: string;
  accessType: Availability["accessType"];
  status?: Availability["status"];
  freeQuotaValue?: number | null;
  freeQuotaUnit?: string | null;
  freeQuotaPeriod?: string | null;
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  dailyLimit?: number | null;
  monthlyLimit?: number | null;
  inputPrice?: number | null;
  outputPrice?: number | null;
  requiresApiKey?: boolean;
  requiresPaymentMethod?: boolean;
  paymentRequirementKnown?: boolean;
  requiresSignup?: boolean;
  apiFormat?: string | null;
  customEndpointUrl?: string | null;
  confidence?: Availability["verificationConfidence"];
  lastVerified?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceType?: string | null;
  method?: string | null;
  notes?: string | null;
  dataOrigin?: Availability["dataOrigin"];
  expiresAt?: string | null;
};

function av(i: AvInput): Availability {
  return {
    id: `${i.modelId}__${i.providerId}`,
    modelId: i.modelId,
    providerId: i.providerId,
    harnessId: null,
    accessType: i.accessType,
    freeQuotaValue: i.freeQuotaValue ?? null,
    freeQuotaUnit: i.freeQuotaUnit ?? null,
    freeQuotaPeriod: i.freeQuotaPeriod ?? null,
    rateLimitRpm: i.rateLimitRpm ?? null,
    rateLimitTpm: i.rateLimitTpm ?? null,
    dailyLimit: i.dailyLimit ?? null,
    monthlyLimit: i.monthlyLimit ?? null,
    inputPricePerMillion: i.inputPrice ?? null,
    outputPricePerMillion: i.outputPrice ?? null,
    currency: "USD",
    requiresApiKey: i.requiresApiKey ?? true,
    requiresPaymentMethod: i.requiresPaymentMethod ?? false,
    // Evidence-based (req 9): the payment requirement is only "known" when the
    // access type makes it self-evident (local/self-hosted needs no account) or
    // it is explicitly supplied. Otherwise we treat it as UNKNOWN so the UI
    // shows "Payment requirement unknown" rather than assuming "no card".
    paymentRequirementKnown:
      i.paymentRequirementKnown ??
      (i.accessType === "free_local" && (i.requiresApiKey ?? false) === false && (i.requiresSignup ?? false) === false ? true : false),
    requiresSignup: i.requiresSignup ?? true,
    geographicRestrictions: [],
    apiFormat: i.apiFormat ?? null,
    customEndpointUrl: i.customEndpointUrl ?? null,
    status: i.status ?? "available",
    isActive: true,
    sourceUrl: i.sourceUrl ?? null,
    sourceTitle: i.sourceTitle ?? null,
    sourceType: i.sourceType ?? null,
    lastVerifiedAt: i.lastVerified ?? "2026-08-15",
    verificationMethod: i.method ?? "manual",
    verificationConfidence: i.confidence ?? "likely",
    verificationNotes: i.notes ?? null,
    dataOrigin: i.dataOrigin ?? "seed",
    expiresAt: i.expiresAt ?? null,
  };
}

export const AVAILABILITY: Availability[] = [
  // ----- Google Gemini free tier -----
  av({ modelId: "gemini-2.0-flash", providerId: "google", accessType: "free_tier", status: "available", dailyLimit: 1500, rateLimitRpm: 15, rateLimitTpm: 1000000, freeQuotaValue: 1500, freeQuotaUnit: "requests", freeQuotaPeriod: "day", requiresApiKey: true, requiresPaymentMethod: false, paymentRequirementKnown: true, confidence: "verified", sourceUrl: "https://ai.google.dev/pricing", sourceTitle: "Gemini API Pricing", sourceType: "pricing_page" }),
  av({ modelId: "gemini-2.0-flash-lite", providerId: "google", accessType: "free_tier", status: "available", dailyLimit: 1500, rateLimitRpm: 15, freeQuotaValue: 1500, freeQuotaUnit: "requests", freeQuotaPeriod: "day", requiresPaymentMethod: false, paymentRequirementKnown: true, confidence: "verified", sourceUrl: "https://ai.google.dev/pricing", sourceTitle: "Gemini API Pricing", sourceType: "pricing_page" }),
  av({ modelId: "gemini-2.5-flash", providerId: "google", accessType: "free_tier", status: "available", dailyLimit: 500, rateLimitRpm: 10, freeQuotaValue: 500, freeQuotaUnit: "requests", freeQuotaPeriod: "day", requiresPaymentMethod: false, paymentRequirementKnown: true, confidence: "likely", sourceUrl: "https://ai.google.dev/pricing", sourceTitle: "Gemini API Pricing", sourceType: "pricing_page" }),

  // ----- OpenAI free tier -----
  av({ modelId: "gpt-4o-mini", providerId: "openai", accessType: "free_with_limits", status: "limited", rateLimitRpm: 3, freeQuotaValue: 3, freeQuotaUnit: "requests", freeQuotaPeriod: "minute", requiresPaymentMethod: false, confidence: "likely", sourceUrl: "https://openai.com/api/pricing/", sourceTitle: "OpenAI API Pricing", sourceType: "pricing_page", notes: "Free tier heavily throttled; treat as best-effort." }),
  av({ modelId: "gpt-4.1-mini", providerId: "openai", accessType: "free_with_limits", status: "limited", rateLimitRpm: 3, freeQuotaValue: 3, freeQuotaUnit: "requests", freeQuotaPeriod: "minute", requiresPaymentMethod: false, confidence: "likely", sourceUrl: "https://openai.com/api/pricing/", sourceTitle: "OpenAI API Pricing", sourceType: "pricing_page" }),

  // ----- Meta Llama via inference providers (open weights) -----
  av({ modelId: "llama-3.3-70b", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, freeQuotaValue: 14400, freeQuotaUnit: "requests", freeQuotaPeriod: "day", apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "llama-3.3-70b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "llama-3.3-70b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/llama3.3", sourceTitle: "Ollama model library", sourceType: "official_docs" }),
  av({ modelId: "llama-3.3-70b", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", rateLimitRpm: 20, apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models/meta-llama/llama-3.3-70b-instruct", sourceTitle: "OpenRouter model page", sourceType: "official_docs" }),
  av({ modelId: "llama-3.3-70b", providerId: "cloudflare", accessType: "free_tier", status: "available", dailyLimit: 10000, freeQuotaValue: 10000, freeQuotaUnit: "requests", freeQuotaPeriod: "day", apiFormat: "openai", confidence: "likely", sourceUrl: "https://developers.cloudflare.com/workers-ai", sourceTitle: "Cloudflare Workers AI", sourceType: "official_docs" }),

  av({ modelId: "llama-3.1-8b", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "llama-3.1-8b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/llama3.1", sourceTitle: "Ollama model library", sourceType: "official_docs" }),
  av({ modelId: "llama-3.1-8b", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models", sourceTitle: "OpenRouter models", sourceType: "official_docs" }),
  av({ modelId: "llama-3.1-8b", providerId: "cloudflare", accessType: "free_tier", status: "available", dailyLimit: 10000, freeQuotaValue: 10000, freeQuotaUnit: "requests", freeQuotaPeriod: "day", apiFormat: "openai", confidence: "likely", sourceUrl: "https://developers.cloudflare.com/workers-ai", sourceTitle: "Cloudflare Workers AI", sourceType: "official_docs" }),

  av({ modelId: "llama-3.1-70b", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "llama-3.1-70b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "llama-3.1-70b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/llama3.1", sourceTitle: "Ollama model library", sourceType: "official_docs" }),
  av({ modelId: "llama-3.1-70b", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models", sourceTitle: "OpenRouter models", sourceType: "official_docs" }),

  av({ modelId: "llama-3.2-11b-vision", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "llama-3.2-11b-vision", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/llama3.2-vision", sourceTitle: "Ollama model library", sourceType: "official_docs" }),

  av({ modelId: "llama-3.2-90b-vision", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "llama-3.2-90b-vision", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models", sourceTitle: "OpenRouter models", sourceType: "official_docs" }),

  // ----- Mistral -----
  av({ modelId: "mistral-7b", providerId: "mistral", accessType: "free_with_limits", status: "limited", rateLimitRpm: 1, freeQuotaValue: 1, freeQuotaUnit: "request", freeQuotaPeriod: "second", apiFormat: "openai", confidence: "likely", sourceUrl: "https://mistral.ai/pricing", sourceTitle: "Mistral Pricing", sourceType: "pricing_page" }),
  av({ modelId: "mistral-7b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "mistral-7b", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "mistral-7b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/mistral", sourceTitle: "Ollama model library", sourceType: "official_docs" }),

  av({ modelId: "mistral-small-3", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "mistral-small-3", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "mistral-small-3", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/mistral-small-3", sourceTitle: "Ollama model library", sourceType: "official_docs" }),

  av({ modelId: "mixtral-8x7b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "mixtral-8x7b", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "mixtral-8x7b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/mixtral", sourceTitle: "Ollama model library", sourceType: "official_docs" }),
  av({ modelId: "mixtral-8x7b", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models", sourceTitle: "OpenRouter models", sourceType: "official_docs" }),

  av({ modelId: "codestral", providerId: "mistral", accessType: "free_with_limits", status: "limited", rateLimitRpm: 1, apiFormat: "openai", confidence: "likely", sourceUrl: "https://mistral.ai/pricing", sourceTitle: "Mistral Pricing", sourceType: "pricing_page" }),
  av({ modelId: "codestral", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),

  // ----- DeepSeek -----
  av({ modelId: "deepseek-chat", providerId: "deepseek", accessType: "free_tier", status: "available", rateLimitRpm: 20, freeQuotaValue: 20, freeQuotaUnit: "requests", freeQuotaPeriod: "minute", apiFormat: "openai", confidence: "likely", sourceUrl: "https://platform.deepseek.com", sourceTitle: "DeepSeek Platform", sourceType: "pricing_page" }),
  av({ modelId: "deepseek-chat", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "deepseek-chat", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models/deepseek/deepseek-chat", sourceTitle: "OpenRouter model page", sourceType: "official_docs" }),

  av({ modelId: "deepseek-reasoner", providerId: "deepseek", accessType: "free_tier", status: "available", rateLimitRpm: 20, apiFormat: "openai", confidence: "likely", sourceUrl: "https://platform.deepseek.com", sourceTitle: "DeepSeek Platform", sourceType: "pricing_page" }),
  av({ modelId: "deepseek-reasoner", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models/deepseek/deepseek-r1", sourceTitle: "OpenRouter model page", sourceType: "official_docs" }),

  // ----- Qwen -----
  av({ modelId: "qwen2.5-72b", providerId: "qwen", accessType: "free_tier", status: "limited", apiFormat: "openai", confidence: "likely", sourceUrl: "https://help.aliyun.com/zh/model-studio/models", sourceTitle: "Model Studio models", sourceType: "official_docs", notes: "Free quota primarily for CN accounts." }),
  av({ modelId: "qwen2.5-72b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "qwen2.5-72b", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models/qwen/qwen2.5-72b-instruct", sourceTitle: "OpenRouter model page", sourceType: "official_docs" }),

  av({ modelId: "qwen2.5-coder-32b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "qwen2.5-coder-32b", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models/qwen/qwen2.5-coder-32b-instruct", sourceTitle: "OpenRouter model page", sourceType: "official_docs" }),
  av({ modelId: "qwen2.5-coder-32b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/qwen2.5-coder", sourceTitle: "Ollama model library", sourceType: "official_docs" }),

  av({ modelId: "qwen2.5-vl-72b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "qwen2.5-vl-72b", providerId: "openrouter", accessType: "free_through_aggregator", status: "available", apiFormat: "openai", confidence: "verified", sourceUrl: "https://openrouter.ai/models/qwen/qwen2.5-vl-72b-instruct", sourceTitle: "OpenRouter model page", sourceType: "official_docs" }),

  // ----- Microsoft Phi -----
  av({ modelId: "phi-4", providerId: "huggingface", accessType: "free_with_limits", status: "available", rateLimitRpm: 30, apiFormat: "openai", requiresPaymentMethod: false, confidence: "verified", sourceUrl: "https://huggingface.co/microsoft/phi-4", sourceTitle: "Phi-4 model card", sourceType: "official_docs" }),
  av({ modelId: "phi-4", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/phi4", sourceTitle: "Ollama model library", sourceType: "official_docs" }),
  av({ modelId: "phi-4", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),

  // ----- Google Gemma (open weights) -----
  av({ modelId: "gemma-2-9b", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "gemma-2-9b", providerId: "huggingface", accessType: "free_with_limits", status: "available", rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://huggingface.co/google/gemma-2-9b", sourceTitle: "Gemma model card", sourceType: "official_docs" }),
  av({ modelId: "gemma-2-9b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/gemma2", sourceTitle: "Ollama model library", sourceType: "official_docs" }),
  av({ modelId: "gemma-2-9b", providerId: "cloudflare", accessType: "free_tier", status: "available", dailyLimit: 10000, freeQuotaValue: 10000, freeQuotaUnit: "requests", freeQuotaPeriod: "day", apiFormat: "openai", confidence: "likely", sourceUrl: "https://developers.cloudflare.com/workers-ai", sourceTitle: "Cloudflare Workers AI", sourceType: "official_docs" }),

  av({ modelId: "gemma-2-27b", providerId: "groq", accessType: "free_tier", status: "available", dailyLimit: 14400, rateLimitRpm: 30, apiFormat: "openai", confidence: "verified", sourceUrl: "https://groq.com/pricing", sourceTitle: "Groq Pricing", sourceType: "pricing_page" }),
  av({ modelId: "gemma-2-27b", providerId: "together", accessType: "free_credits", status: "available", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "verified", sourceUrl: "https://www.together.ai/pricing", sourceTitle: "Together AI Pricing", sourceType: "pricing_page" }),
  av({ modelId: "gemma-2-27b", providerId: "ollama", accessType: "free_local", status: "available", requiresApiKey: false, requiresSignup: false, confidence: "verified", sourceUrl: "https://ollama.com/library/gemma2", sourceTitle: "Ollama model library", sourceType: "official_docs" }),

  // ----- Cohere -----
  av({ modelId: "command-r", providerId: "cohere", accessType: "free_credits", status: "limited", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "unverified", sourceUrl: "https://cohere.com/pricing", sourceTitle: "Cohere Pricing", sourceType: "pricing_page" }),
  av({ modelId: "command-r-plus", providerId: "cohere", accessType: "free_credits", status: "limited", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "unverified", sourceUrl: "https://cohere.com/pricing", sourceTitle: "Cohere Pricing", sourceType: "pricing_page" }),

  // ----- Perplexity -----
  av({ modelId: "sonar", providerId: "perplexity", accessType: "free_credits", status: "limited", freeQuotaValue: 5, freeQuotaUnit: "dollars", freeQuotaPeriod: "once", apiFormat: "openai", confidence: "likely", sourceUrl: "https://www.perplexity.ai/pricing", sourceTitle: "Perplexity Pricing", sourceType: "pricing_page" }),
];

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
export const SOURCES: Source[] = [
  { id: "src-google-pricing", url: "https://ai.google.dev/pricing", title: "Gemini API Pricing", sourceType: "pricing_page", providerId: "google", modelId: null, availabilityId: null, claimSupported: "Free tier: 15 RPM / 1,500 RPD / 1M TPM for Gemini 2.0 Flash.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
  { id: "src-openai-pricing", url: "https://openai.com/api/pricing/", title: "OpenAI API Pricing", sourceType: "pricing_page", providerId: "openai", modelId: null, availabilityId: null, claimSupported: "Limited free tier for chat models (best-effort, throttled).", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: false },
  { id: "src-groq-pricing", url: "https://groq.com/pricing", title: "Groq Pricing", sourceType: "pricing_page", providerId: "groq", modelId: null, availabilityId: null, claimSupported: "Free tier for open models, 30 RPM, ~14,400 req/day.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
  { id: "src-together-pricing", url: "https://www.together.ai/pricing", title: "Together AI Pricing", sourceType: "pricing_page", providerId: "together", modelId: null, availabilityId: null, claimSupported: "$5 sign-up credits; free endpoint for some open models.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
  { id: "src-openrouter", url: "https://openrouter.ai/models", title: "OpenRouter Models", sourceType: "official_docs", providerId: "openrouter", modelId: null, availabilityId: null, claimSupported: "Many free models hosted with rate limits.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
  { id: "src-ollama", url: "https://ollama.com/library", title: "Ollama Model Library", sourceType: "official_docs", providerId: "ollama", modelId: null, availabilityId: null, claimSupported: "Open-weight models run fully locally, free.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
  { id: "src-deepseek", url: "https://platform.deepseek.com", title: "DeepSeek Platform", sourceType: "pricing_page", providerId: "deepseek", modelId: null, availabilityId: null, claimSupported: "Free API tier with per-model rate limits.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: false },
  { id: "src-mistral-pricing", url: "https://mistral.ai/pricing", title: "Mistral Pricing", sourceType: "pricing_page", providerId: "mistral", modelId: null, availabilityId: null, claimSupported: "La Plateforme free tier (1 req/s, daily cap).", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: false },
  { id: "src-qwen", url: "https://help.aliyun.com/zh/model-studio/", title: "Alibaba Model Studio", sourceType: "official_docs", providerId: "qwen", modelId: null, availabilityId: null, claimSupported: "Free quota for Qwen models, primarily CN region.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: false },
  { id: "src-cloudflare", url: "https://developers.cloudflare.com/workers-ai", title: "Cloudflare Workers AI", sourceType: "official_docs", providerId: "cloudflare", modelId: null, availabilityId: null, claimSupported: "10,000 requests/day free on Workers Free plan.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
  { id: "src-perplexity", url: "https://www.perplexity.ai/pricing", title: "Perplexity Pricing", sourceType: "pricing_page", providerId: "perplexity", modelId: null, availabilityId: null, claimSupported: "Free/trial tier for Sonar.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: false },
  { id: "src-cohere", url: "https://cohere.com/pricing", title: "Cohere Pricing", sourceType: "pricing_page", providerId: "cohere", modelId: null, availabilityId: null, claimSupported: "Free trial credits.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: false },
  { id: "src-hf-phi4", url: "https://huggingface.co/microsoft/phi-4", title: "Phi-4 Model Card", sourceType: "official_docs", providerId: "huggingface", modelId: "phi-4", availabilityId: null, claimSupported: "Open weights (MIT), free inference via HF.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
  { id: "src-anthropic-pricing", url: "https://www.anthropic.com/pricing", title: "Anthropic Pricing", sourceType: "pricing_page", providerId: "anthropic", modelId: null, availabilityId: null, claimSupported: "No free API tier; claude.ai has a free consumer plan.", dateDiscovered: "2026-08-15", dateLastChecked: "2026-08-15", isVerified: true },
];

// ---------------------------------------------------------------------------
// Harness compatibility (which free models work in which coding harnesses)
// ---------------------------------------------------------------------------
function hc(
  modelId: string,
  harnessId: string,
  providerId: string | null,
  opts: Partial<HarnessCompat> = {}
): HarnessCompat {
  return {
    id: `${modelId}__${harnessId}__${providerId ?? "any"}`,
    modelId,
    harnessId,
    providerId,
    authMethod: opts.authMethod ?? (providerId === "ollama" ? "none" : "api_key"),
    requiresApiKey: opts.requiresApiKey ?? (providerId === "ollama" ? false : true),
    supportsDirectly: opts.supportsDirectly ?? false,
    worksWithCustomEndpoint: opts.worksWithCustomEndpoint ?? true,
    worksWithOpenrouter: opts.worksWithOpenrouter ?? (providerId === "openrouter"),
    setupDifficulty: opts.setupDifficulty ?? (providerId === "ollama" ? "easy" : "easy"),
    knownLimitations: opts.knownLimitations ?? null,
    freeStatus: opts.freeStatus ?? "free",
    lastVerifiedAt: opts.lastVerifiedAt ?? "2026-08-15",
    verificationConfidence: opts.verificationConfidence ?? "likely",
    sourceUrl: opts.sourceUrl ?? null,
  };
}

export const HARNESS_COMPAT: HarnessCompat[] = [
  // OpenCode + free API providers (OpenAI-compatible endpoints)
  hc("deepseek-chat", "opencode", "deepseek", { worksWithCustomEndpoint: true, worksWithOpenrouter: true }),
  hc("deepseek-reasoner", "opencode", "deepseek", { worksWithCustomEndpoint: true, worksWithOpenrouter: true }),
  hc("llama-3.3-70b", "opencode", "groq", { worksWithCustomEndpoint: true, worksWithOpenrouter: true }),
  hc("llama-3.1-70b", "opencode", "groq", { worksWithCustomEndpoint: true, worksWithOpenrouter: true }),
  hc("llama-3.1-8b", "opencode", "groq"),
  hc("mixtral-8x7b", "opencode", "groq"),
  hc("gemma-2-9b", "opencode", "groq"),
  hc("gemma-2-27b", "opencode", "groq"),
  hc("llama-3.3-70b", "opencode", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("llama-3.1-70b", "opencode", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("llama-3.1-8b", "opencode", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("qwen2.5-coder-32b", "opencode", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("phi-4", "opencode", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("gemma-2-9b", "opencode", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("deepseek-chat", "opencode", "openrouter", { worksWithOpenrouter: true }),
  hc("gemini-2.0-flash", "opencode", "google", { worksWithCustomEndpoint: true }),
  hc("gpt-4o-mini", "opencode", "openai", { worksWithCustomEndpoint: true }),

  // Cline
  hc("deepseek-chat", "cline", "deepseek"),
  hc("llama-3.3-70b", "cline", "groq"),
  hc("llama-3.3-70b", "cline", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("qwen2.5-coder-32b", "cline", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("deepseek-chat", "cline", "openrouter", { worksWithOpenrouter: true }),
  hc("gemini-2.0-flash", "cline", "google"),

  // Roo Code
  hc("deepseek-chat", "roo-code", "deepseek"),
  hc("llama-3.3-70b", "roo-code", "groq"),
  hc("llama-3.3-70b", "roo-code", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("qwen2.5-coder-32b", "roo-code", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("codestral", "roo-code", "together"),

  // Aider
  hc("deepseek-chat", "aider", "deepseek"),
  hc("llama-3.3-70b", "aider", "groq"),
  hc("llama-3.3-70b", "aider", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("llama-3.1-70b", "aider", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("qwen2.5-coder-32b", "aider", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("phi-4", "aider", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("deepseek-chat", "aider", "openrouter", { worksWithOpenrouter: true }),

  // Continue
  hc("llama-3.3-70b", "continue", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("llama-3.1-70b", "continue", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("qwen2.5-coder-32b", "continue", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("phi-4", "continue", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("gemma-2-9b", "continue", "ollama", { requiresApiKey: false, authMethod: "none" }),
  hc("deepseek-chat", "continue", "deepseek"),
  hc("llama-3.3-70b", "continue", "groq"),

  // Claude Code (no free API; only Anthropic paid or custom base URL to a paid/3p)
  hc("deepseek-chat", "claude-code", "deepseek", { knownLimitations: "Requires custom ANTHROPIC_BASE_URL shim; not officially supported.", verificationConfidence: "unverified" }),
  hc("gemini-2.0-flash", "claude-code", "google", { knownLimitations: "Via third-party Anthropic-compatible proxy; unverified.", verificationConfidence: "unverified" }),

  // Cursor / Windsurf (proprietary; free tier models only)
  hc("gpt-4o-mini", "cursor", "openai", { knownLimitations: "Only models in Cursor's included tier; no BYO endpoint.", verificationConfidence: "likely" }),
  hc("gemini-2.0-flash", "cursor", "google", { knownLimitations: "Included in Cursor's model roster; no BYO.", verificationConfidence: "likely" }),
  hc("gpt-4o-mini", "windsurf", "openai", { knownLimitations: "Included in Windsurf's roster; no BYO.", verificationConfidence: "likely" }),
];

// ---------------------------------------------------------------------------
// Change history (sample timeline)
// ---------------------------------------------------------------------------
export const CHANGES: ChangeHistory[] = [
  { id: "chg-1", entityType: "availability", entityId: "deepseek-chat__deepseek", fieldChanged: "added", oldValue: null, newValue: "free_tier", changeSource: "manual", sourceUrl: "https://platform.deepseek.com", detectedAt: "2025-01-25", verifiedAt: "2025-01-25", notes: "DeepSeek launched free API tier for DeepSeek-V3." },
  { id: "chg-2", entityType: "availability", entityId: "deepseek-reasoner__deepseek", fieldChanged: "added", oldValue: null, newValue: "free_tier", changeSource: "manual", sourceUrl: "https://api-docs.deepseek.com", detectedAt: "2025-01-20", verifiedAt: "2025-01-20", notes: "DeepSeek-R1 reasoning model released with free API." },
  { id: "chg-3", entityType: "availability", entityId: "gemini-2.0-flash__google", fieldChanged: "quota_change", oldValue: "1500 RPD", newValue: "1500 RPD (stable)", changeSource: "manual", sourceUrl: "https://ai.google.dev/pricing", detectedAt: "2025-02-10", verifiedAt: "2025-02-10", notes: "Gemini 2.0 Flash free tier stabilized." },
  { id: "chg-4", entityType: "availability", entityId: "llama-3.3-70b__groq", fieldChanged: "added", oldValue: null, newValue: "free_tier", changeSource: "manual", sourceUrl: "https://groq.com/pricing", detectedAt: "2024-12-08", verifiedAt: "2024-12-08", notes: "Groq added Llama 3.3 70B to free tier." },
  { id: "chg-5", entityType: "availability", entityId: "openai-free", fieldChanged: "status_change", oldValue: "unavailable", newValue: "limited", changeSource: "manual", sourceUrl: "https://openai.com/api/pricing/", detectedAt: "2025-03-01", verifiedAt: "2025-03-01", notes: "OpenAI introduced a limited free tier for chat models." },
  { id: "chg-6", entityType: "availability", entityId: "codestral__mistral", fieldChanged: "quota_change", oldValue: "paid only", newValue: "free_with_limits", changeSource: "manual", sourceUrl: "https://mistral.ai/pricing", detectedAt: "2025-04-15", verifiedAt: null, notes: "Codestral added to free (rate-limited) tier. Unverified." },
  { id: "chg-7", entityType: "availability", entityId: "llama-3.2-90b-vision__groq", fieldChanged: "added", oldValue: null, newValue: "free_tier", changeSource: "manual", sourceUrl: "https://groq.com/pricing", detectedAt: "2024-10-02", verifiedAt: "2024-10-02", notes: "Groq added Llama 3.2 90B Vision to free tier." },
  { id: "chg-8", entityType: "availability", entityId: "qwen2.5-coder-32b__openrouter", fieldChanged: "added", oldValue: null, newValue: "free_through_aggregator", changeSource: "manual", sourceUrl: "https://openrouter.ai/models", detectedAt: "2024-11-20", verifiedAt: "2024-11-20", notes: "OpenRouter added free Qwen2.5-Coder-32B." },
  { id: "chg-9", entityType: "availability", entityId: "command-r__cohere", fieldChanged: "added", oldValue: null, newValue: "free_credits", changeSource: "manual", sourceUrl: "https://cohere.com/pricing", detectedAt: "2025-05-01", verifiedAt: null, notes: "Cohere free trial credits. Unverified." },
];
