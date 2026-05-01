"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiJson } from "@/lib/api";

type RunSummary = {
  id: string;
  status: string;
  strategy: string;
  model: string;
  createdAt: string;
  overallScore: number | null;
  costUsd: number;
  caseCountCompleted: number;
  caseCountTotal: number;
};

type RunDetail = {
  id: string;
  strategy: string;
  model: string;
  overallScore: number | null;
  perFieldScores: Record<string, number> | null;
};

const FIELD_LABELS: { key: string; label: string }[] = [
  { key: "chief_complaint", label: "Chief complaint" },
  { key: "vitals", label: "Vitals" },
  { key: "medications_f1", label: "Medications F1" },
  { key: "diagnoses_f1", label: "Diagnoses F1" },
  { key: "plan_f1", label: "Plan F1" },
  { key: "follow_up", label: "Follow-up" },
];

function CompareContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const a = sp.get("a") ?? "";
  const b = sp.get("b") ?? "";
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedA, setSelectedA] = useState(a);
  const [selectedB, setSelectedB] = useState(b);
  const [runA, setRunA] = useState<RunDetail | null>(null);
  const [runB, setRunB] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const data = await apiJson<{ runs: RunSummary[] }>("/api/v1/runs");
      setRuns(data.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    setSelectedA(a);
    setSelectedB(b);
  }, [a, b]);

  useEffect(() => {
    if (!a || !b) {
      setRunA(null);
      setRunB(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [da, db_] = await Promise.all([
          apiJson<{ run: RunDetail }>(`/api/v1/runs/${a}`),
          apiJson<{ run: RunDetail }>(`/api/v1/runs/${b}`),
        ]);
        if (!cancelled) {
          setRunA(da.run);
          setRunB(db_.run);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [a, b]);

  const rows = useMemo(() => {
    if (!runA || !runB) return [];
    const out: {
      label: string;
      va: number | null;
      vb: number | null;
      delta: number | null;
      winner: "A" | "B" | "tie";
    }[] = [];

    const overallA = runA.overallScore;
    const overallB = runB.overallScore;
    if (overallA != null || overallB != null) {
      const va = overallA ?? null;
      const vb = overallB ?? null;
      const delta = va != null && vb != null ? vb - va : null;
      let winner: "A" | "B" | "tie" = "tie";
      if (delta != null && delta > 1e-6) winner = "B";
      else if (delta != null && delta < -1e-6) winner = "A";
      out.push({ label: "Overall (mean)", va, vb, delta, winner });
    }

    for (const { key, label } of FIELD_LABELS) {
      const va = runA.perFieldScores?.[key] ?? null;
      const vb = runB.perFieldScores?.[key] ?? null;
      const delta = va != null && vb != null ? vb - va : null;
      let winner: "A" | "B" | "tie" = "tie";
      if (delta != null && delta > 1e-6) winner = "B";
      else if (delta != null && delta < -1e-6) winner = "A";
      out.push({ label, va, vb, delta, winner });
    }
    return out;
  }, [runA, runB]);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex gap-4 text-sm">
        <Link href="/eval" className="underline">
          ← Runs
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-semibold">Compare runs</h1>
      <p className="mb-6 text-sm text-muted-foreground">Pick two completed runs to compare per-field deltas.</p>

      <section className="mb-6 grid gap-3 rounded-lg border p-4">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Run A (baseline)
            <select
              value={selectedA}
              onChange={(e) => setSelectedA(e.target.value)}
              className="rounded border bg-background px-2 py-1"
            >
              <option value="">Select a run…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id.slice(0, 8)}… · {r.strategy} · {r.model} · {r.status} · {r.overallScore == null ? "—" : r.overallScore.toFixed(3)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Run B (candidate)
            <select
              value={selectedB}
              onChange={(e) => setSelectedB(e.target.value)}
              className="rounded border bg-background px-2 py-1"
            >
              <option value="">Select a run…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id.slice(0, 8)}… · {r.strategy} · {r.model} · {r.status} · {r.overallScore == null ? "—" : r.overallScore.toFixed(3)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!selectedA || !selectedB}
            onClick={() => {
              const qs = new URLSearchParams();
              qs.set("a", selectedA);
              qs.set("b", selectedB);
              router.push(`/eval/compare?${qs.toString()}`);
            }}
          >
            Compare
          </button>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => void loadRuns()}
          >
            Refresh runs
          </button>
          {selectedA && selectedB ? (
            <button
              type="button"
              className="text-sm underline"
              onClick={() => {
                setSelectedA(selectedB);
                setSelectedB(selectedA);
              }}
            >
              Swap
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className="mb-4 rounded border border-destructive/50 p-2 text-sm text-destructive">{error}</p>
      ) : null}

      {runA && runB ? (
        <div className="mb-6 grid gap-2 text-sm">
          <div>
            <span className="font-medium">A:</span>{" "}
            <Link href={`/eval/runs/${runA.id}`} className="font-mono text-primary underline">
              {runA.id}
            </Link>{" "}
            ({runA.strategy}, {runA.model})
          </div>
          <div>
            <span className="font-medium">B:</span>{" "}
            <Link href={`/eval/runs/${runB.id}`} className="font-mono text-primary underline">
              {runB.id}
            </Link>{" "}
            ({runB.strategy}, {runB.model})
          </div>
        </div>
      ) : null}

      {runA && runB ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-2">Field</th>
                <th className="p-2">Run A</th>
                <th className="p-2">Run B</th>
                <th className="p-2">Δ (B−A)</th>
                <th className="p-2">Winner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-border/60">
                  <td className="p-2">{r.label}</td>
                  <td className="p-2 font-mono">{r.va == null ? "—" : r.va.toFixed(4)}</td>
                  <td className="p-2 font-mono">{r.vb == null ? "—" : r.vb.toFixed(4)}</td>
                  <td className="p-2 font-mono">{r.delta == null ? "—" : r.delta.toFixed(4)}</td>
                  <td
                    className={
                      r.winner === "A"
                        ? "p-2 font-medium text-amber-600 dark:text-amber-400"
                        : r.winner === "B"
                          ? "p-2 font-medium text-emerald-700 dark:text-emerald-400"
                          : "p-2 font-medium text-muted-foreground"
                    }
                  >
                    {r.winner}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : a && b && !error ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <p className="text-sm text-muted-foreground">Select two runs above to compare.</p>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<p className="container px-4 py-6 text-sm">Loading…</p>}>
      <CompareContent />
    </Suspense>
  );
}
