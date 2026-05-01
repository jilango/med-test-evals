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
      "TASK: Extract structured clinical data from a doctor-patient transcript.",
      "",
      "GROUNDING RULES:",
      "- Use only information explicitly stated in the transcript.",
      "- If a value is not stated, set it to null (or use an empty array).",
      "- Do not infer diagnoses from symptoms; only include diagnoses explicitly stated.",
      "- Do not invent medications, vitals, diagnoses, plan items, or follow-up.",
      "",
      "NORMALIZATION:",
      "- For BP, use the format \"S/D\" in mmHg (e.g., \"128/82\").",
      "- Keep medication names as spoken; do not expand to brand/generic unless stated.",
      "",
      "CONFLICTS:",
      "- If multiple values are stated for the same field, use the most recent value. If unclear, use null.",
      "",
      "OUTPUT CONTRACT:",
      "- Call the tool exactly once with JSON that conforms to the provided schema.",
    ].join("\n"),
  },
  few_shot: {
    name: "few_shot",
    cache_ttl: "1h",
    system: [
      "TASK: Extract structured clinical data from a doctor-patient transcript.",
      "",
      "FOLLOW THE EXAMPLES:",
      "- Match the example style for what to include vs. set to null.",
      "- Normalize common medication frequency variants (e.g., BID = twice daily, once daily = daily).",
      "",
      "OUTPUT CONTRACT:",
      "- Call the tool exactly once with JSON that conforms to the provided schema.",
    ].join("\n"),
    examples: [
      {
        transcript:
          "Doctor: What brings you in today?\nPatient: My throat is really sore and I've had a cough for two days.\nDoctor: Any fever?\nPatient: No fever.\nDoctor: We'll do supportive care. You can take ibuprofen as needed for pain. Follow up in a week if you're not improving.",
        extraction_json: {
          chief_complaint: "Sore throat and cough for two days",
          vitals: { bp: null, hr: null, temp_f: null, spo2: null },
          medications: [
            { name: "ibuprofen", dose: null, frequency: "as needed", route: "PO" },
          ],
          diagnoses: [],
          plan: ["Supportive care"],
          follow_up: { interval_days: 7, reason: "If not improving" },
        },
      },
      {
        transcript:
          "Doctor: Your blood pressure today is 142/88 and heart rate is 92.\nPatient: I'm taking metformin 500 mg twice a day and lisinopril 10 mg daily.\nDoctor: Great. Continue those. We'll recheck labs. Come back in 3 months for diabetes follow-up.",
        extraction_json: {
          chief_complaint: "Follow-up visit",
          vitals: { bp: "142/88", hr: 92, temp_f: null, spo2: null },
          medications: [
            { name: "metformin", dose: "500 mg", frequency: "twice daily", route: "PO" },
            { name: "lisinopril", dose: "10 mg", frequency: "daily", route: "PO" },
          ],
          diagnoses: [{ description: "Diabetes" }],
          plan: ["Continue current medications", "Recheck labs"],
          follow_up: { interval_days: 90, reason: "Diabetes follow-up" },
        },
      },
      {
        transcript:
          "Patient: I've been wheezing on and off this week.\nDoctor: Do you have asthma?\nPatient: Not that I know of.\nDoctor: Let's try an albuterol inhaler, 2 puffs every 4 hours as needed. Oxygen saturation is 98.\nDoctor: Follow up in 2 days if worse.",
        extraction_json: {
          chief_complaint: "Intermittent wheezing this week",
          vitals: { bp: null, hr: null, temp_f: null, spo2: 98 },
          medications: [
            {
              name: "albuterol",
              dose: "2 puffs",
              frequency: "every 4 hours as needed",
              route: "inhaled",
            },
          ],
          diagnoses: [],
          plan: ["Start albuterol inhaler"],
          follow_up: { interval_days: 2, reason: "If worse" },
        },
      },
    ],
  },
  cot: {
    name: "cot",
    cache_ttl: "1h",
    system: [
      "TASK: Extract structured clinical data from a doctor-patient transcript.",
      "",
      "INTERNAL PROCESS (do not reveal):",
      "- Think step-by-step to ensure completeness and grounding, but do not output reasoning.",
      "- Do a final grounding audit: every non-null value must be supported by explicit text in the transcript.",
      "",
      "OUTPUT CONTRACT:",
      "- Call the tool exactly once with JSON that conforms to the provided schema.",
    ].join("\n"),
    instruction_addendum:
      "Before calling the tool, do a grounding audit: every non-null value must be explicitly supported by the transcript. If not, set it to null / remove the item. If values conflict, use the most recent statement; if still unclear, use null. Do not infer diagnoses from symptoms; only include diagnoses explicitly stated.",
  },
};

