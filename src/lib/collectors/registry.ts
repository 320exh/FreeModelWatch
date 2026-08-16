import type { Collector } from "./types";
import { OpenAICollector } from "./examples/openai";

/**
 * Registry of collectors. To add a provider, implement its `Collector` and push
 * an instance here (or load dynamically). The orchestrator + DbCollectorSink handle
 * the rest. Nothing else in the app references individual collectors.
 */
export const collectors: Collector[] = [
  new OpenAICollector(),
  // new AnthropicCollector(),
  // new GoogleCollector(),
];

export function getCollector(id: string): Collector | undefined {
  return collectors.find((c) => c.id === id);
}
