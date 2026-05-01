import "./load-env";

import { describe, expect, it } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../packages/db/src/index.ts";
import { runCases, runs } from "../packages/db/src/schema/eval.ts";
import type { Strategy } from "../packages/shared/src/run.ts";

import { loadDataset } from "../apps/server/src/dataset";
import { runner } from "../apps/server/src/services/runner.service";

const MODEL = "claude-haiku-4-5-20251001";
const TRANSCRIPT_ID = "case_001";
const TIMEOUT_MS = 180_000;

/** Set `RUN_ANTHROPIC_INTEGRATION=1` plus valid `apps/server/.env` to run (3 live API calls). */
const hasLiveEnv =
  process.env.RUN_ANTHROPIC_INTEGRATION === "1" &&
  Boolean(process.env.ANTHROPIC_API_KEY?.trim()) &&
  Boolean(process.env.DATABASE_URL?.trim());

async function waitForRunComplete(runId: string) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (run?.status === "completed") return run;
    if (run?.status === "failed") {
      throw new Error(run.error ?? "run failed");
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Run ${runId} did not complete within ${TIMEOUT_MS}ms`);
}

const integration = hasLiveEnv ? describe : describe.skip;

integration("integration: all phases (1 case, live Anthropic)", () => {
  it("phase 1–5: zero_shot run completes with scores in DB", async () => {
    await oneStrategyRun("zero_shot");
  });

  it("phase 1–5: few_shot run completes with scores in DB", async () => {
    await oneStrategyRun("few_shot");
  });

  it("phase 1–5: cot run completes with scores in DB", async () => {
    await oneStrategyRun("cot");
  });
});

async function oneStrategyRun(strategy: Strategy) {
  const cases = await loadDataset();
  expect(cases.some((c) => c.transcript_id === TRANSCRIPT_ID)).toBe(true);

  const { run_id } = await runner.startRun({
    strategy,
    model: MODEL,
    dataset_filter: { ids: [TRANSCRIPT_ID] },
    force: true,
  });

  const run = await waitForRunComplete(run_id);
  expect(run.status).toBe("completed");
  expect(run.caseCountTotal).toBe(1);
  expect(run.caseCountCompleted).toBe(1);
  expect(run.overallScore).not.toBeNull();
  expect(run.promptHash?.length).toBeGreaterThan(0);

  const rows = await db.query.runCases.findMany({
    where: eq(runCases.runId, run_id),
  });
  expect(rows.length).toBe(1);
  const row = rows[0]!;
  expect(row.status).toBe("completed");
  expect(row.scores).toBeTruthy();
  expect(row.prediction).toBeTruthy();
  expect(row.attempts?.length).toBeGreaterThan(0);
}
