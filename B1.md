# B1: Agent Core — Data Extraction

## Overview

B1 is the first implementation phase of the entire project. Its scope is deliberately narrow: **extract structured quote data from supplier email text using LLM calls**. No database, no email integration, no policy evaluation, no counter-offer generation — just a reliable extraction pipeline with a provider-agnostic LLM service.

The remaining agent stages (policy evaluation, decision engine, counter-offer generation) originally planned for B1 in `PLAN_IMPLEMENTATION.md` are deferred to **B1.5** (a follow-up phase).

### What B1 Delivers

1. **Project foundation** — Next.js initialized, TypeScript configured, testing frameworks installed
2. **LLM Service** — Provider-agnostic abstraction (Claude primary, OpenAI fallback, auto-retry)
3. **Data extraction pipeline** — Supplier email text → structured JSON (quotedPrice, quotedPriceCurrency, quotedPriceUsd, availableQuantity, MOQ, leadTimeDays, paymentTerms, validityPeriod) matching the spec's `ExtractedQuote` model
4. **CLI test harness** — Interactive tool to paste supplier emails and see extraction results
5. **Automated test suites** — Mocked (fast/free/deterministic) + live (real LLM, opt-in)

### What B1 Does NOT Deliver (Deferred to B1.5+)

- Policy evaluation engine
- Decision logic (accept/counter/escalate/clarify)
- Counter-offer email generation
- Database or persistence of any kind
- Web UI
- Email send/receive

### Spec Alignment Reference

This plan cross-references these sections of `PRODUCT_SPEC.md`:

| B1 Component | Spec Section(s) | Notes |
|-------------|-----------------|-------|
| `ExtractedQuoteData` type | 3.11 (ExtractedQuote model) | Field names match exactly; DB-only fields (id, messageId, orderId, createdAt) deferred to B3 |
| Fields extracted | 5.3 (Email Parsing) | All 6 extraction targets from spec covered; attachment parsing deferred to B4 |
| LLM Service | 2.3 (LLM Service Configuration) | Provider-agnostic abstraction, retry + fallback, full logging |
| Retry logic | 2.3, 7.7 (LLM Error Handling) | 2-3 retries primary → fallback → error (escalation to merchant added in B3) |
| Currency handling | 3.11, 8.1, 8.2 (Currency) | Both original currency and USD stored; hardcoded rates in B1, real API in B4 |
| Confidence scoring | 7.5 (Escalation Triggers) | "Model confidence low" is an escalation trigger; confidence not a DB column but feeds into ExtractionResult |
| File structure | 20 (File Structure) | `src/lib/llm/` and `src/lib/agent/` match spec proposal |
| Testing strategy | 14 (Testing Strategy) | TDD methodology, mocked external deps, extraction unit tests |

**Additions beyond spec:** `confidence` and `notes` fields in `ExtractionResult` (not `ExtractedQuoteData`) are implementation additions supported by the best practices analysis recommendation to "add confidence scoring to agent decisions."

---

## Project Initialization

Before any agent code, the project needs its skeleton:

The file structure follows the PRODUCT_SPEC Section 20 (`src/lib/llm/` for LLM Service) and PLAN_IMPLEMENTATION.md B1 (`src/lib/agent/` for agent logic including extraction). The `extractor.ts` file name matches the implementation plan exactly.

```
dr-jekyll/
├── package.json
├── tsconfig.json
├── next.config.js
├── .env.local                  # Copy from .env.example, fill in API keys
├── jest.config.ts              # Unit/integration test config
├── src/
│   ├── app/                    # Next.js App Router (placeholder only for B1)
│   │   └── page.tsx            # Minimal landing page
│   ├── lib/
│   │   ├── llm/                # Matches spec Section 20: src/lib/llm/
│   │   │   ├── types.ts        # LLMProvider, LLMRequest, LLMResponse, LLMConfig
│   │   │   ├── service.ts      # LLMService class (retry, fallback, logging)
│   │   │   ├── providers/
│   │   │   │   ├── claude.ts   # ClaudeProvider implements LLMProvider
│   │   │   │   └── openai.ts   # OpenAIProvider implements LLMProvider
│   │   │   └── index.ts        # Export configured singleton
│   │   └── agent/              # Matches PLAN_IMPLEMENTATION B1: src/lib/agent/
│   │       ├── types.ts        # ExtractedQuoteData, ExtractionResult (mirrors spec Section 3.11)
│   │       ├── extractor.ts    # ExtractionService (calls LLM, parses response)
│   │       ├── prompts.ts      # Extraction prompt template (first of 4 from plan)
│   │       ├── output-parser.ts # JSON parsing + validation of LLM output
│   │       └── index.ts        # Export configured singleton
│   └── cli/
│       └── extract.ts          # CLI test harness entry point
├── tests/
│   ├── unit/
│   │   ├── llm/
│   │   │   ├── service.test.ts
│   │   │   └── providers/
│   │   │       ├── claude.test.ts
│   │   │       └── openai.test.ts
│   │   └── agent/
│   │       ├── extractor.test.ts
│   │       ├── output-parser.test.ts
│   │       └── prompts.test.ts
│   ├── integration/
│   │   └── agent/
│   │       └── live-extraction.test.ts
│   └── fixtures/
│       └── supplier-emails/
│           ├── simple-quote.txt
│           ├── multi-item-quote.txt
│           ├── ambiguous-response.txt
│           ├── partial-info.txt
│           ├── multi-currency.txt
│           ├── rejection.txt
│           ├── counter-offer.txt
│           ├── moq-constraint.txt
│           └── conversational-no-numbers.txt
```

### Dependencies

```
# Core
next react react-dom typescript @types/react @types/node

# LLM providers
@anthropic-ai/sdk openai

# Validation
zod

# Testing
jest ts-jest @types/jest

# CLI
tsx                              # Run TypeScript files directly (for CLI harness)
```

---

## The Extraction Pipeline

### Input

Plain text of a supplier email. In real usage this comes from Gmail; in B1 it's pasted into the CLI or loaded from fixture files.

### Output: `ExtractedQuoteData`

The output type mirrors the spec's `ExtractedQuote` data model (Section 3.11) but without the persistence fields (`id`, `messageId`, `orderId`, `createdAt`) since B1 has no database. Field names match the spec exactly so no translation is needed when persistence is added in B3.

```typescript
// Matches PRODUCT_SPEC Section 3.11 (ExtractedQuote) field names.
// DB-only fields (id, messageId, orderId, createdAt) omitted — added in B3.
interface ExtractedQuoteData {
  quotedPrice: number | null;             // Decimal — per-unit price as stated by supplier
  quotedPriceCurrency: string;            // ISO 4217, default "USD" (spec: default USD)
  quotedPriceUsd: number | null;          // Converted to USD (null if conversion unavailable)
  availableQuantity: number | null;       // Quantity the supplier quoted for
  moq: number | null;                     // Minimum order quantity, if mentioned
  leadTimeDays: number | null;            // Lead time in days
  paymentTerms: string | null;            // e.g. "30% deposit, 70% before shipping"
  validityPeriod: string | null;          // e.g. "valid for 30 days" (spec Section 3.11 + 5.3)
  rawExtractionJson: Record<string, unknown>; // Full LLM extraction output (spec: rawExtractionJson)
}
```

**Note on fields not in the spec data model:** The following fields are useful for extraction quality but are NOT part of the persisted `ExtractedQuote` model. They live in `ExtractionResult` metadata or inside `rawExtractionJson`:

- **`confidence`** (0.0–1.0) — Stored in `ExtractionResult` (below), not in `ExtractedQuoteData`. The spec lists "Model confidence low" as an escalation trigger (Section 7.5) and the best practices analysis recommends confidence scoring, but it's not a column on the `ExtractedQuote` table.
- **`notes`** — Free-text observations (e.g., "supplier mentioned product discontinuation", "tiered pricing detected"). Stored inside `rawExtractionJson` as part of the full LLM output.

```typescript
interface ExtractionResult {
  success: boolean;
  data: ExtractedQuoteData | null;
  confidence: number;                 // 0.0–1.0, how confident the extraction is
  notes: string[];                    // LLM observations that don't map to structured fields
  error: string | null;               // If success=false, why
  provider: string;                   // Which LLM provider was used
  model: string;                      // Which model
  latencyMs: number;                  // How long the LLM call took
  retryCount: number;                 // How many retries were needed
}
```

### Fields Extracted (per spec Section 5.3)

From the supplier email body, the extraction pipeline targets these fields (matching the spec's Email Parsing list and ExtractedQuote model):

1. **quotedPrice** — Quoted price per unit (Decimal, nullable)
2. **quotedPriceCurrency** — Currency code, ISO 4217 (default "USD")
3. **quotedPriceUsd** — Price converted to USD (null if currency unknown or conversion unavailable; in B1, simple hardcoded rates for common currencies CNY/EUR/GBP; real API integration in B4)
4. **availableQuantity** — Quantity the supplier quoted for (nullable)
5. **moq** — Minimum order quantity if mentioned (nullable)
6. **leadTimeDays** — Lead time in days (nullable)
7. **paymentTerms** — Payment terms if mentioned (nullable)
8. **validityPeriod** — Quote validity if mentioned (nullable, e.g., "valid for 30 days")

**Not extracted in B1:** Attachment data (PDF/Excel parsing is part of B4: Email Integration).

### Processing Steps

1. **Build prompt** — Combine the extraction prompt template with the supplier email text
2. **Call LLM** — Via LLMService (handles retry + fallback automatically)
3. **Parse response** — Extract JSON from LLM output (handle markdown code blocks, trailing text, etc.)
4. **Validate** — Run Zod schema validation against the `ExtractedQuoteData` schema
5. **Convert currency** — If quotedPriceCurrency is non-USD, compute quotedPriceUsd (hardcoded rates in B1)
6. **Return** — `ExtractionResult` with data, confidence, notes, and provider metadata

---

## LLM Service Design

The LLM Service is the most reusable piece built in B1. It's used by extraction now and by every future agent stage.

### Interface

```typescript
interface LLMProvider {
  name: string;
  call(request: LLMRequest): Promise<LLMResponse>;
}

interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}

interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

interface LLMServiceConfig {
  primaryProvider: LLMProvider;
  fallbackProvider?: LLMProvider;
  maxRetriesPerProvider: number;      // Default: 3
  retryDelayMs: number;               // Default: 1000
}
```

### Retry + Fallback Logic (per spec Section 2.3 and 7.7)

1. Try primary provider (Claude) up to `maxRetriesPerProvider` times (spec: "2-3 times", default 3 per `.env.example` `LLM_MAX_RETRIES`)
2. If all primary retries fail, automatically route to fallback provider (OpenAI) up to `maxRetriesPerProvider` times
3. If fallback also fails, throw a descriptive error (in the full system this triggers escalation to merchant per spec Section 7.7; in B1 it's just an error)
4. Every attempt is logged with provider, model, latency, success/failure, and error message (spec: "All attempts are logged with provider, model, latency, and outcome")

---

## Test Fixtures: Supplier Email Scenarios

Each fixture is a `.txt` file containing a realistic supplier email. These are used by both the automated test suite and the CLI harness.

### Fixture 1: `simple-quote.txt`
A straightforward quote with all fields clearly stated.
```
Hi John,

Thanks for your inquiry about the bamboo cutting boards.

We can offer the following:
- Unit price: $4.50 USD
- MOQ: 500 pieces
- Lead time: 25-30 days after payment
- Payment: 30% deposit, balance before shipping
- Shipping: FOB Shenzhen

Let me know if you'd like to proceed.

Best regards,
Lisa Wang
```
**Expected extraction:** quotedPrice=4.50, quotedPriceCurrency=USD, quotedPriceUsd=4.50, moq=500, leadTimeDays in 25-30 range, paymentTerms populated, confidence > 0.9

### Fixture 2: `multi-currency.txt`
Quote with prices in CNY.
```
Dear Sir,

Price for silicone phone cases:
RMB 8.5/pc, minimum 1000pcs.
Delivery 15-20 working days.
Payment by T/T.
EXW Guangzhou.

Regards,
Mr. Chen
```
**Expected extraction:** quotedPriceCurrency=CNY, quotedPrice=8.5, quotedPriceUsd populated (via hardcoded rate), moq=1000, confidence > 0.8

### Fixture 3: `ambiguous-response.txt`
Supplier responds conversationally without committing to numbers.
```
Hello,

Thank you for reaching out. We have several options available for the stainless steel water bottles. Pricing depends on the finish and cap style you choose. Could you send us your specific requirements? We can usually do competitive pricing for larger orders.

Best,
Ahmed
```
**Expected extraction:** Most fields null, confidence < 0.3, notes should capture that supplier is asking for more details before quoting

### Fixture 4: `partial-info.txt`
Some fields present, others missing.
```
Hi there,

For the yoga mats, best price is $12.80 per unit for qty 200+.
We ship from our warehouse in Dongguan.

Cheers,
Tony
```
**Expected extraction:** quotedPrice=12.80, quotedPriceCurrency=USD, quotedPriceUsd=12.80, availableQuantity=null (200 is a threshold, not a quoted qty), moq=200, notes mention Dongguan shipping, confidence ~0.6-0.8

### Fixture 5: `counter-offer.txt`
Supplier is responding to a price the merchant proposed.
```
Dear valued customer,

Thank you for your order inquiry. Unfortunately we cannot meet your target price of $3.00 for the LED desk lamps. Our best price would be $4.20 per unit for 300 pieces, with 45 day lead time. This includes packaging and labeling per your specs.

Payment terms: 50% advance, 50% against B/L.
Shipping: CIF Los Angeles.

We hope this works for your budget.

Kind regards,
Mei Lin
```
**Expected extraction:** quotedPrice=4.20, quotedPriceCurrency=USD, quotedPriceUsd=4.20, availableQuantity=300, leadTimeDays=45, paymentTerms populated, confidence > 0.85

### Fixture 6: `rejection.txt`
Supplier declines entirely.
```
Hello,

Sorry but we have discontinued the ceramic vase line you inquired about. We no longer manufacture this product. You might try Foshan Ceramics Co for similar items.

Apologies for the inconvenience.
Best,
Zhou Wei
```
**Expected extraction:** All price fields null, confidence high (clear response), notes capture discontinuation

### Fixture 7: `moq-constraint.txt`
Supplier gives tiered pricing.
```
Hi,

Pricing for cotton tote bags:

100-499 pcs: $2.80/pc
500-999 pcs: $2.40/pc
1000+ pcs: $2.10/pc

Lead time 20 days. FOB Shanghai. T/T payment.

Thanks,
Jenny
```
**Expected extraction:** This is tricky — multiple price points. Extraction should capture the tiers in notes, pick the lowest tier price or first tier depending on prompt design. Confidence should reflect the ambiguity of which price to select.

### Fixture 8: `conversational-no-numbers.txt`
Purely conversational, no pricing info at all.
```
Hey!

Great to hear from you again. How was your trip to the trade show? We just finished a big production run for another customer so we have some capacity opening up next month. Let me know what you're thinking and I'll put together some numbers for you.

Talk soon,
Dave
```
**Expected extraction:** All fields null, confidence ~0.2, notes capture that supplier will follow up with pricing

### Fixture 9: `multi-item-quote.txt`
Supplier quotes multiple products in one email.
```
Dear buyer,

As requested, here are our quotes:

1. Silicone spatula set (3pc): $3.20/set, MOQ 300 sets
2. Bamboo utensil holder: $5.50/pc, MOQ 200 pcs
3. Stainless steel whisk: $1.80/pc, MOQ 500 pcs

All items: 30 day lead time, FOB Ningbo, 30% T/T deposit.

Please confirm which items you'd like to order.

Best,
Frank
```
**Expected extraction:** This tests edge cases. Since our current model is one SKU per order, the extraction should note multiple items. The notes field should capture all three. Individual fields could be null or pick the first item — the key is that confidence reflects the complexity and notes are informative.

---

## Automated Test Suites

### Suite 1: Mocked Tests (`npm test`)

These run with **zero external dependencies**. The LLM is mocked to return pre-defined responses. They validate that the code around the LLM works correctly: prompt building, response parsing, validation, retry logic, fallback logic, error handling.

#### Test File: `tests/unit/llm/service.test.ts`

Tests for the LLMService orchestration layer:

| # | Test Name | What It Verifies |
|---|-----------|-----------------|
| 1 | `calls primary provider with correct request shape` | System prompt + user message are passed through correctly |
| 2 | `returns response from primary provider on success` | Happy path — primary works first try |
| 3 | `retries on primary provider failure` | If primary throws, it retries up to maxRetries times |
| 4 | `falls back to secondary after primary exhausted` | After N primary failures, switches to fallback |
| 5 | `throws after all providers exhausted` | Both providers fail all retries → descriptive error |
| 6 | `logs every attempt` | Each call (success or failure) produces a log entry with provider, model, latency, outcome |
| 7 | `respects retry delay between attempts` | Exponential or fixed delay between retries |
| 8 | `works without fallback provider configured` | If no fallback, just retries primary then throws |

**Mocking approach:** The `LLMProvider` interface is injected into `LLMService`. Tests create mock providers using Jest mock functions that return controlled responses or throw controlled errors.

#### Test File: `tests/unit/llm/providers/claude.test.ts`

Tests for the Claude provider adapter:

| # | Test Name | What It Verifies |
|---|-----------|-----------------|
| 1 | `sends correct parameters to Anthropic SDK` | Model, max_tokens, system, messages are shaped correctly |
| 2 | `maps Anthropic response to LLMResponse` | Content, token counts, model name extracted correctly |
| 3 | `throws on API error with descriptive message` | Network errors, rate limits, auth errors are wrapped |
| 4 | `measures latency accurately` | latencyMs reflects actual call duration |

**Mocking approach:** The `@anthropic-ai/sdk` module is mocked at the import level. The mock's `messages.create` method returns controlled response objects.

#### Test File: `tests/unit/llm/providers/openai.test.ts`

Mirrors the Claude provider tests but for OpenAI:

| # | Test Name | What It Verifies |
|---|-----------|-----------------|
| 1 | `sends correct parameters to OpenAI SDK` | Model, max_tokens, messages array shaped correctly |
| 2 | `maps OpenAI response to LLMResponse` | Content, token counts, model name extracted correctly |
| 3 | `throws on API error with descriptive message` | Network errors, rate limits, auth errors are wrapped |
| 4 | `measures latency accurately` | latencyMs reflects actual call duration |

#### Test File: `tests/unit/agent/output-parser.test.ts`

Tests for parsing raw LLM text output into structured `ExtractedQuoteData`. This is the most critical test file — LLMs return messy output and the parser must be resilient.

| # | Test Name | What It Verifies |
|---|-----------|-----------------|
| 1 | `parses clean JSON response` | LLM returns pure JSON → parsed into valid `ExtractedQuoteData` |
| 2 | `parses JSON wrapped in markdown code block` | LLM returns ` ```json ... ``` ` → extracts and parses |
| 3 | `parses JSON with leading/trailing text` | LLM says "Here is the extraction: {...}" → extracts JSON |
| 4 | `handles null fields correctly` | Missing data → null in output (quotedPrice, availableQuantity, etc.) |
| 5 | `validates required fields via Zod` | Missing `quotedPriceCurrency` → defaults to "USD" per spec |
| 6 | `rejects completely invalid JSON` | LLM returns prose → clear error |
| 7 | `handles numeric strings` | `"4.50"` as string → converted to number 4.50 for quotedPrice |
| 8 | `normalizes currency codes` | `"usd"` → `"USD"`, `"RMB"` → `"CNY"` for quotedPriceCurrency |
| 9 | `clamps confidence to 0-1 range` | `confidence: 1.5` → clamped to 1.0 |
| 10 | `populates rawExtractionJson` | Full LLM output preserved in rawExtractionJson field (per spec Section 3.11) |
| 11 | `defaults quotedPriceCurrency to USD` | If currency not in LLM output, defaults to "USD" (spec default) |

**Mocking approach:** No mocks needed — these are pure functions. Input is a string (simulating LLM output), output is parsed data or an error.

#### Test File: `tests/unit/agent/extractor.test.ts`

Tests for the Extractor that orchestrates prompt building → LLM call → parsing → USD conversion:

| # | Test Name | What It Verifies |
|---|-----------|-----------------|
| 1 | `builds extraction prompt with supplier email embedded` | Email text appears in the prompt sent to LLM |
| 2 | `returns ExtractionResult with ExtractedQuoteData on success` | Happy path — data matches `ExtractedQuoteData` shape |
| 3 | `computes quotedPriceUsd for non-USD currencies` | CNY input → quotedPriceUsd populated via hardcoded rate |
| 4 | `sets quotedPriceUsd equal to quotedPrice for USD` | USD input → quotedPriceUsd = quotedPrice |
| 5 | `returns success=false when LLM returns unparseable output` | Parser fails → ExtractionResult.success=false, error message set |
| 6 | `returns success=false when LLM service throws` | All providers down → ExtractionResult.success=false, error message set |
| 7 | `includes provider metadata in result` | provider, model, latencyMs, retryCount populated from LLM response |
| 8 | `handles empty email input` | Empty string → success=false or confidence=0 |

**Mocking approach:** `LLMService` is mocked. Tests control what the LLM "returns" and verify that the Extractor handles each scenario correctly.

#### Test File: `tests/unit/agent/prompts.test.ts`

Tests for the prompt template:

| # | Test Name | What It Verifies |
|---|-----------|-----------------|
| 1 | `includes email text in user message` | The supplier email appears in the generated prompt |
| 2 | `system prompt requests JSON output` | System prompt explicitly asks for structured JSON |
| 3 | `system prompt defines all expected fields` | Every field in `ExtractedQuoteData` is mentioned: quotedPrice, quotedPriceCurrency, availableQuantity, moq, leadTimeDays, paymentTerms, validityPeriod |
| 4 | `system prompt includes confidence guidance` | Prompt explains when confidence should be high vs low |

**Mocking approach:** None — these test pure string-building functions.

### Suite 2: Live Integration Tests (`npm run test:live`)

These hit the **real Claude API** (and optionally OpenAI). They're slow, cost money, and are non-deterministic — but they validate that the prompts actually work with real models.

**These are NOT run in CI.** They're for manual validation during development.

#### Test File: `tests/integration/agent/live-extraction.test.ts`

Each test loads a fixture file, sends it through the real extraction pipeline, and asserts on the result:

| # | Test Name | Fixture | Key Assertions |
|---|-----------|---------|----------------|
| 1 | `extracts simple quote accurately` | `simple-quote.txt` | quotedPrice=4.50, quotedPriceCurrency=USD, quotedPriceUsd=4.50, moq=500, confidence > 0.8 |
| 2 | `handles multi-currency (CNY)` | `multi-currency.txt` | quotedPriceCurrency=CNY, quotedPrice=8.5, quotedPriceUsd is populated, moq=1000 |
| 3 | `recognizes ambiguous response` | `ambiguous-response.txt` | Most fields null, confidence < 0.4, notes non-empty |
| 4 | `extracts partial information` | `partial-info.txt` | quotedPrice=12.80, quotedPriceCurrency=USD, some fields null, confidence 0.5-0.9 |
| 5 | `extracts counter-offer data` | `counter-offer.txt` | quotedPrice=4.20, availableQuantity=300, leadTimeDays=45 |
| 6 | `recognizes rejection/discontinuation` | `rejection.txt` | quotedPrice null, notes mention discontinuation |
| 7 | `handles tiered pricing` | `moq-constraint.txt` | Notes capture tiers, confidence reflects ambiguity |
| 8 | `handles no-data conversational email` | `conversational-no-numbers.txt` | All fields null, low confidence |
| 9 | `handles multi-item quote` | `multi-item-quote.txt` | Notes capture all items, confidence reflects complexity |

**Important:** Live test assertions are intentionally loose (ranges, not exact values) because LLM output varies between runs. The goal is to catch regressions in prompt quality, not enforce exact outputs.

**Environment requirement:** `ANTHROPIC_API_KEY` must be set in `.env.local`. Tests skip gracefully if the key is missing.

---

## Running the Tests

### Prerequisites

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and add your API keys
cp .env.example .env.local
# Edit .env.local: set ANTHROPIC_API_KEY (required for live tests)
# Optionally set OPENAI_API_KEY for fallback provider testing
```

### Mocked Tests (Fast, Free, Deterministic)

```bash
# Run all mocked tests
npm test

# Run in watch mode (re-runs on file changes)
npm test -- --watch

# Run a specific test file
npm test -- tests/unit/agent/output-parser.test.ts

# Run tests matching a name pattern
npm test -- -t "parses clean JSON"

# Run with coverage report
npm test -- --coverage
```

**Expected behavior:** All tests pass in under 5 seconds. No network calls. No API keys needed. This is what you run constantly during development.

### Live Integration Tests (Slow, Costs Money, Real LLM)

```bash
# Run all live tests
npm run test:live

# Run a specific live test
npm run test:live -- tests/integration/agent/live-extraction.test.ts

# Run a specific scenario
npm run test:live -- -t "extracts simple quote"
```

**Expected behavior:** Takes 30-90 seconds depending on LLM response times. Each test makes 1 real API call. Costs roughly $0.01-0.05 total for a full run with Haiku. Tests skip if `ANTHROPIC_API_KEY` is not set.

**The `test:live` script** is a Jest configuration that:
- Points to the `tests/integration/` directory
- Sets a longer timeout (30s per test instead of 5s)
- Loads `.env.local` for API keys

### Verifying Results

After running tests, you should see:

```
# Mocked tests — all should pass, all should be fast
PASS  tests/unit/llm/service.test.ts (0.8s)
PASS  tests/unit/llm/providers/claude.test.ts (0.3s)
PASS  tests/unit/llm/providers/openai.test.ts (0.3s)
PASS  tests/unit/agent/output-parser.test.ts (0.4s)
PASS  tests/unit/agent/extractor.test.ts (0.5s)
PASS  tests/unit/agent/prompts.test.ts (0.2s)

Test Suites: 6 passed, 6 total
Tests:       39 passed, 39 total
Time:        2.5s

# Live tests — most should pass, some may be flaky due to LLM non-determinism
PASS  tests/integration/agent/live-extraction.test.ts (45s)

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

If a live test fails, check:
1. Is the assertion too strict? LLM output varies — widen the expected range.
2. Is the prompt unclear? Adjust `prompts.ts` and re-run.
3. Is the model different? Haiku vs Sonnet may extract differently.

---

## CLI Test Harness

The CLI harness is for **interactive, manual testing**. You paste a supplier email (or load a fixture), and the tool runs it through the real extraction pipeline, displaying the results.

### Running It

```bash
# Interactive mode: paste an email, press Ctrl+D (or Ctrl+Z on Windows) to submit
npx tsx src/cli/extract.ts

# From a fixture file
npx tsx src/cli/extract.ts --file tests/fixtures/supplier-emails/simple-quote.txt

# Run all fixtures in sequence
npx tsx src/cli/extract.ts --all-fixtures

# Verbose mode: show full trace of every step
npx tsx src/cli/extract.ts --verbose --file tests/fixtures/supplier-emails/simple-quote.txt

# Quiet mode: just the extracted data (default)
npx tsx src/cli/extract.ts --file tests/fixtures/supplier-emails/simple-quote.txt
```

### Output: Default (Quiet) Mode

```
$ npx tsx src/cli/extract.ts --file tests/fixtures/supplier-emails/simple-quote.txt

Extracted Quote:
  Quoted Price:      $4.50 USD
  Price (USD):       $4.50
  Available Qty:     —
  MOQ:               500 pieces
  Lead Time:         25-30 days
  Payment Terms:     30% deposit, balance before shipping
  Validity Period:   —
  Confidence:        0.95
  Notes:             ["FOB Shenzhen shipping terms"]
  Provider:          claude (claude-3-haiku-20240307)
  Latency:           1,240ms
```

### Output: Verbose Mode

```
$ npx tsx src/cli/extract.ts --verbose --file tests/fixtures/supplier-emails/simple-quote.txt

═══ STEP 1: Input ═══
Source: tests/fixtures/supplier-emails/simple-quote.txt
Email text (247 chars):
  Hi John,
  Thanks for your inquiry about the bamboo cutting boards...
  [full text shown]

═══ STEP 2: Prompt Construction ═══
System prompt (312 chars):
  You are a data extraction assistant. Given a supplier email...
  [full system prompt shown]
User message (285 chars):
  Extract structured quote data from the following supplier email...
  [full user message shown]

═══ STEP 3: LLM Call ═══
Provider: claude (claude-3-haiku-20240307)
Attempt: 1 of 3
Latency: 1,240ms
Input tokens: 580
Output tokens: 210
Raw response:
  ```json
  {
    "quotedPrice": 4.50,
    "quotedPriceCurrency": "USD",
    "availableQuantity": null,
    "moq": 500,
    "leadTimeDays": 27,
    "paymentTerms": "30% deposit, balance before shipping",
    "validityPeriod": null,
    "confidence": 0.95,
    "notes": ["FOB Shenzhen shipping terms"]
  }
  ```

═══ STEP 4: Parse & Validate ═══
JSON extracted: yes (from markdown code block)
Zod validation: passed (ExtractedQuoteData schema)
USD conversion: quotedPriceUsd = 4.50 (same as quotedPrice, already USD)

═══ STEP 5: Result ═══
Extracted Quote:
  Quoted Price:      $4.50 USD
  Price (USD):       $4.50
  Available Qty:     —
  MOQ:               500 pieces
  Lead Time:         25-30 days
  Payment Terms:     30% deposit, balance before shipping
  Validity Period:   —
  Confidence:        0.95
  Notes:             ["FOB Shenzhen shipping terms"]
  rawExtractionJson: { "quotedPrice": 4.50, "quotedPriceCurrency": "USD", ... }

Provider: claude | Model: claude-3-haiku-20240307 | Latency: 1,240ms | Retries: 0
```

### CLI Flags Summary

| Flag | Description |
|------|-------------|
| `--file <path>` | Read email from a file instead of stdin |
| `--all-fixtures` | Run all fixture files in `tests/fixtures/supplier-emails/` |
| `--verbose` | Show full trace: prompt, raw LLM output, parsing steps |
| `--provider <name>` | Force a specific provider (`claude` or `openai`) instead of default |
| `--model <name>` | Override the model (e.g., `claude-3-sonnet-20240229`) |

---

## Implementation Order (TDD Cycle)

Each step follows strict TDD: write the test first, see it fail, implement the minimum code to pass, then refactor.

### Step 1: Project Setup
- Initialize Next.js with TypeScript
- Install dependencies
- Configure Jest (both mocked and live configs)
- Create directory structure
- Verify `npm test` runs (with zero tests)

### Step 2: LLM Types + Provider Interface
- Write `src/lib/llm/types.ts` with all interfaces
- No tests needed — pure type definitions

### Step 3: Claude Provider (TDD)
- Write `tests/unit/llm/providers/claude.test.ts` — **all 4 tests, all failing**
- Implement `src/lib/llm/providers/claude.ts` until all tests pass
- Refactor if needed

### Step 4: OpenAI Provider (TDD)
- Write `tests/unit/llm/providers/openai.test.ts` — **all 4 tests, all failing**
- Implement `src/lib/llm/providers/openai.ts` until all tests pass
- Refactor if needed

### Step 5: LLM Service (TDD)
- Write `tests/unit/llm/service.test.ts` — **all 8 tests, all failing**
- Implement `src/lib/llm/service.ts` until all tests pass
- Refactor if needed

### Step 6: Agent Types
- Write `src/lib/agent/types.ts` with `ExtractedQuoteData` and `ExtractionResult`
- Field names match spec Section 3.11: `quotedPrice`, `quotedPriceCurrency`, `quotedPriceUsd`, `availableQuantity`, `moq`, `leadTimeDays`, `paymentTerms`, `validityPeriod`, `rawExtractionJson`
- Write Zod schemas for validation (default `quotedPriceCurrency` to "USD" per spec)
- No tests needed — pure type definitions + schemas

### Step 7: Output Parser (TDD)
- Write `tests/unit/agent/output-parser.test.ts` — **all 11 tests, all failing**
- Implement `src/lib/agent/output-parser.ts` until all tests pass
- This is critical — the parser must handle messy LLM output robustly

### Step 8: Extraction Prompts (TDD)
- Write `tests/unit/agent/prompts.test.ts` — **all 4 tests, all failing**
- Implement `src/lib/agent/prompts.ts` until all tests pass
- Iterate on prompt wording (these tests verify structure, not quality)
- Prompt must request all spec fields including `validityPeriod`

### Step 9: Extractor (TDD)
- Write `tests/unit/agent/extractor.test.ts` — **all 8 tests, all failing**
- Implement `src/lib/agent/extractor.ts` until all tests pass
- Includes hardcoded USD conversion for common currencies (CNY, EUR, GBP)

### Step 10: Test Fixtures
- Create all 9 fixture files in `tests/fixtures/supplier-emails/`
- These are static text files, no code

### Step 11: CLI Test Harness
- Implement `src/cli/extract.ts`
- Manual testing only — verify it works with fixtures and stdin
- Test verbose vs quiet output modes

### Step 12: Live Integration Tests
- Write `tests/integration/agent/live-extraction.test.ts` — **all 9 tests**
- Run `npm run test:live` against real Claude API
- Iterate on prompts based on results
- Widen assertion ranges if needed for flaky tests

### Step 13: Prompt Refinement
- Based on live test results, refine `prompts.ts`
- Re-run live tests until 8/9+ pass consistently
- Re-run mocked tests to ensure nothing broke

---

## Success Criteria

B1 is complete when:

1. **`npm test` passes 100%** — All 39 mocked tests green, under 5 seconds
2. **`npm run test:live` passes 8/9+** — At least 8 of 9 live extraction scenarios produce reasonable results
3. **CLI harness works** — Can paste a supplier email and get structured output, both verbose and quiet modes
4. **LLM Service is provider-agnostic** — Switching from Claude to OpenAI requires only config change, not code change
5. **Parser is resilient** — Handles markdown blocks, trailing text, numeric strings, missing fields without crashing

---

## Deferred to B1.5

The following items from the original B1 plan in `PLAN_IMPLEMENTATION.md` are deferred:

| Feature | Why Deferred |
|---------|-------------|
| Policy evaluation engine | Depends on extraction being solid first |
| Decision logic (accept/counter/escalate) | Depends on policy evaluation |
| Counter-offer email generation | Depends on decision logic |
| Full agent pipeline orchestration | All 4 stages needed |
| 6 test scenarios from original plan | Replaced by extraction-focused scenarios |

These will be implemented in B1.5 once extraction is proven reliable.
