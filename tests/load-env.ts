/**
 * Import this module first in integration tests so `process.env` is populated
 * before `@test-evals/env/server` / `@test-evals/db` initialize.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, "apps/server/.env") });

// `@test-evals/env/server` requires these; allow a minimal `.env` for integration tests.
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  process.env.BETTER_AUTH_SECRET = "test_integration_secret_32_chars_min__";
}
process.env.BETTER_AUTH_URL ??= "http://localhost:8787";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.NODE_ENV ??= "test";
