import { describe, expect, it } from "bun:test";

import type { ClinicalExtraction } from "@test-evals/shared";

import { detectHallucinations, evaluateCase } from "../apps/server/src/services/evaluate.service";

function baseExtraction(): ClinicalExtraction {
  return {
    chief_complaint: "cough",
    vitals: { bp: null, hr: null, temp_f: null, spo2: null },
    medications: [],
    diagnoses: [],
    plan: [],
    follow_up: { interval_days: null, reason: null },
  };
}

describe("phase3 set-F1 + med normalization", () => {
  it("meds F1 is 1 when names fuzzy match and dose/freq normalize equal", () => {
    const gold: ClinicalExtraction = {
      ...baseExtraction(),
      medications: [
        { name: "Metformin", dose: "500 mg", frequency: "BID", route: "PO" },
      ],
    };
    const pred: ClinicalExtraction = {
      ...baseExtraction(),
      medications: [
        { name: "metformin", dose: "500mg", frequency: "twice daily", route: "oral" },
      ],
    };

    const res = evaluateCase({ transcript: "Start metformin 500 mg twice daily by mouth.", prediction: pred, gold });
    expect(res.scores.medications_f1).toBe(1);
    expect(res.scores.medications_precision).toBe(1);
    expect(res.scores.medications_recall).toBe(1);
  });

  it("plan set-F1 behaves as expected on tiny case", () => {
    const gold: ClinicalExtraction = { ...baseExtraction(), plan: ["start ibuprofen", "follow up in 7 days"] };
    const pred: ClinicalExtraction = { ...baseExtraction(), plan: ["start ibuprofen"] };
    const res = evaluateCase({ transcript: "Plan: start ibuprofen.", prediction: pred, gold });
    expect(res.scores.plan_precision).toBe(1);
    expect(res.scores.plan_recall).toBe(0.5);
    expect(res.scores.plan_f1).toBeCloseTo((2 * 1 * 0.5) / (1 + 0.5), 6);
  });
});

describe("phase3 hallucination detection", () => {
  it("flags ungrounded values", () => {
    const pred: ClinicalExtraction = {
      ...baseExtraction(),
      vitals: { bp: "180/120", hr: null, temp_f: null, spo2: null },
      diagnoses: [{ description: "pneumonia" }],
    };
    const h = detectHallucinations({
      transcript: "Vitals today are normal. No diagnosis given.",
      prediction: pred,
    });
    expect(h.count).toBeGreaterThan(0);
    expect(h.fields["vitals.bp"]).toBeTrue();
    expect(h.fields["diagnoses[0].description"]).toBeTrue();
  });

  it("does not flag grounded values", () => {
    const pred: ClinicalExtraction = {
      ...baseExtraction(),
      vitals: { bp: "128/82", hr: 72, temp_f: 98.6, spo2: 98 },
      follow_up: { interval_days: 7, reason: "recheck symptoms" },
    };
    const h = detectHallucinations({
      transcript:
        "Chief complaint is cough. BP 128/82 HR 72 Temp 98.6 SpO2 98. Follow up in 7 days to recheck symptoms.",
      prediction: pred,
    });
    expect(h.count).toBe(0);
  });
});

