import type { Collector } from "./types";
import { OpenAICollector } from "./examples/openai";
import { geminiCollector } from "./gemini";

/**
 * Registry of collectors. To add a provider, implement its `Collector` and push
 * an instance here (or load dynamically). The orchestrator + DbCollectorSink handle
 * the rest. Nothing else in the app references individual collectors.
 *
 * NOTE: production runs use the dedicated orchestrators (`runOpenRouterCollector`,
 * `runGeminiCollector`) directly via the admin UI / CLI; the registry is the
 * generic example contract. Both OpenRouter and Gemini are wired there.
 */
export const collectors: Collector[] = [
  new OpenAICollector(),
  geminiCollector,
  // new AnthropicCollector(),
  // new GoogleCollector(),
];

export function getCollector(id: string): Collector | undefined {
  return collectors.find((c) => c.id === id);
}
