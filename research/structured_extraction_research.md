# Structured Data Extraction from LLM Outputs: Research & Landscape Analysis

**Date:** February 2026
**Context:** PO Pro — AI agent extracting purchase order details, supplier responses, pricing, and shipping data from email conversations using Next.js/TypeScript.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Schema-Based Extraction Libraries](#2-schema-based-extraction-libraries)
3. [Agent Frameworks with Built-in Extraction](#3-agent-frameworks-with-built-in-extraction)
4. [Validation and Schema Approaches](#4-validation-and-schema-approaches)
5. [Comparative Analysis](#5-comparative-analysis)
6. [Recommendation for PO Pro](#6-recommendation-for-po-pro)
7. [Sources](#7-sources)

---

## 1. Executive Summary

The structured data extraction landscape for LLM outputs has matured significantly in 2025-2026. The key shift is that **both OpenAI and Anthropic now offer native structured outputs with constrained decoding** — meaning the model literally cannot produce tokens that violate your JSON schema. This eliminates the historical need for output parsing, retry loops, and validation gymnastics that libraries like Instructor were created to solve.

For PO Pro's Next.js/TypeScript stack, the **Vercel AI SDK (v6)** combined with **Zod schemas** and **Anthropic's native structured outputs** is the strongest path forward. This provides type safety, multi-model support, streaming, and direct framework integration without requiring additional abstraction layers.

---

## 2. Schema-Based Extraction Libraries

### 2.1 Vercel AI SDK (v6) — `generateText` / `streamText` with `Output.object()`

**Status:** Generally available. AI SDK 6 released in early 2026.

The Vercel AI SDK is the de facto standard for building AI applications in Next.js/TypeScript. It has undergone major evolution:

- **SDK 4:** Introduced `generateObject()` / `streamObject()` as standalone functions
- **SDK 5:** Unified under `generateText` / `streamText` with `output` property; added Zod 4 support
- **SDK 6:** Deprecated `generateObject`/`streamObject` entirely; introduced `Agent` abstraction, tool execution approval, DevTools, stable MCP, and unified structured output + tool calling in multi-step loops

**How structured output works:**

```typescript
import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const { output } = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  output: Output.object({
    schema: z.object({
      supplierName: z.string().describe('Name of the supplier company'),
      quotedPrice: z.number().describe('Unit price quoted in the email'),
      currency: z.string().describe('ISO 4217 currency code'),
      moq: z.number().describe('Minimum order quantity'),
      leadTimeDays: z.number().describe('Lead time in calendar days'),
      paymentTerms: z.string().describe('Payment terms, e.g. Net 30'),
    }),
  }),
  prompt: `Extract purchase order details from this supplier email:\n\n${emailBody}`,
});
// output is fully typed: { supplierName: string, quotedPrice: number, ... }
```

**Output types supported:**
- `Output.object({ schema })` — Schema-validated object
- `Output.array({ element })` — Typed array where each element is validated
- `Output.choice()` — Fixed string options (enum-like)
- `Output.json()` — Unstructured JSON (no validation)
- `Output.text()` — Plain text (default)

**Key capabilities:**

| Feature | Support |
|---------|---------|
| Extraction reliability | Leverages provider-native structured outputs (constrained decoding) when available; falls back to prompt-based JSON + validation |
| Retry/self-healing | No built-in retry on validation failure — relies on provider guarantees instead |
| Type safety | Full TypeScript inference from Zod schemas; `output` property is fully typed |
| Streaming | `streamText` with `partialOutputStream` for progressive objects; `elementStream` for validated array elements |
| Multi-model | Unified API across OpenAI, Anthropic, Google, xAI, Mistral, Cohere, and 20+ providers |
| Enterprise scalability | Production-grade; used by Vercel's own AI products; middleware support for observability |
| Customizability | Middleware API, custom providers, MCP tool integration |

**Streaming caveat:** Partial outputs via `partialOutputStream` cannot be validated against the schema mid-stream (incomplete data may not conform). Use `elementStream` for arrays when you need validated elements as they arrive.

**AI SDK 6 agent features relevant to PO Pro:**
- `ToolLoopAgent`: Handles multi-step tool calling + structured output generation in a single abstraction
- `needsApproval: true` on tools: Human-in-the-loop execution approval (maps directly to PO Pro's approval flow)
- `devToolsMiddleware`: Debug visibility into each agent step's inputs, outputs, and token usage
- `strict: true` on individual tools: Enables provider-native schema validation per tool

**Performance:** p99 latency of ~30ms SDK overhead; throughput ~250 req/s (SDK-level, not including LLM latency).

---

### 2.2 Instructor (instructor-js) — Structured Extraction with Retries

**Status:** Active development. npm package `@instructor-ai/instructor`.

Instructor originated in the Python ecosystem (by Jason Liu) and was ported to TypeScript by Dimitri Kennedy (creator of Island AI). It was designed specifically for the pre-structured-outputs era when LLMs frequently returned malformed JSON.

**How it works:**

```typescript
import Instructor from '@instructor-ai/instructor';
import OpenAI from 'openai';
import { z } from 'zod';

const oai = new OpenAI();
const client = Instructor({ client: oai, mode: 'FUNCTIONS' });

const PurchaseOrder = z.object({
  supplierName: z.string(),
  items: z.array(z.object({
    sku: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
  })),
  totalAmount: z.number(),
});

const result = await client.chat.completions.create({
  messages: [{ role: 'user', content: emailBody }],
  model: 'gpt-4o',
  response_model: { schema: PurchaseOrder, name: 'PurchaseOrder' },
  max_retries: 3,
});
```

**Key capabilities:**

| Feature | Support |
|---------|---------|
| Extraction reliability | Sends Zod schema as function/tool definition; validates response; re-asks the model with error context on failure |
| Retry/self-healing | Built-in `max_retries` with self-reflection: sends validation errors back to the model as correction prompts |
| Type safety | Full Zod-based typing with compile-time inference |
| Streaming | Partial JSON streaming via Island AI collaboration |
| Multi-model | OpenAI (primary), Anthropic, Google, Cohere, and 15+ providers via `llm-polyglot` adapter library |
| Enterprise scalability | Lightweight wrapper; scales with underlying provider SDK |
| Customizability | Custom Zod validators with `.refine()` guide the model; validation context objects for dynamic rules |

**Modes:** `FUNCTIONS` (OpenAI function calling), `TOOLS` (tool_use), `JSON` (JSON mode), `MD_JSON` (markdown JSON extraction).

**Assessment for PO Pro:** Instructor's primary value proposition — retry-based self-healing — is less critical now that both Anthropic and OpenAI offer constrained decoding. However, it still provides value for:
- Complex validations (e.g., "total must equal sum of line items") that constrained decoding cannot enforce
- Working with models that don't support native structured outputs
- The self-healing pattern is useful when extraction involves semantic judgments the model might get wrong on first attempt

---

### 2.3 Anthropic Claude Native Structured Outputs

**Status:** Generally available as of late 2025. Supported on Claude Opus 4.6, Sonnet 4.6, Sonnet 4.5, Opus 4.5, and Haiku 4.5.

Anthropic launched structured outputs in November 2025, bringing feature parity with OpenAI. This is the most significant development in this space for PO Pro, since Claude is the primary LLM.

**Two modes:**

1. **JSON Outputs** (`output_config.format`): Controls Claude's response format for extraction tasks.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const SupplierResponseSchema = z.object({
  confirmedQuantity: z.number(),
  unitPrice: z.number(),
  currency: z.string(),
  estimatedShipDate: z.string(),
  paymentTerms: z.string(),
  counterOffer: z.boolean(),
  notes: z.string().optional(),
});

const client = new Anthropic();
const response = await client.messages.parse({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: `Extract supplier response from:\n\n${emailBody}` }],
  output_config: { format: zodOutputFormat(SupplierResponseSchema) },
});

// response.parsed_output is guaranteed to match the schema
console.log(response.parsed_output.unitPrice);
```

2. **Strict Tool Use** (`strict: true`): Guarantees schema validation on tool inputs. Useful for agentic workflows where Claude calls tools with structured parameters.

**How constrained decoding works:** Claude compiles your JSON schema into a grammar, caches it for 24 hours, and applies constraints at every token generation step. The model literally cannot produce output that violates the schema.

**Key capabilities:**

| Feature | Support |
|---------|---------|
| Extraction reliability | Guaranteed schema compliance via constrained decoding — no parsing errors possible |
| Retry/self-healing | Not needed — output is always valid (except refusals and max_tokens truncation) |
| Type safety | Zod integration via `zodOutputFormat()` helper; `parsed_output` is fully typed |
| Streaming | Supported — stream structured outputs like normal responses |
| Multi-model | Claude-only (Anthropic API, Amazon Bedrock) |
| Enterprise scalability | Production-grade; 24-hour grammar caching; batch processing with 50% discount |
| Customizability | Standard JSON Schema with some limitations (no recursive schemas, no complex numeric constraints) |

**Limitations:**
- First request with a new schema incurs compilation latency
- Max 20 strict tools per request
- Max 24 optional parameters across all strict schemas
- No recursive schemas
- No `minimum`/`maximum`/`minLength`/`maxLength` constraints (moved to descriptions by SDKs)
- `additionalProperties` must be `false` for all objects
- Slightly higher input token count due to injected system prompt

**Edge cases where output may not match schema:**
- Safety refusals (`stop_reason: "refusal"`)
- Token limit reached (`stop_reason: "max_tokens"`)

---

### 2.4 OpenAI Structured Outputs / Function Calling / JSON Mode

**Status:** Generally available. Structured outputs launched mid-2024.

OpenAI pioneered native structured outputs before Anthropic. They offer three tiers:

1. **JSON Mode** (`response_format: { type: "json_object" }`): Guarantees valid JSON but NOT schema compliance.
2. **Structured Outputs** (`response_format: { type: "json_schema", json_schema: {...} }`): Full schema-constrained decoding.
3. **Function Calling** with `strict: true`: Schema validation on function parameters.

**Key capabilities:**

| Feature | Support |
|---------|---------|
| Extraction reliability | Constrained decoding; guaranteed schema compliance |
| Retry/self-healing | Not needed with structured outputs mode |
| Type safety | JSON Schema-based; no native Zod integration (use AI SDK or Instructor for that layer) |
| Streaming | Supported |
| Multi-model | OpenAI models only (GPT-4o, GPT-4o-mini, o1, etc.) |
| Enterprise scalability | Production-grade |
| Customizability | Standard JSON Schema subset |

**Assessment for PO Pro:** OpenAI serves as the fallback LLM. When using the Vercel AI SDK, the same Zod schema works across both Anthropic and OpenAI — the SDK handles the provider-specific translation.

---

### 2.5 LangChain Structured Output (TypeScript)

**Status:** Active but shifting focus to LangGraph for agent use cases.

LangChain JS provides structured output via the `.withStructuredOutput()` method on chat models:

```typescript
import { ChatAnthropic } from '@langchain/anthropic';
import { z } from 'zod';

const model = new ChatAnthropic({ model: 'claude-sonnet-4-5' });
const structuredModel = model.withStructuredOutput(z.object({
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
  })),
}));

const result = await structuredModel.invoke('Extract items from this PO...');
```

LangChain also provides `StructuredOutputParser` (legacy) and `OutputFixingParser` (auto-corrects malformed outputs by re-prompting).

**Key capabilities:**

| Feature | Support |
|---------|---------|
| Extraction reliability | Uses provider-native structured outputs when available; falls back to prompt-based parsing |
| Retry/self-healing | `OutputFixingParser` sends errors back to model; manual retry patterns |
| Type safety | Zod schemas with TypeScript inference |
| Streaming | Partial support |
| Multi-model | All major providers via provider packages |
| Enterprise scalability | Widely adopted but higher bundle size and abstraction overhead |
| Customizability | Extensive chain/pipeline composition |

**Assessment for PO Pro:** LangChain adds significant abstraction overhead for what PO Pro needs. The official LangChain team has stated that LangGraph (not LangChain chains) should be used for agent workflows. For simple structured extraction, the AI SDK is lighter and better integrated with Next.js.

---

### 2.6 Constrained Generation Libraries (Outlines / LMQL / Guidance)

**Status:** Active in the self-hosted/open-source model space. Less relevant for API-hosted models.

These libraries enforce structured output at the decoding level:

- **Outlines** (dottxt-ai): Compiles JSON schemas into finite automata; pre-computes token masks. Python-only. Used with self-hosted models (vLLM, HuggingFace).
- **LMQL**: Domain-specific language for constrained LLM queries. Python-only.
- **Guidance** (Microsoft): Interleaves generation with programmatic constraints. `llguidance` library processes constraints at ~50us per token.
- **XGrammar**: Grammar-based constrained generation.

**Assessment for PO Pro:** These are irrelevant for PO Pro's use case. They target self-hosted model deployments. Since PO Pro uses API-hosted Claude and OpenAI, the providers' native structured outputs serve the same purpose.

---

### 2.7 TypeChat (Microsoft)

**Status:** Available on npm. Development appears to have slowed since 2023-2024.

TypeChat uses TypeScript type definitions (not Zod) as the schema language:

```typescript
// schema.ts
export interface PurchaseOrder {
  supplier: string;
  items: Array<{ sku: string; quantity: number; price: number }>;
  total: number;
}
```

The library constructs prompts from these types, validates responses using the TypeScript compiler API, and if validation fails, sends repair prompts with compiler diagnostics back to the model.

**Key capabilities:**

| Feature | Support |
|---------|---------|
| Extraction reliability | TypeScript compiler validation + repair loop |
| Retry/self-healing | Sends TS compiler errors back as repair prompts |
| Type safety | Uses TypeScript types directly (not Zod) — but no runtime validation without additional code |
| Streaming | Not supported |
| Multi-model | OpenAI and Azure OpenAI |
| Enterprise scalability | Limited adoption |
| Customizability | Interesting approach but limited ecosystem |

**Assessment for PO Pro:** TypeChat's approach is clever (using the TS compiler for validation) but it has limited model support, no streaming, and a smaller community. The Zod + AI SDK ecosystem is far more mature. TypeChat's development momentum has also slowed — Anders Hejlsberg's involvement brought attention but the project hasn't kept pace with the structured outputs revolution.

---

### 2.8 Marvin AI

**Status:** Active (v3.0 released). Python-only.

Marvin provides `extract()`, `classify()`, `cast()`, and `generate()` functions for structured data operations. V3.0 uses Pydantic AI for LLM interactions. Not available in TypeScript.

**Assessment for PO Pro:** Python-only. Not applicable.

---

## 3. Agent Frameworks with Built-in Extraction

### 3.1 LangGraph

**Status:** Active. Recommended by LangChain team for all agent use cases.

LangGraph models agents as state machines with nodes, edges, and conditional routing. It treats structured output as part of the agent state.

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';

const agent = createReactAgent({
  llm: model,
  tools: [...],
  responseFormat: z.object({
    action: z.enum(['confirm', 'counter', 'escalate']),
    extractedData: z.object({ /* ... */ }),
  }),
});
```

**Key capabilities for structured extraction:**
- State schemas defined with Zod provide type safety across the entire agent graph
- Structured output is a natural part of node execution
- Built-in persistence for long-running conversations (relevant for multi-email PO threads)
- Human-in-the-loop checkpoints
- LangSmith integration for tracing and debugging

**Assessment for PO Pro:** LangGraph is powerful for complex multi-agent orchestration but introduces significant architectural complexity. PO Pro's agent is relatively linear (receive email -> extract data -> check policies -> draft reply -> get approval -> send). The AI SDK 6's `ToolLoopAgent` covers this pattern with less overhead. LangGraph becomes valuable if PO Pro evolves into a multi-agent system.

---

### 3.2 CrewAI

**Status:** Active. Python-focused with limited TypeScript support.

CrewAI models multi-agent systems through roles, tasks, and collaboration protocols. Structured output is defined per task using Pydantic models.

**Assessment for PO Pro:** Python-centric. Not well suited for a Next.js/TypeScript project.

---

### 3.3 AutoGen / Microsoft Agent Framework

**Status:** Merging with Semantic Kernel into the unified "Microsoft Agent Framework." GA target: Q1 2026.

AutoGen models workflows as multi-agent conversations. The merger with Semantic Kernel brings enterprise features (Azure integration, compliance, multi-language support in C#, Python, Java).

**Assessment for PO Pro:** Primarily C#/Python. The Microsoft ecosystem integration is strong for Azure-based deployments but irrelevant for a Vercel/Next.js stack.

---

### 3.4 Semantic Kernel

**Status:** Being absorbed into Microsoft Agent Framework. V1.x maintenance continues for one year post-GA.

Semantic Kernel supports structured output via "plugins" and can use Pydantic models (Python) or class-based definitions (C#/Java) for defining output structures.

**Assessment for PO Pro:** .NET/Python/Java focused. Not suitable for TypeScript.

---

## 4. Validation and Schema Approaches

### 4.1 Zod (TypeScript)

**Status:** Zod 4 (and Zod Mini) released in 2025. 24M+ monthly npm downloads.

Zod is the clear winner for TypeScript schema definition in the AI/LLM space:

- **Compile-time types:** `z.infer<typeof schema>` generates TypeScript types
- **Runtime validation:** `schema.parse(data)` validates at runtime
- **Rich descriptions:** `.describe()` annotations are sent to the LLM
- **Refinements:** `.refine()` enables custom validation logic (e.g., "total must match sum of items")
- **Ecosystem adoption:** Vercel AI SDK, Instructor, LangChain JS, Anthropic SDK helpers all use Zod

Example schema for PO Pro email extraction:

```typescript
const SupplierEmailExtraction = z.object({
  messageType: z.enum([
    'quote',
    'confirmation',
    'counter_offer',
    'shipping_notice',
    'question',
    'other',
  ]).describe('The type of supplier message'),

  items: z.array(z.object({
    productName: z.string().describe('Product name or description'),
    sku: z.string().optional().describe('SKU or product code if mentioned'),
    quantity: z.number().describe('Quantity offered or confirmed'),
    unitPrice: z.number().describe('Price per unit'),
    currency: z.string().describe('ISO 4217 currency code'),
  })).describe('Line items mentioned in the email'),

  totalAmount: z.number().optional().describe('Total order amount if stated'),
  leadTimeDays: z.number().optional().describe('Lead time in days if mentioned'),
  paymentTerms: z.string().optional().describe('Payment terms if mentioned'),
  shippingMethod: z.string().optional().describe('Shipping method if mentioned'),
  estimatedShipDate: z.string().optional().describe('Estimated ship date if mentioned'),

  requiresHumanReview: z.boolean().describe('Whether this email contains unusual terms or requests that need human attention'),
  extractionConfidence: z.enum(['high', 'medium', 'low']).describe('Confidence level in the extraction accuracy'),
  notes: z.string().optional().describe('Any additional context or notes about the email'),
});

type SupplierEmailExtraction = z.infer<typeof SupplierEmailExtraction>;
```

**Important note on Zod + constrained decoding:** When using Anthropic or OpenAI's native structured outputs, Zod refinements (`.refine()`, `.superRefine()`) are NOT enforced by the model's constrained decoding. The SDK strips these before sending to the provider and validates locally after receiving the response. This means the model might still return data that passes the schema shape but fails custom refinements — requiring a retry or error handling.

---

### 4.2 JSON Schema

JSON Schema is the underlying format that both Anthropic and OpenAI accept for structured outputs. Zod schemas are converted to JSON Schema by the SDKs.

**Limitations in structured output contexts:**
- No recursive schemas
- No `minimum`/`maximum`/`minLength`/`maxLength` (moved to descriptions)
- `additionalProperties` must be `false`
- Limited `anyOf`/`allOf` support
- No external `$ref`

For PO Pro, you never need to write JSON Schema directly — Zod + SDK helpers handle the conversion.

---

### 4.3 Pydantic (Python Comparison)

Pydantic is the Python equivalent of Zod. Anthropic's Python SDK uses `client.messages.parse()` with Pydantic models. Not directly relevant to PO Pro's TypeScript stack, but useful context:
- Pydantic v2 has similar validation capabilities to Zod
- The `instructor` Python library uses Pydantic (while `instructor-js` uses Zod)
- Marvin v3.0 uses Pydantic AI for LLM interactions

---

### 4.4 Runtime Validation Libraries Comparison

| Library | Bundle Size | Performance | LLM Ecosystem Adoption |
|---------|------------|-------------|----------------------|
| **Zod** | Moderate | Good (adequate for AI use) | Dominant — AI SDK, Instructor, LangChain, Anthropic SDK |
| **Valibot** | Smallest (~1KB) | Excellent | Supported by AI SDK as alternative to Zod |
| **AJV** (JSON Schema) | Moderate | Fastest (5-18x faster than Zod) | Not directly used in LLM workflows |
| **TypeBox** | Small | Very fast | Minimal LLM ecosystem presence |
| **Yup** | Moderate | Good | Legacy; replaced by Zod in modern projects |

**Recommendation:** Zod. The performance difference is negligible for AI workflows (validation takes microseconds; LLM calls take seconds), and Zod's ecosystem dominance in the AI space makes it the only practical choice.

---

## 5. Comparative Analysis

### 5.1 Overall Comparison Matrix

| Solution | Reliability | Retry/Self-Heal | Type Safety | Streaming | Multi-Model | Next.js Fit | Complexity |
|----------|------------|----------------|------------|-----------|-------------|-------------|------------|
| **AI SDK 6 + Zod** | Excellent (native constrained decoding) | Provider-guaranteed | Excellent | Excellent | Excellent (20+ providers) | Perfect | Low |
| **Anthropic SDK + Zod** | Excellent (constrained decoding) | Not needed | Excellent | Yes | Claude only | Good | Low |
| **Instructor-js** | Good (retry-based healing) | Excellent (max_retries + self-reflection) | Excellent | Yes (partial) | Good (15+ via polyglot) | Good | Low-Medium |
| **LangChain JS** | Good | OutputFixingParser | Good | Partial | Excellent | Medium | High |
| **LangGraph** | Good | Via state machine retries | Good | Yes | Excellent | Medium | High |
| **TypeChat** | Moderate (TS compiler repair) | Yes (compiler-guided) | Good | No | Limited | Medium | Medium |

### 5.2 Decision Criteria for PO Pro

**Must-haves:**
1. TypeScript/Next.js native integration
2. Zod schema support
3. Claude as primary model, OpenAI as fallback
4. Reliable extraction from messy email text
5. Streaming support for dashboard UI
6. Human-in-the-loop approval integration

**Nice-to-haves:**
7. Built-in retry/self-healing for edge cases
8. Observability and debugging tools
9. Low abstraction overhead
10. Active maintenance and large community

**Scoring:**

| Criterion | AI SDK 6 | Instructor-js | LangChain | LangGraph |
|-----------|----------|--------------|-----------|-----------|
| 1. Next.js integration | 10 | 7 | 6 | 5 |
| 2. Zod support | 10 | 10 | 9 | 9 |
| 3. Claude + OpenAI | 10 | 9 | 10 | 10 |
| 4. Email extraction | 9 | 9 | 8 | 8 |
| 5. Streaming | 10 | 7 | 6 | 7 |
| 6. Human-in-the-loop | 9 | 3 | 5 | 9 |
| 7. Retry/self-healing | 6 | 10 | 7 | 7 |
| 8. Observability | 9 | 5 | 8 | 9 |
| 9. Low overhead | 10 | 9 | 4 | 3 |
| 10. Community | 10 | 7 | 9 | 8 |
| **Total** | **93** | **76** | **72** | **75** |

---

## 6. Recommendation for PO Pro

### Primary Approach: Vercel AI SDK 6 + Zod + Anthropic Native Structured Outputs

**Architecture:**

```
Email arrives (Gmail webhook)
  └─> Email Parser Service
       └─> AI SDK generateText() with Output.object({ schema: SupplierEmailSchema })
            ├─ Model: claude-sonnet-4-5 (primary) / gpt-4o (fallback)
            ├─ Schema: Zod schema defining extraction shape
            └─ Provider handles constrained decoding → guaranteed valid JSON
       └─> Zod .refine() validation for business rules (e.g., price within guardrails)
            ├─ Pass → Continue to Policy Engine
            └─ Fail → Retry with Instructor-style correction prompt OR escalate
```

**Key implementation decisions:**

1. **Use `generateText` with `Output.object()`** for all extraction tasks (not the deprecated `generateObject`).

2. **Define a library of Zod schemas** for each email extraction type:
   - `SupplierQuoteSchema` — pricing, MOQ, lead times
   - `OrderConfirmationSchema` — confirmed quantities, dates, tracking
   - `CounterOfferSchema` — revised terms, conditions
   - `ShippingNoticeSchema` — tracking numbers, ETAs
   - Generic `SupplierEmailClassificationSchema` — classify email type first, then extract with specific schema

3. **Use `.describe()` liberally** on Zod schema fields — these descriptions are sent to the LLM and significantly improve extraction quality.

4. **Leverage AI SDK 6 `ToolLoopAgent`** for the full agent loop:
   - Tool 1: `classifyEmail` — Determine email type
   - Tool 2: `extractStructuredData` — Extract with type-specific schema
   - Tool 3: `checkPolicies` — Validate against merchant guardrails
   - Tool 4: `draftReply` — Generate response
   - Final output: Structured `AgentDecision` object

5. **Add `needsApproval: true`** on the `sendEmail` tool for human-in-the-loop.

6. **Use `devToolsMiddleware`** in development for debugging extraction quality.

7. **Fallback strategy:** If Claude returns a refusal or hits max_tokens:
   - Retry with OpenAI (`gpt-4o`) via the same Zod schema
   - If both fail, escalate to human with the raw email text

8. **For complex business rule validation** (e.g., "quoted price must be within 10% of last order"), use Zod `.refine()` or `.superRefine()` — these run locally after the LLM response arrives:

```typescript
const ValidatedQuote = SupplierQuoteSchema.refine(
  (data) => data.unitPrice <= lastOrderPrice * 1.10,
  { message: 'Price exceeds 10% increase threshold — escalate to human' }
);
```

### Secondary Tool: Instructor-js (Optional)

Consider adding Instructor-js only if you encounter persistent extraction quality issues with specific email formats where the model gets the shape right but semantic values wrong. Instructor's retry-with-error-context pattern is valuable for edge cases like:
- Extracting prices when emails mix multiple currencies
- Parsing dates in varied international formats
- Disambiguating between quoted and confirmed quantities

This can be used selectively for specific extraction tasks rather than as the primary pipeline.

### What NOT to Use

- **LangChain/LangGraph:** Over-engineered for PO Pro's relatively linear agent workflow. Adds abstraction overhead without proportional benefit. Reconsider only if PO Pro evolves into a multi-agent system.
- **TypeChat:** Limited model support, no streaming, smaller community.
- **Outlines/LMQL/Guidance:** For self-hosted models only; irrelevant for API-hosted Claude/OpenAI.
- **Marvin:** Python-only.
- **CrewAI/AutoGen/Semantic Kernel:** Wrong language ecosystem.

---

## 7. Sources

### Vercel AI SDK
- [AI SDK Core: Generating Structured Data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6)
- [AI SDK 5 Announcement](https://vercel.com/blog/ai-sdk-5)
- [Structured Data Extraction — Vercel Academy](https://vercel.com/academy/ai-sdk/structured-data-extraction)
- [Migration Guide: SDK 5.x to 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
- [Structured Outputs with Vercel's AI SDK](https://www.aihero.dev/structured-outputs-with-vercel-ai-sdk)
- [LangChain vs Vercel AI SDK vs OpenAI SDK: 2026 Guide](https://strapi.io/blog/langchain-vs-vercel-ai-sdk-vs-openai-sdk-comparison-guide)

### Anthropic Claude Structured Outputs
- [Structured Outputs — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Get Structured Output from Agents — Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/structured-outputs)
- [A Hands-On Guide to Anthropic's New Structured Output Capabilities — TDS](https://towardsdatascience.com/hands-on-with-anthropics-new-structured-output-capabilities/)
- [Anthropic Boosts Claude API with Structured Outputs](https://ainativedev.io/news/anthropic-brings-structured-outputs-to-claude-developer-platform-making-api-responses-more-reliable)
- [Zero-Error JSON with Claude — Medium](https://medium.com/@meshuggah22/zero-error-json-with-claude-how-anthropics-structured-outputs-actually-work-in-real-code-789cde7aff13)
- [Extracting Structured JSON — Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook/blob/main/tool_use/extracting_structured_json.ipynb)

### Instructor
- [Instructor-JS GitHub](https://github.com/567-labs/instructor-js)
- [Instructor-JS Documentation](https://js.useinstructor.com/)
- [Why Use Instructor?](https://js.useinstructor.com/why/)
- [Instructor Multi-Language Overview](https://python.useinstructor.com/)

### LangChain / LangGraph
- [LangChain Structured Output Parsers](https://v03.api.js.langchain.com/classes/_langchain_core.output_parsers.StructuredOutputParser.html)
- [LangGraph Agent Orchestration Framework](https://www.langchain.com/langgraph)
- [Get Structured Output from LangGraph — Agentuity](https://agentuity.com/blog/langgraph-structured-output)
- [LangGraph Agents from Scratch (TypeScript)](https://github.com/langchain-ai/agents-from-scratch-ts)
- [LangChain vs Vercel AI SDK — TemplateHub](https://www.templatehub.dev/blog/langchain-vs-vercel-ai-sdk-a-developers-ultimate-guide-2561)

### OpenAI
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)

### Constrained Generation
- [Constrained Decoding: Grammar-Guided Generation](https://mbrenndoerfer.com/writing/constrained-decoding-structured-llm-output)
- [Outlines GitHub](https://github.com/dottxt-ai/outlines)
- [llguidance GitHub](https://github.com/guidance-ai/llguidance)
- [A Guide to Structured Outputs Using Constrained Decoding](https://www.aidancooper.co.uk/constrained-decoding/)

### TypeChat
- [TypeChat GitHub](https://github.com/microsoft/TypeChat)
- [TypeChat Introduction](https://microsoft.github.io/TypeChat/docs/introduction/)

### Agent Frameworks
- [Best AI Agent Frameworks 2025 — GetMaxim](https://www.getmaxim.ai/articles/top-5-ai-agent-frameworks-in-2025-a-practical-guide-for-ai-builders/)
- [CrewAI vs LangGraph vs AutoGen — DataCamp](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [AI Agent Framework Landscape 2025 — Medium](https://medium.com/@hieutrantrung.it/the-ai-agent-framework-landscape-in-2025-what-changed-and-what-matters-3cd9b07ef2c3)
- [Semantic Kernel + AutoGen = Microsoft Agent Framework](https://visualstudiomagazine.com/articles/2025/10/01/semantic-kernel-autogen--open-source-microsoft-agent-framework.aspx)
- [Semantic Kernel Agents GA Announcement](https://devblogs.microsoft.com/semantic-kernel/semantic-kernel-agents-are-now-generally-available/)

### Validation & Schemas
- [Zod Documentation](https://zod.dev/)
- [Schema Validation with Zod in 2025 — Turing](https://www.turing.com/blog/data-integrity-through-zod-validation)
- [Zod GitHub](https://github.com/colinhacks/zod)
