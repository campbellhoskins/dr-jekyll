# Multi-Agent Orchestration Refactor

## Context

The current agent pipeline uses deterministic guardrails (`decision-engine.ts`) that override LLM decisions with regex-parsed thresholds, hardcoded keyword lists, and confidence checks. This locks in today's model weaknesses as permanent architecture. The refactor replaces all deterministic decision-making with a multi-agent orchestration system where specialized LLM "experts" provide opinions and an orchestrator LLM synthesizes them into a final decision. As models improve, the system automatically gets better — no code changes needed.

## Architecture

```
Supplier Message Arrives
         │
         ▼
┌─────────────────────┐
│ Instruction          │  (unchanged — already LLM)
│ Classifier           │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│        PARALLEL FAN-OUT (Promise.all)     │
│                                           │
│  ┌──────────────┐  ┌──────────────┐        │
│  │  Extraction  │  │  Escalation  │        │
│  │  Expert      │  │  Expert      │        │
│  └──────────────┘  └──────────────┘        │
│                                            │
│  ┌──────────────┐  (called on-demand       │
│  │  Needs       │   by orchestrator when   │
│  │  Expert      │   info gaps detected)    │
│  └──────────────┘                          │
└──────────────────────┬───────────────────┘
                       │ all opinions
                       ▼
              ┌─────────────────┐
              │  ORCHESTRATOR   │◄──┐
              │  (LLM decides)  │   │ loop: re-consult
              └────────┬────────┘───┘ an expert if needed
                       │ action decided
                       ▼
              ┌─────────────────┐
              │ Response Crafter│
              │ (draft output)  │
              └─────────────────┘
```

Each expert = same model, different focused system prompt. The orchestrator loops until it has enough information, then decides. Code never overrides the LLM.

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/agent/experts/types.ts` | Per-expert input types, opinion interfaces, analysis shapes |
| `src/lib/agent/experts/prompts.ts` | Prompts for 3 experts + orchestrator + response crafter |
| `src/lib/agent/experts/extraction.ts` | Wraps existing `Extractor` in Expert interface |
| `src/lib/agent/experts/escalation.ts` | NEW: evaluates escalation triggers via LLM |
| `src/lib/agent/experts/needs.ts` | NEW: identifies info gaps + what to ask the supplier |
| `src/lib/agent/experts/response-crafter.ts` | Refactored from `response-generator.ts` |
| `src/lib/agent/orchestrator.ts` | NEW: receives opinions, decides action, can re-consult |
| `tests/unit/agent/experts/extraction.test.ts` | Unit tests for extraction expert |
| `tests/unit/agent/experts/escalation.test.ts` | Unit tests for escalation expert |
| `tests/unit/agent/experts/needs.test.ts` | Unit tests for needs expert |
| `tests/unit/agent/experts/response-crafter.test.ts` | Unit tests for response crafter |
| `tests/unit/agent/orchestrator.test.ts` | Unit tests for orchestrator |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/agent/pipeline.ts` | Refactor to use Orchestrator + Experts instead of DecisionEngine + PolicyEvaluator |
| `src/lib/agent/types.ts` | Add `expertOpinions`, `orchestratorTrace`, observability totals to `AgentProcessResponse` |
| `src/lib/agent/prompts.ts` | Keep instruction classification + initial email prompts only; extraction/policy/counter/clarify prompts move to `experts/prompts.ts` |
| `tests/unit/agent/pipeline.test.ts` | Rewrite for new orchestration flow (same behavioral assertions) |
| `tests/integration/agent/live-pipeline.test.ts` | Update for new response shape (same expected actions) |
| `src/cli/pipeline.ts` | Show expert opinions + orchestrator trace in verbose mode |
| `src/cli/chat.ts` | Update trace output format |
| `src/cli/test-session.ts` | Update trace output format |

## Files to Delete

| File | Reason |
|------|--------|
| `src/lib/agent/decision-engine.ts` | Entirely deterministic — replaced by escalation expert + orchestrator |
| `src/lib/agent/policy-evaluator.ts` | Replaced by orchestrator (holistic policy reasoning from all expert opinions) |
| `tests/unit/agent/decision-engine.test.ts` | Tests removed code |
| `tests/unit/agent/policy-evaluator.test.ts` | Tests removed code |

## Files Preserved Unchanged

- `src/lib/agent/extractor.ts` — core extraction logic reused by ExtractionExpert wrapper
- `src/lib/agent/output-parser.ts` — all parsing logic stays
- `src/lib/agent/instruction-classifier.ts` — unchanged
- `src/lib/agent/conversation-context.ts` — unchanged
- `src/lib/llm/service.ts` — unchanged
- `src/lib/llm/claude-provider.ts` — unchanged
- All fixture files — same scenarios, same expected results

## Key Design Details

### Principle: Tailored Expert Inputs

**Each expert receives ONLY the information relevant to its specific job.** Including irrelevant context can bias an expert's judgment or degrade its performance. For example, the extraction expert should never see merchant negotiation rules — knowing the merchant's target price could bias it toward interpreting ambiguous numbers as matching that target. Each expert has its own typed input.

### Expert Inputs (each expert gets different data)

**Extraction Expert** — only raw data, no merchant strategy:
```typescript
interface ExtractionExpertInput {
  supplierMessage: string;           // the email to extract from
  conversationHistory?: string;      // prior emails for context
  priorExtractedData?: Partial<ExtractedQuoteData>;  // carry-forward from prior turns
  additionalQuestion?: string;       // for re-consultation by orchestrator
}
```
Does NOT receive: negotiation rules, escalation triggers, merchant instructions, order context prices. This keeps extraction unbiased — it reports what the supplier said, not what the merchant wants to hear.

**Escalation Expert** — triggers + supplier message + extracted data:
```typescript
interface EscalationExpertInput {
  supplierMessage: string;           // the email to evaluate
  conversationHistory?: string;      // for context on what's being discussed
  escalationTriggers: string;        // the merchant's trigger conditions
  extractedData?: ExtractedQuoteData; // so it can evaluate numeric triggers
  orderContext: {                    // minimal: what product we're ordering
    skuName: string;
    supplierSku: string;
  };
  additionalQuestion?: string;       // for re-consultation
}
```
Does NOT receive: negotiation rules, special instructions, target prices, last known price. The escalation expert's job is purely "does a trigger condition fire?" — it should not weigh whether the deal is "good" or "bad" overall.

**Needs Expert** — extraction results + rules, identifies what's missing:
```typescript
interface NeedsExpertInput {
  extractedData: ExtractedQuoteData | null;  // what we know so far
  negotiationRules: string;          // so it knows what fields matter for this deal
  orderContext: {                    // what we're trying to buy
    skuName: string;
    supplierSku: string;
    quantityRequested: string;
  };
  conversationHistory?: string;      // what's already been discussed
  additionalQuestion?: string;       // for re-consultation
}
```
Does NOT receive: escalation triggers, merchant target prices, special instructions. Its job is purely "what information gaps exist and what are the most important things to ask for?" It sees the rules so it knows which fields actually matter (e.g., if rules mention lead time, missing lead time is a gap; if rules don't mention payment terms, missing payment terms is less critical). The orchestrator calls this expert when it sees extraction gaps and needs precise guidance for the response crafter.

**Orchestrator** — gets EVERYTHING (the only agent with the full picture):
```typescript
interface OrchestratorInput {
  supplierMessage: string;
  conversationHistory?: string;
  orderContext: OrderContext;         // full order context including prices
  classifiedInstructions: ClassifiedInstructions;  // rules + triggers + special
  expertOpinions: ExpertOpinion[];    // all expert outputs
  priorOrchestratorDecisions: OrchestratorDecision[];  // trace so far (for loops)
}
```
The orchestrator is the ONLY component that sees negotiation rules, pricing targets, and expert opinions together. It's the decision-maker — it needs the full picture.

**Response Crafter** — decision + context for drafting, no raw rules:
```typescript
interface ResponseCrafterInput {
  action: AgentAction;               // what to do
  reasoning: string;                 // why (from orchestrator)
  extractedData: ExtractedQuoteData | null;
  orderContext: OrderContext;
  conversationHistory?: string;
  specialInstructions?: string;      // product specs for the email
  counterTerms?: CounterTerms;       // if counter, what to propose
  needsAnalysis?: NeedsAnalysis;     // if clarify, exactly what to ask for
}
```
Does NOT receive: raw negotiation rules, escalation triggers. It gets the orchestrator's decision and drafts the response — it doesn't need to re-evaluate the decision. When the action is "clarify", the `needsAnalysis` tells the crafter exactly what information gaps to ask about and in what priority order.

### Expert Interface

Each expert has its own `analyze` method with its own typed input — there is no shared `ExpertInput` type:

```typescript
interface ExtractionExpert {
  name: "extraction";
  analyze(input: ExtractionExpertInput): Promise<ExpertOpinion>;
}

interface EscalationExpert {
  name: "escalation";
  analyze(input: EscalationExpertInput): Promise<ExpertOpinion>;
}

interface NeedsExpert {
  name: "needs";
  analyze(input: NeedsExpertInput): Promise<ExpertOpinion>;
}
```

Every expert returns the same `ExpertOpinion` output shape (typed `analysis` payload + LLM observability metadata). The pipeline constructs each expert's tailored input from the available data.

### Orchestrator Loop

```typescript
// Pseudocode — pipeline constructs tailored inputs per expert

// Step 1: Initial parallel fan-out (extraction + escalation run simultaneously)
const [extractionOpinion, escalationOpinion] = await Promise.all([
  extractionExpert.analyze({ supplierMessage, conversationHistory, priorExtractedData }),
  escalationExpert.analyze({ supplierMessage, conversationHistory, escalationTriggers, orderContext: { skuName, supplierSku } }),
]);

const opinions = [extractionOpinion, escalationOpinion];

// Step 2: Orchestrator loop
for (let i = 0; i < MAX_ITERATIONS; i++) {
  const decision = await llm.call(buildOrchestratorPrompt(fullContext, opinions));
  if (decision.readyToAct) return decision;

  // Re-consult — orchestrator can call any expert, e.g.:
  // "needs" expert when extraction has gaps → returns prioritized questions
  // "extraction" expert with a follow-up question
  // "escalation" expert to re-evaluate after new info
  const followUp = await callExpertWithTailoredInput(decision.nextExpert, decision.questionForExpert);
  opinions.push(followUp);
}
return escalate; // safety valve — prevents infinite loops from bugs

// Step 3: Response crafter receives orchestrator decision + needs analysis (if any)
// If orchestrator decided "clarify", the needs expert's prioritizedQuestions
// are passed to the response crafter so it knows exactly what to ask for
```

MAX_ITERATIONS = 10 (a bug-prevention safety valve, not a decision override).

### Expert-Specific Analysis Shapes

**ExtractionAnalysis**: `{ extractedData, confidence, notes, success, error }`
**EscalationAnalysis**: `{ shouldEscalate, reasoning, triggersEvaluated, triggeredTriggers, severity }`
**NeedsAnalysis**: `{ missingFields, prioritizedQuestions, reasoning }`

### Orchestrator Output

```typescript
{
  readyToAct: boolean,
  action: "accept" | "counter" | "escalate" | "clarify" | null,
  reasoning: string,
  nextExpert: string | null,        // for re-consultation
  questionForExpert: string | null,  // specific follow-up
  counterTerms: { targetPrice?, targetQuantity?, otherTerms? } | null
}
```

### Mock Strategy for Tests

Since experts run in parallel, sequential mock won't work. Use a **routing mock** that inspects `outputSchema.name` to return the correct response:

```typescript
function createRoutingMockLLMService(responses: Record<string, string>) {
  return { call: jest.fn(async (req) => {
    const schemaName = req.outputSchema?.name ?? "unknown";
    return { response: { content: responses[schemaName], ... }, attempts: [...] };
  })};
}
```

Each prompt gets a unique schema name: `"extract_quote"`, `"evaluate_escalation"`, `"analyze_needs"`, `"orchestrate_decision"`, `"generate_counter_offer"`, `"generate_clarification"`.

### Backward Compatibility

`AgentProcessResponse` keeps all existing fields. Deprecated fields (`extraction`, `policyEvaluation`, `responseGeneration`) are computed from the new expert opinions and orchestrator trace. No callers break. New fields (`expertOpinions`, `orchestratorTrace`, `totalLLMCalls`, etc.) are added.

## Implementation Order

### Phase 1: Types (no behavioral changes)
1. Create `src/lib/agent/experts/types.ts`
2. Add new optional fields to `AgentProcessResponse` in `types.ts`
3. `npm test` — all existing tests still pass

### Phase 2: Expert Prompts
4. Create `src/lib/agent/experts/prompts.ts` with all prompt builders + JSON schemas

### Phase 3: Experts (each independently testable)
5. Create extraction expert + tests → `npm test`
6. Create escalation expert + tests → `npm test`
7. Create needs expert + tests → `npm test`

### Phase 4: Orchestrator
8. Create orchestrator + tests → `npm test`

### Phase 5: Response Crafter
9. Create response crafter + tests → `npm test`

### Phase 6: Pipeline Integration (the big switch)
10. Refactor `pipeline.ts` to use orchestrator + experts
11. Rewrite `pipeline.test.ts` — same behavioral outcomes, new mock structure
12. `npm test` — all unit tests pass

### Phase 7: Live Tests
13. Update `live-pipeline.test.ts` for new response shape
14. `npm run test:live` — all 8 live scenarios match expected actions

### Phase 8: Cleanup
15. Delete `decision-engine.ts`, `policy-evaluator.ts`, and their tests
16. Update exports in `index.ts`
17. `npm test` — no broken imports

### Phase 9: CLI Tools
18. Update verbose output in `pipeline.ts`, `chat.ts`, `test-session.ts`
19. `npm run pipeline -- --all-scenarios --verbose` — smoke test

## Verification

1. `npm test` — all unit tests pass (count should be similar: ~106, minus ~31 from deleted tests, plus ~40+ from new expert/orchestrator tests)
2. `npm run test:live` — all 8 live scenarios produce the same expected actions as before
3. `npm run pipeline -- --all-scenarios` — all scenarios match expected actions
4. `npm run pipeline -- --all-scenarios --verbose` — expert opinions and orchestrator trace display correctly
5. No imports of `decision-engine` or `policy-evaluator` remain in the codebase
6. `npm run lint && npm run typecheck` — clean
