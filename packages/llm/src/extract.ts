import type { Strategy, TokenUsage } from "@test-evals/shared";
import { sha256Hex } from "@test-evals/shared";

import { extractionJsonSchema, formatAjvErrors, validateExtraction } from "./schema";
import { strategies } from "./strategies";
import type { AnthropicMessageClient, ExtractAttempt, ExtractResult } from "./types";

type CacheControl = { type: "ephemeral"; ttl?: "5m" | "1h" };

function usageFromAnthropic(resp: any): TokenUsage | undefined {
  const u = resp?.usage;
  if (!u) return undefined;
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? u.cache_read_tokens ?? 0,
    cache_write_input_tokens:
      u.cache_creation_input_tokens ?? u.cache_write_input_tokens ?? 0,
  };
}

function toolInputFromResponse(resp: any): unknown | undefined {
  const content = resp?.content;
  if (!Array.isArray(content)) return undefined;
  const toolUse = content.find((c) => c?.type === "tool_use");
  return toolUse?.input;
}

export function computePromptHash(args: {
  strategy: Strategy;
  model: string;
  system: string;
  schema: unknown;
  examples: unknown[];
}) {
  return sha256Hex(
    JSON.stringify({
      strategy: args.strategy,
      model: args.model,
      system: args.system,
      schema: args.schema,
      examples: args.examples,
    }),
  );
}

export function computePromptHashForStrategy(strategy: Strategy, model: string) {
  const strat = strategies[strategy];
  const examples = strat.examples ?? [];
  return computePromptHash({
    strategy,
    model,
    system: strat.system,
    schema: extractionJsonSchema,
    examples,
  });
}

export async function extractWithRetry(args: {
  client: AnthropicMessageClient;
  strategy: Strategy;
  model: string;
  transcript: string;
  maxAttempts: number;
}) : Promise<ExtractResult> {
  const strat = strategies[args.strategy];
  const examples = strat.examples ?? [];
  const promptHash = computePromptHash({
    strategy: args.strategy,
    model: args.model,
    system: strat.system,
    schema: extractionJsonSchema,
    examples,
  });

  const cached: CacheControl = { type: "ephemeral", ttl: strat.cache_ttl };

  const exampleText =
    examples.length > 0
      ? [
          "",
          "FEW-SHOT EXAMPLES (follow the pattern; output must still conform to schema):",
          ...examples.flatMap((ex, idx) => [
            "",
            `Example ${idx + 1} transcript:`,
            ex.transcript,
            "",
            `Example ${idx + 1} extraction_json:`,
            JSON.stringify(ex.extraction_json),
          ]),
        ].join("\n")
      : "";

  const baseSystem = [
    strat.system,
    "",
    "JSON Schema (for reference):",
    JSON.stringify(extractionJsonSchema),
    exampleText,
  ].join("\n");

  const tools = [
    {
      name: "submit_extraction",
      description: "Submit the clinical extraction JSON.",
      input_schema: extractionJsonSchema,
    },
  ];

  const attempts: ExtractAttempt[] = [];
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    const messages: any[] = [];

    const userTextParts: string[] = [];
    userTextParts.push(`Transcript:\n${args.transcript}`);
    if (attempt > 1 && lastErrors.length) {
      userTextParts.push("");
      userTextParts.push("Your previous tool output did not validate against the JSON Schema.");
      userTextParts.push("Fix ONLY the invalid parts and call the tool again.");
      userTextParts.push("Validation errors:");
      userTextParts.push(lastErrors.map((e) => `- ${e}`).join("\n"));
    }
    if (strat.instruction_addendum) {
      userTextParts.push("");
      userTextParts.push(strat.instruction_addendum);
    }

    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: userTextParts.join("\n"),
        },
      ],
    });

    const resp: any = await args.client.createMessage({
      model: args.model,
      max_tokens: 800,
      system: [{ type: "text", text: baseSystem, cache_control: cached }],
      messages,
      tools,
      tool_choice: { type: "tool", name: "submit_extraction" },
    });

    const extraction = toolInputFromResponse(resp);
    const ok = validateExtraction(extraction) as boolean;
    const token_usage = usageFromAnthropic(resp);

    if (ok) {
      attempts.push({ attempt, schema_valid: true, token_usage });
      return { ok: true, prompt_hash: promptHash, extraction, attempts };
    }

    lastErrors = formatAjvErrors(validateExtraction.errors);
    attempts.push({
      attempt,
      schema_valid: false,
      schema_errors: lastErrors,
      token_usage,
    });
  }

  return {
    ok: false,
    prompt_hash: promptHash,
    error: `Failed to produce schema-valid output after ${args.maxAttempts} attempts.`,
    attempts,
  };
}

