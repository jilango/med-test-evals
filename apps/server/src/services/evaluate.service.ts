import type { ClinicalExtraction } from "@test-evals/shared";

import {
  clamp01,
  diagnosisScore,
  f1,
  fuzzyScore,
  greedySetMatch,
  isGroundedValue,
  medicationsMatch,
  normalizeDose,
  normalizeFrequency,
  normalizeRoute,
} from "./evaluate.utils";

export type PerFieldScores = {
  chief_complaint: number;
  vitals: number;
  medications_precision: number;
  medications_recall: number;
  medications_f1: number;
  diagnoses_precision: number;
  diagnoses_recall: number;
  diagnoses_f1: number;
  plan_precision: number;
  plan_recall: number;
  plan_f1: number;
  follow_up: number;
  overall: number;
};

export type HallucinationReport = {
  count: number;
  fields: Record<string, boolean>;
};

export type CaseEvaluation = {
  scores: PerFieldScores;
  hallucinations: HallucinationReport;
};

function eqNullable<T>(a: T | null | undefined, b: T | null | undefined) {
  return a === b;
}

function vitalsScore(
  pred: ClinicalExtraction["vitals"],
  gold: ClinicalExtraction["vitals"],
) {
  const bp = eqNullable(pred.bp, gold.bp) ? 1 : 0;
  const hr = eqNullable(pred.hr, gold.hr) ? 1 : 0;
  const spo2 = eqNullable(pred.spo2, gold.spo2) ? 1 : 0;
  const temp =
    pred.temp_f === null || pred.temp_f === undefined
      ? gold.temp_f === null
        ? 1
        : 0
      : gold.temp_f === null || gold.temp_f === undefined
        ? 0
        : Math.abs(pred.temp_f - gold.temp_f) <= 0.2
          ? 1
          : 0;

  return (bp + hr + temp + spo2) / 4;
}

function medicationsScores(
  pred: ClinicalExtraction["medications"],
  gold: ClinicalExtraction["medications"],
) {
  let tp = 0;
  const usedPred = new Set<number>();

  for (let i = 0; i < gold.length; i++) {
    let found = -1;
    for (let j = 0; j < pred.length; j++) {
      if (usedPred.has(j)) continue;
      if (medicationsMatch(gold[i]!, pred[j]!)) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      usedPred.add(found);
      tp++;
    }
  }

  const precision = pred.length === 0 ? (gold.length === 0 ? 1 : 0) : tp / pred.length;
  const recall = gold.length === 0 ? 1 : tp / gold.length;
  return { precision, recall, f1: f1(precision, recall) };
}

function diagnosesScores(
  pred: ClinicalExtraction["diagnoses"],
  gold: ClinicalExtraction["diagnoses"],
) {
  const { matches } = greedySetMatch(gold, pred, diagnosisScore, 0.8);
  const precision = pred.length === 0 ? (gold.length === 0 ? 1 : 0) : matches / pred.length;
  const recall = gold.length === 0 ? 1 : matches / gold.length;
  let base = f1(precision, recall);

  // Bonus: among matched description pairs, credit ICD-10 agreement (simple, bounded).
  // We recompute matched pairs greedily and count ICD matches.
  let icdCorrect = 0;
  const usedPred = new Set<number>();
  for (const g of gold) {
    let bestJ = -1;
    let bestScore = -1;
    for (let j = 0; j < pred.length; j++) {
      if (usedPred.has(j)) continue;
      const s = diagnosisScore(g, pred[j]!);
      if (s > bestScore) {
        bestScore = s;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestScore >= 0.8) {
      usedPred.add(bestJ);
      const p = pred[bestJ]!;
      if (g.icd10 && p.icd10 && g.icd10 === p.icd10) icdCorrect++;
    }
  }

  if (gold.length > 0 && icdCorrect > 0) {
    base = clamp01(base + 0.05 * (icdCorrect / gold.length));
  }

  return { precision, recall, f1: base };
}

function planScores(pred: string[], gold: string[]) {
  const matchScore = (g: string, p: string) => fuzzyScore(g, p);
  const { matches } = greedySetMatch(gold, pred, matchScore, 0.8);
  const precision = pred.length === 0 ? (gold.length === 0 ? 1 : 0) : matches / pred.length;
  const recall = gold.length === 0 ? 1 : matches / gold.length;
  return { precision, recall, f1: f1(precision, recall) };
}

function followUpScore(
  pred: ClinicalExtraction["follow_up"],
  gold: ClinicalExtraction["follow_up"],
) {
  const interval = eqNullable(pred.interval_days, gold.interval_days) ? 1 : 0;
  const reason = fuzzyScore(pred.reason ?? "", gold.reason ?? "");
  return (interval + reason) / 2;
}

export function evaluateCase(args: {
  transcript: string;
  prediction: ClinicalExtraction;
  gold: ClinicalExtraction;
}) : CaseEvaluation {
  const chief = fuzzyScore(args.prediction.chief_complaint, args.gold.chief_complaint);
  const vitals = vitalsScore(args.prediction.vitals, args.gold.vitals);
  const meds = medicationsScores(args.prediction.medications, args.gold.medications);
  const diags = diagnosesScores(args.prediction.diagnoses, args.gold.diagnoses);
  const plan = planScores(args.prediction.plan, args.gold.plan);
  const follow = followUpScore(args.prediction.follow_up, args.gold.follow_up);

  const overall =
    (chief + vitals + meds.f1 + diags.f1 + plan.f1 + follow) / 6;

  const hallu = detectHallucinations({
    transcript: args.transcript,
    prediction: args.prediction,
  });

  return {
    scores: {
      chief_complaint: chief,
      vitals,
      medications_precision: meds.precision,
      medications_recall: meds.recall,
      medications_f1: meds.f1,
      diagnoses_precision: diags.precision,
      diagnoses_recall: diags.recall,
      diagnoses_f1: diags.f1,
      plan_precision: plan.precision,
      plan_recall: plan.recall,
      plan_f1: plan.f1,
      follow_up: follow,
      overall,
    },
    hallucinations: hallu,
  };
}

export function detectHallucinations(args: {
  transcript: string;
  prediction: ClinicalExtraction;
}) : HallucinationReport {
  const fields: Record<string, boolean> = {};

  const setField = (path: string, grounded: boolean) => {
    fields[path] = !grounded;
  };

  setField(
    "chief_complaint",
    isGroundedValue(args.prediction.chief_complaint, args.transcript),
  );

  setField("vitals.bp", isGroundedValue(args.prediction.vitals.bp, args.transcript));
  setField("vitals.hr", isGroundedValue(args.prediction.vitals.hr, args.transcript));
  setField(
    "vitals.temp_f",
    isGroundedValue(args.prediction.vitals.temp_f, args.transcript),
  );
  setField(
    "vitals.spo2",
    isGroundedValue(args.prediction.vitals.spo2, args.transcript),
  );

  args.prediction.medications.forEach((m, i) => {
    setField(`medications[${i}].name`, isGroundedValue(m.name, args.transcript));
    setField(`medications[${i}].dose`, isGroundedValue(normalizeDose(m.dose), args.transcript));
    setField(
      `medications[${i}].frequency`,
      isGroundedValue(normalizeFrequency(m.frequency), args.transcript),
    );
    setField(
      `medications[${i}].route`,
      isGroundedValue(normalizeRoute(m.route), args.transcript),
    );
  });

  args.prediction.diagnoses.forEach((d, i) => {
    setField(`diagnoses[${i}].description`, isGroundedValue(d.description, args.transcript));
    if (d.icd10) setField(`diagnoses[${i}].icd10`, isGroundedValue(d.icd10, args.transcript));
  });

  args.prediction.plan.forEach((p, i) => {
    setField(`plan[${i}]`, isGroundedValue(p, args.transcript));
  });

  setField(
    "follow_up.interval_days",
    isGroundedValue(args.prediction.follow_up.interval_days, args.transcript),
  );
  if (args.prediction.follow_up.reason) {
    setField(
      "follow_up.reason",
      isGroundedValue(args.prediction.follow_up.reason, args.transcript),
    );
  } else {
    fields["follow_up.reason"] = false;
  }

  const count = Object.values(fields).filter(Boolean).length;
  return { count, fields };
}

