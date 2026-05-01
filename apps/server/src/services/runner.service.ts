import { env } from "@test-evals/env/server";
import { db } from "@test-evals/db";
import { extractionCache, runCases, runs } from "@test-evals/db/schema/eval";
import { computePromptHashForStrategy } from "@test-evals/llm";
import type { ClinicalExtraction, Strategy, TokenUsage } from "@test-evals/shared";
import { ClinicalExtractionSchema } from "@test-evals/shared";
import { and, eq, sql } from "drizzle-orm";

import { loadDataset, type DatasetCase } from "../dataset";
import { extractTranscript } from "./extract.service";
import { evaluateCase } from "./evaluate.service";
import { emitRunEvent } from "./runner-broadcast";

export type DatasetFilter =
  | { ids?: string[]; id_regex?: string }
  | undefined;

export type RunnerDeps = {
  extractTranscript: typeof extractTranscript;
};

const defaultDeps: RunnerDeps = {
  extractTranscript,
};

const activeRuns = new Set<string>();

function newId() {
  return crypto.randomUUID();
}

function sumUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
    cache_read_input_tokens:
      (a?.cache_read_input_tokens ?? 0) + (b?.cache_read_input_tokens ?? 0),
    cache_write_input_tokens:
      (a?.cache_write_input_tokens ?? 0) + (b?.cache_write_input_tokens ?? 0),
  };
}

function usageToColumns(u: TokenUsage) {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_write_input_tokens ?? 0,
  };
}

// Rough Haiku-ish pricing defaults (override via env if needed later).
function estimateCostUsd(u: TokenUsage) {
  const input = u.input_tokens;
  const output = u.output_tokens;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_write_input_tokens ?? 0;

  const inPrice = 1 / 1_000_000; // $1/M input (placeholder; tune with real pricing tables)
  const outPrice = 5 / 1_000_000; // $5/M output (placeholder)
  const cacheReadPrice = 0.1 / 1_000_000; // heavily discounted vs full input (placeholder)
  const cacheWritePrice = 1.25 / 1_000_000; // cache write premium (placeholder)

  return (
    input * inPrice +
    output * outPrice +
    cacheRead * cacheReadPrice +
    cacheWrite * cacheWritePrice
  );
}

function filterCases(cases: DatasetCase[], filter: DatasetFilter) {
  if (!filter) return cases;
  if (filter.ids?.length) {
    const set = new Set(filter.ids);
    return cases.filter((c) => set.has(c.transcript_id));
  }
  if (filter.id_regex) {
    const re = new RegExp(filter.id_regex);
    return cases.filter((c) => re.test(c.transcript_id));
  }
  return cases;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = new Array(Math.min(concurrency, queue.length)).fill(0).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function meanFieldAggregate(rows: { scores: any }[]) {
  const keys = [
    "chief_complaint",
    "vitals",
    "medications_f1",
    "diagnoses_f1",
    "plan_f1",
    "follow_up",
  ] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const vals = rows.map((r) => r.scores?.[k]).filter((x) => typeof x === "number");
    out[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  return out;
}

export function createRunner(deps: Partial<RunnerDeps> = {}) {
  const d: RunnerDeps = { ...defaultDeps, ...deps };

  async function finalizeRunAggregates(runId: string) {
    const cases = await db.query.runCases.findMany({ where: eq(runCases.runId, runId) });
    const pending = cases.filter((c) => c.status === "pending" || c.status === "running").length;
    if (pending > 0) return;

    const completed = cases.filter((c) => c.status === "completed" && c.scores);
    const overall =
      completed.length === 0
        ? 0
        : completed.reduce((acc, c) => acc + (c.scores as any).overall, 0) / completed.length;

    const perField = meanFieldAggregate(completed as any);

    await db
      .update(runs)
      .set({
        overallScore: overall,
        perFieldScores: perField,
        endedAt: new Date(),
        status: "completed",
      })
      .where(eq(runs.id, runId));

    await emitRunEvent(runId, "run_complete", { run_id: runId, overall_score: overall });
  }

  async function processCase(runId: string, caseRowId: string, transcriptId: string) {
    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (!run) return;

    const dataset = await loadDataset();
    const filtered = filterCases(dataset, run.datasetFilter as DatasetFilter);
    const c = filtered.find((x) => x.transcript_id === transcriptId);
    if (!c) {
      await db
        .update(runCases)
        .set({
          status: "failed",
          error: "Transcript not found for dataset filter",
          endedAt: new Date(),
        })
        .where(eq(runCases.id, caseRowId));

      await db
        .update(runs)
        .set({
          caseCountCompleted: sql`${runs.caseCountCompleted} + 1`,
        })
        .where(eq(runs.id, runId));

      await emitRunEvent(runId, "case_complete", {
        transcript_id: transcriptId,
        status: "failed",
        error: "Transcript not found for dataset filter",
      });
      return;
    }

    const gold = ClinicalExtractionSchema.parse(c.gold);

    await db
      .update(runCases)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(runCases.id, caseRowId));

    let totalUsage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_write_input_tokens: 0,
    };
    let cost = 0;
    let prediction: ClinicalExtraction | undefined;
    let attempts: unknown[] | undefined;
    let schemaValid = true;

    const promptHash = computePromptHashForStrategy(run.strategy as Strategy, run.model);

    if (!run.force) {
      const cached = await db.query.extractionCache.findFirst({
        where: and(
          eq(extractionCache.strategy, run.strategy),
          eq(extractionCache.model, run.model),
          eq(extractionCache.transcriptId, transcriptId),
          eq(extractionCache.promptHash, promptHash),
        ),
      });
      if (cached) {
        prediction = ClinicalExtractionSchema.parse(cached.extraction);
        attempts = [{ attempt: 0, note: "cache_hit" }];
      }
    }

    if (!prediction) {
      const ext = await d.extractTranscript({
        transcript: c.transcript,
        strategy: run.strategy as Strategy,
        model: run.model,
      });
      attempts = ext.attempts;
      for (const a of ext.attempts) {
        totalUsage = sumUsage(totalUsage, a.token_usage);
      }
      cost += estimateCostUsd(totalUsage);

      if (!ext.ok) {
        schemaValid = false;
        await db
          .update(runCases)
          .set({
            status: "failed",
            endedAt: new Date(),
            error: ext.error,
            prediction: null,
            gold,
            attempts: ext.attempts as unknown[],
            schemaValid: false,
            promptHash,
            ...usageToColumns(totalUsage),
            costUsd: cost,
          })
          .where(eq(runCases.id, caseRowId));

        await db
          .update(runs)
          .set({
            schemaFailureCount: sql`${runs.schemaFailureCount} + 1`,
            caseCountCompleted: sql`${runs.caseCountCompleted} + 1`,
            inputTokens: sql`${runs.inputTokens} + ${totalUsage.input_tokens}`,
            outputTokens: sql`${runs.outputTokens} + ${totalUsage.output_tokens}`,
            cacheReadTokens: sql`${runs.cacheReadTokens} + ${totalUsage.cache_read_input_tokens ?? 0}`,
            cacheWriteTokens: sql`${runs.cacheWriteTokens} + ${totalUsage.cache_write_input_tokens ?? 0}`,
            costUsd: sql`${runs.costUsd} + ${cost}`,
          })
          .where(eq(runs.id, runId));

        await emitRunEvent(runId, "case_complete", {
          transcript_id: transcriptId,
          status: "failed",
          schema_valid: false,
        });
        return;
      }

      prediction = ClinicalExtractionSchema.parse(ext.extraction);

      await db
        .insert(extractionCache)
        .values({
          id: newId(),
          strategy: run.strategy,
          model: run.model,
          transcriptId,
          promptHash,
          extraction: prediction,
        })
        .onConflictDoUpdate({
          target: [
            extractionCache.strategy,
            extractionCache.model,
            extractionCache.transcriptId,
            extractionCache.promptHash,
          ],
          set: { extraction: prediction },
        });
    }

    const evaluated = evaluateCase({
      transcript: c.transcript,
      prediction,
      gold,
    });

    await db
      .update(runCases)
      .set({
        status: "completed",
        endedAt: new Date(),
        prediction,
        gold,
        scores: evaluated.scores,
        hallucinationCount: evaluated.hallucinations.count,
        schemaValid,
        attempts: attempts as unknown[],
        promptHash,
        ...usageToColumns(totalUsage),
        costUsd: cost,
      })
      .where(eq(runCases.id, caseRowId));

    await db
      .update(runs)
      .set({
        caseCountCompleted: sql`${runs.caseCountCompleted} + 1`,
        hallucinationCount: sql`${runs.hallucinationCount} + ${evaluated.hallucinations.count}`,
        inputTokens: sql`${runs.inputTokens} + ${totalUsage.input_tokens}`,
        outputTokens: sql`${runs.outputTokens} + ${totalUsage.output_tokens}`,
        cacheReadTokens: sql`${runs.cacheReadTokens} + ${totalUsage.cache_read_input_tokens ?? 0}`,
        cacheWriteTokens: sql`${runs.cacheWriteTokens} + ${totalUsage.cache_write_input_tokens ?? 0}`,
        costUsd: sql`${runs.costUsd} + ${cost}`,
      })
      .where(eq(runs.id, runId));

    await emitRunEvent(runId, "case_complete", {
      transcript_id: transcriptId,
      status: "completed",
      overall: evaluated.scores.overall,
    });
  }

  async function processRun(runId: string) {
    if (activeRuns.has(runId)) return;
    activeRuns.add(runId);

    await db
      .update(runs)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(runs.id, runId));
    await emitRunEvent(runId, "run_start", { run_id: runId });

    try {
      const pending = await db.query.runCases.findMany({
        where: and(eq(runCases.runId, runId), eq(runCases.status, "pending")),
        orderBy: (t, { asc }) => [asc(t.transcriptId)],
      });

      await runPool(pending, env.EVAL_MAX_CONCURRENCY, async (row) => {
        await processCase(runId, row.id, row.transcriptId);
      });

      await finalizeRunAggregates(runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(runs)
        .set({ status: "failed", endedAt: new Date(), error: msg })
        .where(eq(runs.id, runId));
      await emitRunEvent(runId, "run_failed", { run_id: runId, error: msg });
    } finally {
      activeRuns.delete(runId);
    }
  }

  async function startRun(input: {
    strategy: Strategy;
    model: string;
    dataset_filter?: DatasetFilter;
    force?: boolean;
  }) {
    const dataset = await loadDataset();
    const filtered = filterCases(dataset, input.dataset_filter);
    const promptHash = computePromptHashForStrategy(input.strategy, input.model);

    const runId = newId();
    await db.insert(runs).values({
      id: runId,
      status: "queued",
      strategy: input.strategy,
      model: input.model,
      promptHash,
      datasetFilter: input.dataset_filter ?? null,
      force: Boolean(input.force),
      caseCountTotal: filtered.length,
    });

    for (const c of filtered) {
      await db.insert(runCases).values({
        id: newId(),
        runId,
        transcriptId: c.transcript_id,
        status: "pending",
        gold: ClinicalExtractionSchema.parse(c.gold),
        promptHash,
      });
    }

    void processRun(runId);
    return { run_id: runId };
  }

  async function resumeRun(runId: string) {
    void processRun(runId);
    return { run_id: runId };
  }

  return { startRun, resumeRun, processRun };
}

export const runner = createRunner();
