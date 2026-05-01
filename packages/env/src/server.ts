import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    ANTHROPIC_API_KEY: z.string().min(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Eval/runtime knobs
    EVAL_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
    EVAL_MAX_RETRIES: z.coerce.number().int().min(1).max(5).default(3),
    EVAL_RATE_LIMIT_BASE_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(50)
      .max(60_000)
      .default(1_000),
    EVAL_RATE_LIMIT_MAX_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(50)
      .max(300_000)
      .default(30_000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
