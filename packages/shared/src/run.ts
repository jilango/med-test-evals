export type Strategy = "zero_shot" | "few_shot" | "cot";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_write_input_tokens?: number;
};

export type LlmAttemptLog = {
  attempt: number;
  started_at: string;
  ended_at: string;
  model: string;
  prompt_hash: string;
  token_usage?: TokenUsage;
  schema_valid: boolean;
  schema_errors?: string[];
};

export type RunCaseScore = {
  chief_complaint: number;
  vitals: number;
  medications_f1: number;
  diagnoses_f1: number;
  plan_f1: number;
  follow_up: number;
  overall: number;
};

export type RunCaseResultDto = {
  transcript_id: string;
  scores: RunCaseScore;
  hallucination_count: number;
  schema_valid: boolean;
  prediction: unknown;
  gold: unknown;
  attempts: LlmAttemptLog[];
};

export type RunAggregateDto = {
  strategy: Strategy;
  model: string;
  prompt_hash: string;
  status: RunStatus;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  case_count_total: number;
  case_count_completed: number;
  schema_failure_count: number;
  hallucination_count: number;
  token_usage_total?: TokenUsage;
  cost_usd?: number;
  overall_score?: number;
  per_field?: Record<string, number>;
};

