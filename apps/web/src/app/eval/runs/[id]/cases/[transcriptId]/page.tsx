"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiJson } from "@/lib/api";

type RunDetail = {
  id: string;
  strategy: string;
  model: string;
  promptHash: string;
};

type CaseRow = {
  transcriptId: string;
  status: string;
  prediction: unknown;
  gold: unknown;
  scores: Record<string, unknown> | null;
  hallucinationReport: { count: number; fields: Record<string, boolean> } | null;
  attempts: unknown[] | null;
};

export default function CaseDetailPage() {
  const params = useParams();
  const runId = typeof params.id === "string" ? params.id : "";
  const transcriptId = typeof params.transcriptId === "string" ? params.transcriptId : "";
  const [run, setRun] = useState<RunDetail | null>(null);
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId || !transcriptId) return;
    setError(null);
    try {
      const data = await apiJson<{ run: RunDetail; cases: CaseRow[] }>(`/api/v1/runs/${runId}`);
      setRun(data.run);
      const c = data.cases.find((x) => x.transcriptId === transcriptId);
      setCaseRow(c ?? null);
      const t = await apiJson<{ text: string }>(`/api/v1/transcripts/${transcriptId}`);
      setTranscript(t.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [runId, transcriptId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 text-sm">
        <Link href={`/eval/runs/${runId}`} className="underline">
          ← Run {runId.slice(0, 8)}…
        </Link>
      </div>

      {error ? (
        <p className="mb-4 rounded border border-destructive/50 p-2 text-sm text-destructive">{error}</p>
      ) : null}

      {run ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {run.strategy} · {run.model} · <span className="font-mono text-xs">{run.promptHash}</span>
        </p>
      ) : null}

      <h1 className="mb-4 text-2xl font-semibold">Case {transcriptId}</h1>

      {caseRow?.scores ? (
        <section className="mb-6">
          <h2 className="mb-2 font-medium">Scores</h2>
          <pre className="overflow-x-auto rounded border p-3 text-xs">{JSON.stringify(caseRow.scores, null, 2)}</pre>
        </section>
      ) : null}

      {caseRow?.hallucinationReport ? (
        <section className="mb-6">
          <h2 className="mb-2 font-medium">Hallucination flags</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            <code>true</code> = flagged as ungrounded for that path
          </p>
          <pre className="overflow-x-auto rounded border p-3 text-xs">
            {JSON.stringify(caseRow.hallucinationReport.fields, null, 2)}
          </pre>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 font-medium">Transcript</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">{transcript ?? "…"}</pre>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-medium">Gold</h2>
          <pre className="max-h-[480px] overflow-auto rounded border p-3 text-xs">
            {caseRow?.gold != null ? JSON.stringify(caseRow.gold, null, 2) : "—"}
          </pre>
        </section>
        <section>
          <h2 className="mb-2 font-medium">Prediction</h2>
          <pre className="max-h-[480px] overflow-auto rounded border p-3 text-xs">
            {caseRow?.prediction != null ? JSON.stringify(caseRow.prediction, null, 2) : "—"}
          </pre>
        </section>
      </div>

      {caseRow?.attempts?.length ? (
        <section className="mt-8">
          <h2 className="mb-2 font-medium">LLM attempts (trace)</h2>
          <pre className="max-h-96 overflow-auto rounded border p-3 text-xs">
            {JSON.stringify(caseRow.attempts, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
