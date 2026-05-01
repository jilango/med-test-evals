import "./load-env";

import { describe, expect, it } from "bun:test";

import { createExtractTranscript, isRateLimitError } from "../apps/server/src/services/extract.service";

describe("phase8 rate-limit backoff", () => {
  it("detects 429 rate limit errors", () => {
    expect(isRateLimitError({ status: 429 })).toBeTrue();
  });

  it("retries on 429 with exponential backoff (no real sleep)", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };

    let calls = 0;
    const extract = async () => {
      calls++;
      if (calls <= 2) {
        const err: any = new Error("rate limited");
        err.status = 429;
        throw err;
      }
      return {
        ok: true,
        prompt_hash: "x",
        extraction: {
          chief_complaint: "cough",
          vitals: { bp: null, hr: null, temp_f: null, spo2: null },
          medications: [],
          diagnoses: [],
          plan: [],
          follow_up: { interval_days: null, reason: null },
        },
        attempts: [{ attempt: 1, schema_valid: true }],
      };
    };

    const prevRand = Math.random;
    Math.random = () => 0; // remove jitter for deterministic expectations
    try {
      const extractTranscript = createExtractTranscript({ sleep, extract: extract as any });
      const res = await extractTranscript({
        transcript: "Patient has cough.",
        strategy: "zero_shot",
        model: "claude-haiku-4-5-20251001",
      });
      expect(res.ok).toBeTrue();
      expect(calls).toBe(3);
      expect(sleeps.length).toBe(2);
      // base backoff (default 1000ms) then doubled (2000ms)
      expect(sleeps[0]).toBe(1000);
      expect(sleeps[1]).toBe(2000);
    } finally {
      Math.random = prevRand;
    }
  });
});

