# NOTES

## Eval methodology taste

### Field-level metrics (right metric for the right field)

- **`chief_complaint`**: fuzzy token-set similarity score in \([0,1]\).
- **`vitals.*`**: exact match per sub-field, with numeric tolerance for `temp_f` (±0.2), then averaged.
- **`medications`**: set-based precision/recall/F1, where two meds match if:
  - name is fuzzy-matched, and
  - dose + frequency match after normalization (e.g., `500 mg` == `500mg`, `BID` == `twice daily`).
- **`diagnoses`**: set-F1 by fuzzy match on description, with a small bonus if ICD-10 matches.
- **`plan`**: set-based F1 on plan items (fuzzy-matched).
- **`follow_up`**: exact match on `interval_days`, fuzzy on `reason`.

### Failure mode reporting (honest failure modes)

- **Schema invalid**:
  - Extractor uses tool-use + JSON Schema validation and retries up to 3 times.
  - If still invalid, the case is marked failed and `schema_failure_count` increments.
- **Hallucinated / ungrounded values**:
  - A simple grounding check flags predicted values that do not appear (after normalization) in the transcript.
  - Stored per-case as `hallucination_count` and `hallucination_report.fields[path]=true` for drill-in.

### Compare view usefulness

- Compare screen supports selecting two runs (A baseline / B candidate) and shows:
  - overall delta and per-field deltas (Δ = B−A)
  - a per-field winner indicator (A / B / tie)

## Prompt engineering judgement

### The three strategies:

- **`zero_shot`**: strong, explicit grounding + conflict rules; no examples.
- **`few_shot`**: includes a small set of curated examples to shape inclusion/normalization behavior (cached prefix).
- **`cot`**: instructs a private “grounding audit” step before tool-call; still outputs tool-use only (no chain-of-thought persisted).

### What I saw / why one wins (by field)

- **zero_shot**:
  - Best overall *vs few_shot*, and best on **diagnoses F1** in this run set (**0.6143**).
  - Slightly better than `cot` on **follow_up** (**0.5661** vs **0.5566**).
  - Lower **plan F1** than `cot` (**0.3465** vs **0.3902**).
- **few_shot**:
  - Underperformed on this dataset as implemented (lowest **overall**: **0.5410**).
  - Highest token/cost footprint (examples increase prompt length): **cost $0.254269**.
  - This suggests the examples are either not aligned with the dataset’s dominant failure modes, or the extra context is crowding out precision on free-text fields (plan) without enough payoff.
- **cot**:
  - Best **overall** (**0.5882**), best **medications F1** (**0.6047**) and best **plan F1** (**0.3902**).
  - Also lowest hallucination count among the three runs (see note below), consistent with “grounding audit” helping reduce unsupported fills.

## LLM plumbing fluency

- **Tool use / structured output**: enforced via tool-call with `input_schema` matching `data/schema.json` (no free-form JSON parsing path).
- **Retry with validation feedback**: schema errors are fed back to the model, capped (default 3).
- **Prompt caching**: stable prefix blocks are marked cacheable via `cache_control` and cache token stats are stored.
- **Concurrency control**: runner processes cases with a fixed-size pool (default 5).
- **Rate-limit backoff**: 429s retry with exponential backoff + jitter (bounded by env).
- **Idempotency**: per-case extraction cache persisted and keyed by `(strategy, model, transcript_id, prompt_hash)`.
- **Resumability**: runs persist per-case state; resume continues pending cases only (no double charging).

## Test signal

Tests target the things that actually break:

- **Validation failures**: schema-invalid then corrected retry path.
- **Fuzzy matching correctness**: medication normalization and set-F1 correctness.
- **Hallucination detection**: positive + negative grounding tests.
- **Rate limits**: mocked 429 backoff behavior without real sleeps.
- **Resumes**: pending-only continuation.
- **Idempotency**: cache reuse when `force=false`.

## Results table (fill in after a full 50-case run)

| Strategy | Overall | Chief complaint | Vitals | Meds F1 | Dx F1 | Plan F1 | Follow-up | Cost (USD) | Cache read tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| zero_shot | 0.5784 | 0.3850 | 0.9950 | 0.5634 | 0.6143 | 0.3465 | 0.5661 | 0.174140 | 0 |
| few_shot | 0.5410 | 0.3795 | 0.9950 | 0.5004 | 0.5400 | 0.2998 | 0.5313 | 0.254269 | 0 |
| cot | 0.5882 | 0.3924 | 0.9950 | 0.6047 | 0.5900 | 0.3902 | 0.5566 | 0.232056 | 0 |

## What surprised me

- **Caching didn’t activate**: The caching plumbing is implemented, but the cacheable prefix likely doesn’t meet Anthropic’s caching threshold (or needs a different breakpoint placement) since prompts vary and the same tests for the same prompt strategies were not run twice.
- **Few-shot regressed**: adding examples increased cost and did not improve scores; `few_shot` was worse than `zero_shot` and `cot` on overall and most fields.
- **Vitals are near-perfect across strategies** (~**0.9950**) which suggests the dataset either states vitals clearly or the “null when absent” behavior matches gold frequently.
- **Hallucination counts are high**: these are counts of flagged fields across all cases (not “cases hallucinated”). They’re still useful for relative comparisons:
  - `zero_shot`: 525
  - `few_shot`: 536
  - `cot`: 479

## What I’d build next

- **Make caching real**: adjust cache breakpoint placement and/or increase stable prefix length (e.g., move examples + schema into cached system prefix and ensure it exceeds threshold). Add a tiny “cache warm-up” and “repeat run” flow to verify `cache_read_input_tokens` increases.
- **Grounding UI**: highlight transcript spans that support each extracted value (and show ungrounded values inline), not just boolean flags.
- **Improve few-shot**: replace the current examples with a smaller set chosen from the dataset’s hardest cases (med normalization edge cases, multi-diagnosis, multi-med, plan granularity) and re-run.
- **Better cost accounting**: replace the placeholder pricing constants with current Anthropic pricing (input/output/cache) and add an optional cost cap guardrail.

## What I cut (and why)

- **Prompt diff UI**: not required for deciding between strategies; compare view + prompt hash already supports reproducibility.
- **Full auth flows**: did not implement web login/dashboard/home so the product focuses purely on the eval harness UI.

