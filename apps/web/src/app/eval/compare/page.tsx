"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { apiJson } from "@/lib/api";

type RunA = {
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
  const sp = useSearchParams();
  const a = sp.get("a") ?? "";
  const b = sp.get("b") ?? "";
  const [runA, setRunA] = useState<RunA | null>(null);
  const [runB, setRunB] = useState<RunA | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!a || !b) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [da, db_] = await Promise.all([
          apiJson<{ run: RunA }>(`/api/v1/runs/${a}`),
          apiJson<{ run: RunA }>(`/api/v1/runs/${b}`),
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
      <p className="mb-6 text-sm text-muted-foreground">
        Use query params <code className="text-xs">?a=RUN_ID&amp;b=RUN_ID</code>. Higher score wins per field.
      </p>

      {!a || !b ? (
        <p className="text-sm text-muted-foreground">Add two run IDs in the URL to compare.</p>
      ) : null}

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
                  <td className="p-2 font-medium">{r.winner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : a && b && !error ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
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
