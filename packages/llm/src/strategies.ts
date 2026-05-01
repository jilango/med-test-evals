import type { Strategy } from "@test-evals/shared";

export type PromptStrategy = {
  name: Strategy;
  system: string;
  examples?: { transcript: string; extraction_json: unknown }[];
  // Per Anthropic caching docs: mark stable prefix blocks cacheable.
  cache_ttl: "5m" | "1h";
  // Strategy-specific addendum (kept short to control token costs).
  instruction_addendum?: string;
};

// NOTE: few-shot examples should be short and cover normalization edge cases.
// Keep this minimal for the <$1 budget; caching will carry repeated runs.
export const strategies: Record<Strategy, PromptStrategy> = {
  zero_shot: {
    name: "zero_shot",
    cache_ttl: "1h",
    system: [
      "You extract structured clinical data from a transcript.",
      "Only include information supported by the transcript. If unknown, use null (or empty array).",
      "Do not invent medications, vitals, diagnoses, or follow-up.",
      "Return the result by calling the tool exactly once.",
    ].join("\n"),
  },
  few_shot: {
    name: "few_shot",
    cache_ttl: "1h",
    system: [
      "You extract structured clinical data from a transcript.",
      "Only include information supported by the transcript. If unknown, use null (or empty array).",
      "Normalize common medication frequency variants (e.g., BID = twice daily).",
      "Return the result by calling the tool exactly once.",
    ].join("\n"),
    // Examples intentionally left empty for now; Phase 2 focuses on plumbing.
    // We'll add 2–4 curated examples once we see common failure modes.
    examples: [],
  },
  cot: {
    name: "cot",
    cache_ttl: "1h",
    system: [
      "You extract structured clinical data from a transcript.",
      "Think step-by-step privately to ensure completeness and grounding, but do not output reasoning.",
      "Only include information supported by the transcript. If unknown, use null (or empty array).",
      "Return the result by calling the tool exactly once.",
    ].join("\n"),
    instruction_addendum:
      "Before calling the tool, double-check each value has explicit support in the transcript. If not, set it to null / omit the item.",
  },
};

