// Общие заготовки тестов: парсер по сценарию и сборка ingest на памяти
import type { AdminNotifier } from "../admin.ts";
import { ingest, type IngestDeps } from "../ingest.ts";
import type { ParseResult } from "../parser/parse.ts";
import type { PromptContext } from "../parser/prompt.ts";
import type { ParsedItem } from "../parser/schema.ts";
import { createMemoryStore } from "./memory-store.ts";

// Момент из эталонных фраз: 2026-10-26 15:51, понедельник, Europe/Samara
export const NOW = new Date("2026-10-26T11:51:00Z");
export const TZ = "Europe/Samara";

export interface Harness {
  clock: { now: Date };
  memory: ReturnType<typeof createMemoryStore>;
  // Ответы парсера по фразе; фразы, с которыми его вызвали
  answers: Map<string, ParsedItem[] | "fail">;
  phrases: string[];
  alerts: { kind: string; text: string }[];
  deps: IngestDeps;
  run: typeof ingest extends (d: IngestDeps, i: infer I) => infer R
    ? (i: I) => R
    : never;
}

export function harness(llmDailyCap = 50): Harness {
  const clock = { now: NOW };
  const memory = createMemoryStore(() => clock.now);
  const answers = new Map<string, ParsedItem[] | "fail">();
  const phrases: string[] = [];
  const alerts: { kind: string; text: string }[] = [];
  const notifyAdmins: AdminNotifier = (kind, text) => {
    alerts.push({ kind, text });
    return Promise.resolve();
  };
  const deps: IngestDeps = {
    store: memory.store,
    llmDailyCap,
    notifyAdmins,
    parse(_ctx: PromptContext, phrase: string): Promise<ParseResult> {
      phrases.push(phrase);
      const answer = answers.get(phrase);
      const attempt = {
        model: "free-model",
        tokensIn: 100,
        tokensOut: 20,
        ms: 300,
        error: null,
      };
      if (answer === undefined || answer === "fail") {
        return Promise.resolve({
          ok: false,
          attempts: [{ ...attempt, error: "не JSON" }],
        });
      }
      return Promise.resolve({ ok: true, items: answer, attempts: [attempt] });
    },
  };
  return {
    clock,
    memory,
    answers,
    phrases,
    alerts,
    deps,
    run: (input) => ingest(deps, input),
  };
}
