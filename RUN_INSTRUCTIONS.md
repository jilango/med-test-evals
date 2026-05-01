# Run Instructions

## What’s implemented

This repo now has an end-to-end eval harness for structured clinical extraction:

- **Dataset loader**: loads `data/transcripts/*.txt` + `data/gold/*.json` and validates gold.
- **Extractor** (`packages/llm` + server wrapper):
  - Structured output via **Anthropic tool-use** with the repo’s JSON Schema (`data/schema.json`).
  - **Retry-with-error-feedback** loop (max 3 attempts, configurable).
  - **Prompt caching hooks** via `cache_control` on stable prompt prefix blocks.
  - **Prompt hash** pinned to strategy + model + system + schema + examples.
  - Three strategies: `zero_shot`, `few_shot` (with examples), `cot` (private reasoning + grounding audit).
- **Evaluator**: per-field metrics + hallucination/grounding flags.
- **Runner**:
  - Concurrency limit (`EVAL_MAX_CONCURRENCY`, default 5).
  - Rate-limit backoff on 429 (exponential backoff + jitter).
  - Resumable runs (pending cases continue).
  - Extraction idempotency/caching keyed by `(strategy, model, transcript_id, prompt_hash)` persisted in DB.
  - SSE progress stream.
- **Dashboard** (`apps/web`):
  - Runs list + start run form with dataset filtering.
  - Run detail with SSE updates, per-field aggregates, and per-case drill-in.
  - Case detail with transcript, gold vs prediction JSON, hallucination flags, and attempt trace.
  - Compare screen with a clear “pick A / pick B” UI and per-field deltas.
- **CLI**:
  - `bun run eval -- --strategy=... --model=... [--ids=case_001,case_002] [--force=true]`
  - Prints a run summary to stdout and stores results in Postgres.

## How to run (local)

1. Install dependencies:

```bash
bun install
```

2. Start Postgres (example using Docker):

```bash
docker run -d --name healosbench-test-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=healosbench \
  -p 54329:5432 \
  postgres:16-alpine
```

3. Configure server env:

- Copy `apps/server/.env.example` → `apps/server/.env`
- Set:
  - `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/healosbench`
  - `ANTHROPIC_API_KEY=...`
  - `BETTER_AUTH_SECRET=...` (>= 32 chars)
  - `BETTER_AUTH_URL=http://localhost:3000`
  - `CORS_ORIGIN=http://localhost:3001`

4. Push schema:

```bash
bun run db:push
```

5. Run dev:

```bash
# terminal 1
bun run dev:server

# terminal 2
bun run dev:web
```

Open: `http://localhost:3001/eval`

## Concurrency + 429 behavior

- Runner processes cases with a simple fixed-size pool (default 5).
- The extractor wrapper retries on Anthropic 429:
  - exponential backoff starting at `EVAL_RATE_LIMIT_BASE_BACKOFF_MS` (default 1000ms)
  - caps at `EVAL_RATE_LIMIT_MAX_BACKOFF_MS` (default 30000ms)
  - adds small jitter

## What I observed (so far)

### Strategy behavior

- **`zero_shot`**: strong grounding rules, tends to be conservative (many null/empty fields match gold when transcript is silent).
- **`few_shot`**: includes a small set of examples to shape normalization + inclusion behavior (kept intentionally minimal for budget).
- **`cot`**: adds a private “grounding audit” instruction; output is still tool-only (no chain-of-thought persisted).

### Cost / caching notes

- One live Haiku call (1 transcript) completed schema-valid in 1 attempt with ~2–3k input tokens and a few hundred output tokens.
- Prompt caching is wired via `cache_control`, but **cache read/write tokens may be 0** if the cacheable prefix is below the provider’s threshold or if the request pattern doesn’t trigger caching. The dashboard/DB surfaces cache read/write token counts so it’s obvious when caching is actually working.

## Results (what exists in this repo right now)

The harness is ready for a full 50-case × 3-strategy run, but the repo currently includes:

- **1-case CLI run output** (example):
  - `bun run eval -- --strategy=zero_shot --ids=case_001 --force=true`
  - prints per-field aggregates, cost, tokens, and stores run/case rows in DB
- **Live integration test** (1 case × 3 strategies) behind `RUN_ANTHROPIC_INTEGRATION=1`:
  - verifies dataset → extract → evaluate → persist → query works for `zero_shot`, `few_shot`, `cot`

To produce the submission-style “full results table”, run:

```bash
bun run eval -- --strategy=zero_shot --model=claude-haiku-4-5-20251001
bun run eval -- --strategy=few_shot --model=claude-haiku-4-5-20251001
bun run eval -- --strategy=cot --model=claude-haiku-4-5-20251001
```

Then compare in `/eval/compare` by selecting runs A/B.

## Test coverage

There are unit + integration tests that cover the required failure modes:

- prompt hash stability
- schema-validation retry path (mocked)
- fuzzy medication normalization and set-F1 correctness
- hallucination detector positive/negative
- resumability (pending cases continue)
- idempotency/extraction cache reuse
- rate-limit backoff behavior (mocked 429)
- DB migration contains required columns
- optional live Anthropic integration run for all 3 strategies (gated)

## What I’d build next (if more time)

- Make caching verification explicit (e.g., a “cache warmed” indicator and a dedicated “repeat run” helper).
- Improve grounding highlights in the case UI (show exactly which substrings supported each field).
- Replace placeholder cost estimation with current Anthropic pricing and include a configurable cost cap guardrail.
- Add a prompt diff view between prompt hashes (stretch goal).

