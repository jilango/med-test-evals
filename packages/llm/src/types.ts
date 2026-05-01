import type { Strategy, TokenUsage } from "@test-evals/shared";

export type ExtractOptions = {
  strategy: Strategy;
  model: string;
  prompt_hash: string;
  max_retries: number;
};

export type ExtractSuccess = {
  ok: true;
  prompt_hash: string;
  extraction: unknown;
  attempts: ExtractAttempt[];
};

export type ExtractFailure = {
  ok: false;
  prompt_hash: string;
  error: string;
  attempts: ExtractAttempt[];
};

export type ExtractResult = ExtractSuccess | ExtractFailure;

export type ExtractAttempt = {
  attempt: number;
  schema_valid: boolean;
  schema_errors?: string[];
  token_usage?: TokenUsage;
};

export type AnthropicMessageClient = {
  createMessage(args: unknown): Promise<unknown>;
};

