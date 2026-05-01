"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiBase, apiJson } from "@/lib/api";

type RunRow = {
  id: string;
  status: string;
  strategy: string;
  model: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  overallScore: number | null;
  costUsd: number;
  caseCountCompleted: number;
  caseCountTotal: number;
  inputTokens: number;
  cacheReadTokens: number;
};

export default function EvalRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiJson<{ runs: RunRow[] }>("/api/v1/runs");
      setRuns(data.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onStartRun(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const strategy = String(fd.get("strategy") ?? "zero_shot");
    const model = String(fd.get("model") ?? "").trim() || "claude-haiku-4-5-20251001";
    const idsRaw = String(fd.get("ids") ?? "").trim();
    const force = fd.get("force") === "on";
    const body: Record<string, unknown> = { strategy, model, force };
    if (idsRaw.length) {
      body.dataset_filter = {
        ids: idsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    }
    try {
      const res = await apiJson<{ run_id: string }>("/api/v1/runs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      router.push(`/eval/runs/${res.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function durationMs(r: RunRow) {
    if (!r.startedAt || !r.endedAt) return null;
    return new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-2 text-2xl font-semibold">Eval runs</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        API: <code className="text-xs">{apiBase()}</code>
      </p>

      <section className="mb-10 rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Start a run</h2>
        <form onSubmit={onStartRun} className="grid max-w-xl gap-3">
          <label className="grid gap-1 text-sm">
            Strategy
            <select name="strategy" className="rounded border bg-background px-2 py-1" required>
              <option value="zero_shot">zero_shot</option>
              <option value="few_shot">few_shot</option>
              <option value="cot">cot</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Model
            <input
              name="model"
              defaultValue="claude-haiku-4-5-20251001"
              className="rounded border bg-background px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Transcript IDs (optional, comma-separated; empty = full dataset)
            <input
              name="ids"
              placeholder="case_001, case_002"
              className="rounded border bg-background px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="force" />
            Force (bypass extraction cache)
          </label>
          <button type="submit" className="w-fit rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Start run
          </button>
        </form>
      </section>

      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-medium">All runs</h2>
        <div className="flex gap-2">
          <Link href="/eval/compare" className="text-sm underline">
            Compare two runs
          </Link>
          <button type="button" onClick={() => void load()} className="text-sm underline">
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-2">Created</th>
                <th className="p-2">Strategy</th>
                <th className="p-2">Model</th>
                <th className="p-2">Status</th>
                <th className="p-2">Cases</th>
                <th className="p-2">Overall</th>
                <th className="p-2">Cost (USD)</th>
                <th className="p-2">Duration</th>
                <th className="p-2">Cache read tok</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="p-2 font-mono text-xs">
                    <Link href={`/eval/runs/${r.id}`} className="text-primary underline">
                      {new Date(r.createdAt).toLocaleString()}
                    </Link>
                  </td>
                  <td className="p-2">{r.strategy}</td>
                  <td className="p-2 font-mono text-xs">{r.model}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">
                    {r.caseCountCompleted}/{r.caseCountTotal}
                  </td>
                  <td className="p-2">
                    {r.overallScore == null ? "—" : r.overallScore.toFixed(3)}
                  </td>
                  <td className="p-2">{r.costUsd.toFixed(4)}</td>
                  <td className="p-2">
                    {durationMs(r) == null ? "—" : `${(durationMs(r)! / 1000).toFixed(1)}s`}
                  </td>
                  <td className="p-2">{r.cacheReadTokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No runs yet.</p> : null}
        </div>
      )}
    </div>
  );
}
