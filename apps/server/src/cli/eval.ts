import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

// Load env before importing anything that reads @test-evals/env/server
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
config({ path: path.join(repoRoot, "apps/server/.env") });

// Allow a minimal `.env` (DATABASE_URL + ANTHROPIC_API_KEY) for CLI usage.
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  process.env.BETTER_AUTH_SECRET = "test_eval_cli_secret_32_chars_min____";
}
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.NODE_ENV ??= "development";

type Args = {
  strategy: "zero_shot" | "few_shot" | "cot";
  model: string;
  ids?: string[];
  idRegex?: string;
  force?: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (const raw of argv) {
    const [k, ...rest] = raw.replace(/^--/, "").split("=");
    const v = rest.join("=");
    if (k === "strategy") out.strategy = v as Args["strategy"];
    if (k === "model") out.model = v;
    if (k === "ids") out.ids = v.split(/[\s,]+/g).map((s) => s.trim()).filter(Boolean);
    if (k === "idRegex") out.idRegex = v;
    if (k === "force") out.force = v === "true" || v === "1";
  }
  return {
    strategy: (out.strategy ?? "zero_shot") as Args["strategy"],
    model: out.model ?? "claude-haiku-4-5-20251001",
    ids: out.ids,
    idRegex: out.idRegex,
    force: out.force ?? false,
  };
}

function fmt(n: number | null | undefined, digits = 4) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

async function waitForRun(runId: string, timeoutMs = 60 * 60 * 1000) {
  const { db } = await import("@test-evals/db");
  const { runs } = await import("@test-evals/db/schema/eval");
  const { eq } = await import("drizzle-orm");
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status === "completed") return run;
    if (run.status === "failed") throw new Error(run.error ?? "run failed");
    if (Date.now() > deadline) throw new Error(`Timed out waiting for run ${runId}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function printSummary(run: any) {
  const per = (run.perFieldScores ?? {}) as Record<string, number>;
  const lines = [
    `run_id: ${run.id}`,
    `strategy: ${run.strategy}`,
    `model: ${run.model}`,
    `prompt_hash: ${run.promptHash}`,
    `status: ${run.status}`,
    `cases: ${run.caseCountCompleted}/${run.caseCountTotal}`,
    `overall: ${fmt(run.overallScore)}`,
    `chief_complaint: ${fmt(per.chief_complaint)}`,
    `vitals: ${fmt(per.vitals)}`,
    `medications_f1: ${fmt(per.medications_f1)}`,
    `diagnoses_f1: ${fmt(per.diagnoses_f1)}`,
    `plan_f1: ${fmt(per.plan_f1)}`,
    `follow_up: ${fmt(per.follow_up)}`,
    `schema_failures: ${run.schemaFailureCount}`,
    `hallucinations: ${run.hallucinationCount}`,
    `tokens_in/out: ${run.inputTokens}/${run.outputTokens}`,
    `cache_read/write: ${run.cacheReadTokens}/${run.cacheWriteTokens}`,
    `cost_usd: ${fmt(run.costUsd, 6)}`,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

async function main() {
  const [{ runner }, { db }, { runCases }] = await Promise.all([
    import("../services/runner.service"),
    import("@test-evals/db"),
    import("@test-evals/db/schema/eval"),
  ]);
  const { eq } = await import("drizzle-orm");

  const args = parseArgs(process.argv.slice(2));
  const dataset_filter =
    args.ids?.length || args.idRegex
      ? { ids: args.ids, id_regex: args.idRegex }
      : undefined;

  // eslint-disable-next-line no-console
  console.log(
    `Starting eval: strategy=${args.strategy} model=${args.model} force=${String(args.force)} ` +
      (dataset_filter ? `filter=${JSON.stringify(dataset_filter)}` : "filter=ALL"),
  );

  const { run_id } = await runner.startRun({
    strategy: args.strategy,
    model: args.model,
    dataset_filter,
    force: args.force,
  });

  const run = await waitForRun(run_id);
  printSummary(run);

  // Print quick per-case overall scores for debugging (first 10)
  const cases = await db.query.runCases.findMany({
    where: eq(runCases.runId, run_id),
    limit: 10,
    orderBy: (t, { asc }) => [asc(t.transcriptId)],
  });
  const rows = cases.map((c) => ({
    transcript: c.transcriptId,
    status: c.status,
    overall: (c.scores as any)?.overall,
  }));
  // eslint-disable-next-line no-console
  console.log("\nfirst_cases:", JSON.stringify(rows, null, 2));
}

await main();

