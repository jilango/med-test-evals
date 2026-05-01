import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

const here = path.dirname(fileURLToPath(import.meta.url));
// drizzle.config.ts lives in packages/db → repo root is ../..
const serverEnvPath = path.resolve(here, "../../apps/server/.env");
const rootEnvPath = path.resolve(here, "../../.env");

// Load in fixed order; later files do not override existing env by default.
dotenv.config({ path: serverEnvPath });
dotenv.config({ path: rootEnvPath });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    [
      "DATABASE_URL is empty or unset.",
      `Expected it in ${serverEnvPath} (copy from apps/server/.env.example).`,
      "Example: postgres://postgres:postgres@localhost:5432/healosbench",
    ].join(" "),
  );
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
