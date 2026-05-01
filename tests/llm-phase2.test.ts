import { describe, expect, it } from "bun:test";

import { computePromptHash, extractWithRetry } from "../packages/llm/src/extract";
import { extractionJsonSchema } from "../packages/llm/src/schema";

describe("phase2 prompt hash", () => {
  it("is stable for identical inputs", () => {
    const h1 = computePromptHash({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      system: "sys",
      schema: extractionJsonSchema,
      examples: [],
    });
    const h2 = computePromptHash({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      system: "sys",
      schema: extractionJsonSchema,
      examples: [],
    });
    expect(h1).toBe(h2);
  });

  it("changes when system prompt changes", () => {
    const h1 = computePromptHash({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      system: "sys",
      schema: extractionJsonSchema,
      examples: [],
    });
    const h2 = computePromptHash({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      system: "sys!",
      schema: extractionJsonSchema,
      examples: [],
    });
    expect(h1).not.toBe(h2);
  });
});

describe("phase2 retry loop", () => {
  it("retries when schema invalid then succeeds", async () => {
    let callCount = 0;
    const fakeClient = {
      async createMessage(_args: unknown) {
        callCount++;
        if (callCount === 1) {
          return {
            usage: { input_tokens: 10, output_tokens: 5 },
            content: [{ type: "tool_use", name: "submit_extraction", input: { nope: true } }],
          };
        }
        return {
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 50,
          },
          content: [
            {
              type: "tool_use",
              name: "submit_extraction",
              input: {
                chief_complaint: "cough",
                vitals: { bp: null, hr: null, temp_f: null, spo2: null },
                medications: [],
                diagnoses: [],
                plan: [],
                follow_up: { interval_days: null, reason: null },
              },
            },
          ],
        };
      },
    };

    const res = await extractWithRetry({
      client: fakeClient,
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      transcript: "Patient has a cough.",
      maxAttempts: 3,
    });

    expect(res.ok).toBeTrue();
    expect(callCount).toBe(2);
    if (res.ok) {
      expect(res.attempts.length).toBe(2);
      expect(res.attempts[0]?.schema_valid).toBeFalse();
      expect(res.attempts[1]?.schema_valid).toBeTrue();
      expect(res.attempts[1]?.token_usage?.cache_read_input_tokens).toBe(100);
    }
  });
});

