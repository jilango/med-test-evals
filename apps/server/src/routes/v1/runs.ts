import { z } from "zod";

import { db } from "@test-evals/db";
import { runCases, runs } from "@test-evals/db/schema/eval";
import type { Strategy } from "@test-evals/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { runner } from "../../services/runner.service";
import { subscribeRunEvents } from "../../services/runner-broadcast";

const BodySchema = z.object({
  strategy: z.enum(["zero_shot", "few_shot", "cot"]),
  model: z.string().min(1),
  dataset_filter: z
    .object({
      ids: z.array(z.string().min(1)).optional(),
      id_regex: z.string().min(1).optional(),
    })
    .optional(),
  force: z.boolean().optional(),
});

export const runsApi = new Hono();

runsApi.post("/runs", async (c) => {
  const json = BodySchema.parse(await c.req.json());
  const res = await runner.startRun({
    strategy: json.strategy as Strategy,
    model: json.model,
    dataset_filter: json.dataset_filter,
    force: json.force,
  });
  return c.json(res, 201);
});

runsApi.post("/runs/:id/resume", async (c) => {
  const id = c.req.param("id");
  const res = await runner.resumeRun(id);
  return c.json(res, 202);
});

runsApi.get("/runs", async (c) => {
  const rows = await db.query.runs.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 200,
  });
  return c.json({ runs: rows });
});

runsApi.get("/runs/:id", async (c) => {
  const id = c.req.param("id");
  const run = await db.query.runs.findFirst({ where: eq(runs.id, id) });
  if (!run) return c.json({ error: "not_found" }, 404);
  const cases = await db.query.runCases.findMany({
    where: eq(runCases.runId, id),
    orderBy: (t, { asc }) => [asc(t.transcriptId)],
  });
  return c.json({ run, cases });
});

runsApi.get("/runs/:id/events", async (c) => {
  const id = c.req.param("id");

  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribeRunEvents(id, async (event, data) => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    });

    await stream.writeSSE({
      event: "hello",
      data: JSON.stringify({ run_id: id }),
    });

    c.req.raw.signal.addEventListener("abort", () => {
      unsubscribe();
    });

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener("abort", () => resolve());
    });
  });
});
