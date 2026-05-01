import { env } from "@test-evals/env/server";
import { AnthropicSdkClient, extractWithRetry } from "@test-evals/llm";
import type { Strategy } from "@test-evals/shared";

const client = new AnthropicSdkClient(env.ANTHROPIC_API_KEY);

export async function extractTranscript(args: {
  transcript: string;
  strategy: Strategy;
  model: string;
}) {
  return await extractWithRetry({
    client,
    transcript: args.transcript,
    strategy: args.strategy,
    model: args.model,
    maxAttempts: env.EVAL_MAX_RETRIES,
  });
}

