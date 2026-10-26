// Выбор провайдера по LLM_PROVIDER
import { requireEnv } from "../env.ts";
import { createOpenRouterProvider } from "./openrouter.ts";
import type { LlmProvider } from "./provider.ts";

export function createLlmProvider(): LlmProvider {
  const name = requireEnv("LLM_PROVIDER");
  switch (name) {
    case "openrouter":
      return createOpenRouterProvider(requireEnv("OPENROUTER_API_KEY"));
    default:
      throw new Error(`Неизвестный LLM_PROVIDER: ${name}`);
  }
}
