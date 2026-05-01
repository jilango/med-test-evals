"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiBase, apiJson } from "@/lib/api";

type RunDetail = {
  id: string;
  status: string;
  strategy: string;
  model: string;
  promptHash: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  overallScore: number | null;
  perFieldScores: Record<string, number> | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  caseCountTotal: number;
  caseCountCompleted: number;
  schemaFailureCount: number;
  hallucinationCount: number;
  error: string | null;
};

type CaseRow = {
  id: string;
  transcriptId: string;
  status: string;
  scores: { overall?: number } | null;
  hallucinationCount: number;
  schemaValid: boolean;
  error: string | null;
};

export default function RunDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [run, setRun] = useState<RunDetail | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string>("");

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await apiJson<{ run: RunDetail; cases: CaseRow[] }>(`/api/v1/runs/${id}`);
      setRun(data.run);
      setCases(data.cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id || !run || run.status === "completed" || run.status === "failed") return;
    const es = new EventSource(`${apiBase()}/api/v1/runs/${id}/events`);
    es.addEventListener("case_complete", (ev) => {
      setLive((prev) => `${prev}\n${ev.data}`);
      void load();
    });
    es.addEventListener("run_complete", () => {
      void load();
    });
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [id, run?.status, load]);

  if (!id) return null;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/eval" className="underline">
          ← Runs
        </Link>
        <Link href="/eval/compare" className="underline">
          Compare
        </Link>
      </div>

      {error ? (
        <p className="mb-4 rounded border border-destructive/50 p-2 text-sm text-destructive">{error}</p>
      ) : null}

      {!run ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-semibold">Run</h1>
          <div className="mb-6 grid gap-2 font-mono text-xs">
            <div>
              <span className="text-muted-foreground">id:</span> {run.id}
            </div>
            <div>
              <span className="text-muted-foreground">strategy / model:</span> {run.strategy} / {run.model}
            </div>
            <div>
              <span className="text-muted-foreground">status:</span> {run.status}
            </div>
            <div>
              <span className="text-muted-foreground">prompt_hash:</span> {run.promptHash}
            </div>
            <div>
              <span className="text-muted-foreground">overall:</span>{" "}
              {run.overallScore == null ? "—" : run.overallScore.toFixed(4)}
            </div>
            <div>
              <span className="text-muted-foreground">cost_usd:</span> {run.costUsd.toFixed(6)}
            </div>
            <div>
              <span className="text-muted-foreground">tokens in/out:</span> {run.inputTokens} / {run.outputTokens}
            </div>
            <div>
              <span className="text-muted-foreground">cache read / write:</span> {run.cacheReadTokens} /{" "}
              {run.cacheWriteTokens}
            </div>
            <div>
              <span className="text-muted-foreground">schema failures / hallucinations:</span>{" "}
              {run.schemaFailureCount} / {run.hallucinationCount}
            </div>
            {run.error ? (
              <div className="text-destructive">
                <span className="text-muted-foreground">error:</span> {run.error}
              </div>
            ) : null}
          </div>

          {run.perFieldScores ? (
            <section className="mb-8">
              <h2 className="mb-2 font-medium">Per-field (mean)</h2>
              <div className="grid max-w-xl grid-cols-2 gap-2 rounded border p-3 font-mono text-sm">
                {Object.entries(run.perFieldScores).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{k}</span>
                    <span>{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {live ? (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-medium">SSE (recent)</h2>
              <pre className="max-h-32 overflow-auto rounded border p-2 text-xs">{live.slice(-2000)}</pre>
            </section>
          ) : null}

          <h2 className="mb-2 font-medium">Cases</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="p-2">Transcript</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Overall</th>
                  <th className="p-2">Halluc.</th>
                  <th className="p-2">Schema OK</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="p-2">
                      <Link
                        href={`/eval/runs/${id}/cases/${c.transcriptId}`}
                        className="font-mono text-primary underline"
                      >
                        {c.transcriptId}
                      </Link>
                    </td>
                    <td className="p-2">{c.status}</td>
                    <td className="p-2">
                      {c.scores && typeof c.scores.overall === "number"
                        ? c.scores.overall.toFixed(3)
                        : "—"}
                    </td>
                    <td className="p-2">{c.hallucinationCount}</td>
                    <td className="p-2">{c.schemaValid ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
