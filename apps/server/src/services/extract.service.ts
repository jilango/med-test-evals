import { env } from "@test-evals/env/server";
import { AnthropicSdkClient, extractWithRetry } from "@test-evals/llm";
import type { Strategy } from "@test-evals/shared";

const client = new AnthropicSdkClient(env.ANTHROPIC_API_KEY);

export function isRateLimitError(err: unknown) {
  const anyErr = err as any;
  return anyErr?.status === 429 || anyErr?.error?.type === "rate_limit_error";
}

export function createExtractTranscript(deps?: {
  sleep?: (ms: number) => Promise<void>;
  extract?: typeof extractWithRetry;
}) {
  const sleep = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const extract = deps?.extract ?? extractWithRetry;

  return async function extractTranscript(args: {
    transcript: string;
    strategy: Strategy;
    model: string;
  }) {
    let attempt = 0;
    let backoff = env.EVAL_RATE_LIMIT_BASE_BACKOFF_MS;

    // Anthropic rate limits: retry with exponential backoff + jitter.
    // This wraps the whole extract+schema-retry loop.
    while (true) {
      try {
        return await extract({
          client,
          transcript: args.transcript,
          strategy: args.strategy,
          model: args.model,
          maxAttempts: env.EVAL_MAX_RETRIES,
        });
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= 8) throw err;
        const jitter = Math.floor(Math.random() * 250);
        await sleep(Math.min(env.EVAL_RATE_LIMIT_MAX_BACKOFF_MS, backoff + jitter));
        backoff = Math.min(env.EVAL_RATE_LIMIT_MAX_BACKOFF_MS, backoff * 2);
        attempt++;
      }
    }
  };
}

export const extractTranscript = createExtractTranscript();

export async function extractTranscriptLegacy(args: {
  transcript: string;
  strategy: Strategy;
  model: string;
}) {
  return extractTranscript(args);
}

