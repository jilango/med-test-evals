import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const runCaseStatusEnum = pgEnum("run_case_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    status: runStatusEnum("status").notNull().default("queued"),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    datasetFilter: jsonb("dataset_filter").$type<unknown>(),
    force: boolean("force").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    error: text("error"),
    caseCountTotal: integer("case_count_total").notNull().default(0),
    caseCountCompleted: integer("case_count_completed").notNull().default(0),
    schemaFailureCount: integer("schema_failure_count").notNull().default(0),
    hallucinationCount: integer("hallucination_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    overallScore: doublePrecision("overall_score"),
    perFieldScores: jsonb("per_field_scores").$type<Record<string, number>>(),
  },
  (t) => [index("runs_created_at_idx").on(t.createdAt)],
);

export const runCases = pgTable(
  "run_cases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),
    status: runCaseStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    prediction: jsonb("prediction").$type<unknown>(),
    gold: jsonb("gold").$type<unknown>(),
    scores: jsonb("scores").$type<unknown>(),
    hallucinationCount: integer("hallucination_count").notNull().default(0),
    schemaValid: boolean("schema_valid").notNull().default(true),
    attempts: jsonb("attempts").$type<unknown[]>(),
    promptHash: text("prompt_hash").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
  },
  (t) => [
    uniqueIndex("run_cases_run_transcript_uidx").on(t.runId, t.transcriptId),
    index("run_cases_run_id_idx").on(t.runId),
  ],
);

export const extractionCache = pgTable(
  "extraction_cache",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    transcriptId: text("transcript_id").notNull(),
    promptHash: text("prompt_hash").notNull(),
    extraction: jsonb("extraction").$type<unknown>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("extraction_cache_key_uidx").on(
      t.strategy,
      t.model,
      t.transcriptId,
      t.promptHash,
    ),
  ],
);

export const runsRelations = relations(runs, ({ many }) => ({
  cases: many(runCases),
}));

export const runCasesRelations = relations(runCases, ({ one }) => ({
  run: one(runs, {
    fields: [runCases.runId],
    references: [runs.id],
  }),
}));
