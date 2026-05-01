import "./load-env";

import { describe, expect, it } from "bun:test";

import { loadDataset } from "../apps/server/src/dataset";
import { createRunner } from "../apps/server/src/services/runner.service";

import { db } from "../packages/db/src/index";
import { extractionCache, runCases, runs } from "../packages/db/src/schema/eval";

import { eq } from "drizzle-orm";

function newId() {
  return crypto.randomUUID();
}

function validExtraction() {
  return {
    chief_complaint: "cough",
    vitals: { bp: null, hr: null, temp_f: null, spo2: null },
    medications: [],
    diagnoses: [],
    plan: [],
    follow_up: { interval_days: null, reason: null },
  };
}

async function cleanup() {
  // Order matters because of FK cascade.
  await db.delete(runCases);
  await db.delete(runs);
  await db.delete(extractionCache);
}

async function waitForRun(runId: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (r?.status === "completed") return r;
    if (r?.status === "failed") throw new Error(r.error ?? "run failed");
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`timeout waiting for run ${runId}`);
}

describe("phase8 runner idempotency + resumability", () => {
  it("idempotency: second run reuses extraction_cache when force=false", async () => {
    await cleanup();

    let calls = 0;
    const runner = createRunner({
      extractTranscript: async () => {
        calls++;
        return {
          ok: true,
          prompt_hash: "test",
          extraction: validExtraction(),
          attempts: [{ attempt: 1, schema_valid: true, token_usage: { input_tokens: 1, output_tokens: 1 } }],
        };
      },
    });

    const first = await runner.startRun({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      dataset_filter: { ids: ["case_001"] },
      force: true,
    });
    await waitForRun(first.run_id);
    expect(calls).toBe(1);

    const second = await runner.startRun({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      dataset_filter: { ids: ["case_001"] },
      force: false,
    });
    await waitForRun(second.run_id);
    expect(calls).toBe(1);

    const caseRows = await db.query.runCases.findMany({
      where: eq(runCases.runId, second.run_id),
    });
    expect(caseRows.length).toBe(1);
    // cache_hit creates a synthetic attempt 0
    expect((caseRows[0]!.attempts as any[])?.[0]?.attempt).toBe(0);
  });

  it("resumability: processRun continues only pending cases", async () => {
    await cleanup();
    const dataset = await loadDataset();
    const c1 = dataset.find((c) => c.transcript_id === "case_001")!;
    const c2 = dataset.find((c) => c.transcript_id === "case_002")!;

    let calls = 0;
    const runner = createRunner({
      extractTranscript: async () => {
        calls++;
        return {
          ok: true,
          prompt_hash: "test",
          extraction: validExtraction(),
          attempts: [{ attempt: 1, schema_valid: true, token_usage: { input_tokens: 1, output_tokens: 1 } }],
        };
      },
    });

    const runId = newId();
    const promptHash = "prompt_hash_test";
    await db.insert(runs).values({
      id: runId,
      status: "queued",
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      promptHash,
      caseCountTotal: 2,
      caseCountCompleted: 1,
    });

    await db.insert(runCases).values([
      {
        id: newId(),
        runId,
        transcriptId: c1.transcript_id,
        status: "completed",
        endedAt: new Date(),
        gold: c1.gold,
        prediction: validExtraction(),
        scores: { overall: 1, chief_complaint: 1, vitals: 1, medications_f1: 1, diagnoses_f1: 1, plan_f1: 1, follow_up: 1 },
        hallucinationCount: 0,
        schemaValid: true,
        attempts: [{ attempt: 0, note: "precompleted" }],
        promptHash,
      },
      {
        id: newId(),
        runId,
        transcriptId: c2.transcript_id,
        status: "pending",
        gold: c2.gold,
        promptHash,
      },
    ]);

    await runner.processRun(runId);
    const run = await waitForRun(runId);
    expect(run.caseCountCompleted).toBe(2);
    expect(calls).toBe(1);
  });
});

