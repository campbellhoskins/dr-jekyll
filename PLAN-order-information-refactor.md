# Plan: Refactor to Structured OrderInformation Schema

## Context

The current agent accepts order data as a loose combination of:
- `OrderContext` (4 fields: skuName, supplierSku, quantityRequested, lastKnownPrice)
- Free-text `negotiationRules` and `escalationTriggers` strings
- Optional free-text `merchantInstructions` (classified by `InstructionClassifier`)

This means the LLM receives unstructured prose like "Accept if price <= $5.00, lead time < 45 days" and must parse it to make decisions. The new `OrderInformation` schema provides **structured, typed fields** for all negotiation parameters (pricing targets, lead time limits, payment terms, shipping, escalation thresholds, negotiation behavior). This gives the LLM clearer context and eliminates the need for the `InstructionClassifier`.

**Decision:** Full replacement. `OrderInformation` becomes the sole input. `InstructionClassifier` is removed.

---

## Phase 1: Define OrderInformation Types (types.ts)

**File:** `src/lib/agent/types.ts`

### 1a. Add the OrderInformation interface + Zod schema

Define the full `OrderInformation` interface with all 11 sections matching the user's spec. Also define supporting enums:

```typescript
type RelationshipTier = "preferred" | "standard" | "new";
type ShippingMethod = "sea" | "air" | "express";
type CounterPriceStrategy = "split_difference" | "anchor_low" | "target_only";
type NegotiationPriority = "price" | "lead_time" | "payment_terms" | "quantity";
type OrderType = "routine_reorder" | "initial_order" | "urgent_restock";
type UrgencyLevel = "standard" | "urgent";
```

Add a companion Zod schema `OrderInformationSchema` for runtime validation (used by CLI tools and future API endpoints).

### 1b. Remove `OrderContext` interface

Replace all references to `OrderContext` with `OrderInformation` throughout the codebase. The mapping:

| Old (OrderContext) | New (OrderInformation) |
|---|---|
| `skuName` | `product.productName` |
| `supplierSku` | `product.supplierProductCode` |
| `quantityRequested` | `quantity.targetQuantity` |
| `lastKnownPrice` | `pricing.lastKnownPrice` |
| `negotiationStyle` | Derived from `negotiation.*` |
| `specialInstructions` | `product.productDescription` + `product.packagingRequirements` + `metadata.orderNotes` |

### 1c. Update `AgentProcessRequest`

```typescript
interface AgentProcessRequest {
  supplierMessage: string;
  orderInformation: OrderInformation;     // Replaces orderContext + rules + triggers
  conversationHistory?: string;
  priorExtractedData?: Partial<ExtractedQuoteData>;
  turnNumber?: number;                     // For neverAcceptFirstOffer logic
}
```

Remove: `negotiationRules`, `escalationTriggers`, `orderContext`, `merchantInstructions`

### 1d. Remove InstructionClassifier types

Remove `ClassifiedInstructions`, `LLMInstructionClassificationSchema`, `INSTRUCTION_CLASSIFICATION_JSON_SCHEMA`.

### 1e. Keep ExtractedQuoteData unchanged

The extraction output schema stays the same - it represents what the supplier said, not the merchant's order.

---

## Phase 2: Prompt Serialization (the heart of the refactor)

**Files:** `src/lib/agent/prompts.ts`, `src/lib/agent/experts/prompts.ts`

The key design challenge: convert structured `OrderInformation` fields into rich prompt sections the LLM can reason about.

### 2a. Create `formatOrderInformation()` helper

New function that serializes `OrderInformation` into prompt-ready text. Replaces both `formatOrderContext()` and the free-text rules/triggers:

```
## Order Information

### Product
- Name: Bamboo Cutting Board - Medium (BCB-M-001)
- Merchant SKU: BCB-M-001
- Unit of Measure: per unit
- Required Certifications: CE, FDA
- Packaging: poly bag, 12 units/master carton

### Quantity
- Target: 500 units
- Minimum Acceptable: 300 units
- Maximum Acceptable: 800 units

### Pricing Rules
- Currency: USD
- Target Price: $3.80/unit (ideal — happy at this or below)
- Maximum Acceptable Price: $5.00/unit (hard ceiling — escalate if exceeded)
- Last Known Price: $4.25/unit (reference only)
- Never Counter Above: $5.00/unit

### Lead Time Rules
- Maximum Acceptable: 45 days
- Preferred: 30 days

### Payment Terms
- Required: Net 30
- Acceptable Alternatives: 50/50
- Maximum Upfront: 50%

### Shipping
- Required Incoterms: FOB
- Origin: Shenzhen → Destination: Los Angeles, CA
- Preferred Method: sea

### Negotiation Behavior
- Never Accept First Offer: true
- Max Negotiation Rounds: 3
- Counter Strategy: split_difference
- Priority Order: price > lead_time > payment_terms

### Escalation Triggers
- Price exceeds $5.00/unit (from pricing.maximumAcceptablePrice)
- Lead time exceeds 45 days (from leadTime.maximumLeadTimeDays)
- Upfront payment exceeds 50% (from paymentTerms.maximumUpfrontPercent)
- Custom: "escalate if supplier mentions exclusivity"
- Custom: "escalate if product spec is changed"

### Merchant
- Company: Acme Trading Co.
- Contact: John Smith (john@acme.com)
- PO Number: PO-2026-001
- Order Type: routine_reorder (standard urgency)
- Notes: Need blue color variant
```

### 2b. Create `formatEscalationTriggers()` helper

For the escalation expert, derive trigger text from structured fields:
- `pricing.maximumAcceptablePrice` → "Price exceeds $X/unit"
- `leadTime.maximumLeadTimeDays` → "Lead time exceeds X days"
- `quantity.maximumAcceptableQuantity` → "Quantity exceeds X units" (if supplier MOQ > our max)
- `paymentTerms.maximumUpfrontPercent` → "Upfront payment exceeds X%"
- `escalation.additionalTriggers[]` → Pass through as-is (free-text custom triggers)

### 2c. Create `formatNegotiationRules()` helper

For the orchestrator, derive rules text from structured fields:
- Pricing: "Target price $X. Accept at or below $Y. Never counter above $Z."
- Lead time: "Maximum X days. Prefer Y days."
- Payment: "Required terms: Net 30. Accept alternatives: 50/50."
- Quantity: "Target X units. Acceptable range: Y-Z."
- Behavior: "Never accept first offer. Max N rounds. Strategy: split_difference."

### 2d. Update all prompt builder functions

| Function | Change |
|---|---|
| `buildExtractionPrompt()` | No change (extraction sees only supplier message) |
| `buildEscalationPrompt()` | Replace `escalationTriggers: string` with `OrderInformation`; use `formatEscalationTriggers()` |
| `buildNeedsPrompt()` | Replace partial `orderContext` with full `OrderInformation`; use `formatNegotiationRules()` |
| `buildOrchestratorPrompt()` | Replace `OrderContext` + `classifiedInstructions` with `OrderInformation`; use `formatOrderInformation()` |
| `buildCounterOfferCrafterPrompt()` | Use `OrderInformation` for full context; respect `neverCounterAbove`, `counterPriceStrategy` |
| `buildClarificationCrafterPrompt()` | Use `OrderInformation` |
| `buildInitialEmailPrompt()` | Use `OrderInformation` (merchant/supplier/product/quantity/shipping) |
| `buildInstructionClassificationPrompt()` | **DELETE** |
| `buildPolicyDecisionPrompt()` | Already superseded by orchestrator; update if still used |

### 2e. Update orchestrator system prompt

The orchestrator prompt needs updates to reference structured fields:
- "## Pricing Rules" section replaces free-text negotiation rules
- "## Escalation Triggers" derived from structured thresholds + custom triggers
- "## Negotiation Behavior" section (neverAcceptFirstOffer, maxRounds, strategy)
- Add context about `turnNumber` for neverAcceptFirstOffer logic

---

## Phase 3: Pipeline & Orchestrator Refactor

**Files:** `src/lib/agent/pipeline.ts`, `src/lib/agent/orchestrator.ts`

### 3a. Update `AgentPipeline.process()`

- Accept `AgentProcessRequest` with `orderInformation` field
- Remove Stage 0 (InstructionClassifier) entirely
- Pass `orderInformation` directly to orchestrator and response crafter
- Update `generateInitialEmail()` to accept `OrderInformation`

### 3b. Update `Orchestrator.run()`

Signature changes from:
```typescript
run(supplierMessage, orderContext, classifiedInstructions, conversationHistory?, priorExtractedData?)
```
To:
```typescript
run(supplierMessage, orderInformation, conversationHistory?, priorExtractedData?, turnNumber?)
```

- Pass `orderInformation` to escalation expert (derives triggers from structured fields)
- Pass `orderInformation` to needs expert (has full pricing/quantity context)
- Pass `orderInformation` to orchestrator prompt

### 3c. Update expert inputs

In `src/lib/agent/experts/types.ts`:

- `EscalationExpertInput`: Replace `escalationTriggers: string` + `orderContext: { skuName, supplierSku }` with `orderInformation: OrderInformation`
- `NeedsExpertInput`: Replace `negotiationRules: string` + `orderContext: { skuName, supplierSku, quantityRequested }` with `orderInformation: OrderInformation`
- `ResponseCrafterInput`: Replace `orderContext: OrderContext` + `specialInstructions?: string` with `orderInformation: OrderInformation`
- `ExtractionExpertInput`: **No change** (extraction is independent of order context)

### 3d. Delete InstructionClassifier

Remove `src/lib/agent/instruction-classifier.ts` entirely.

---

## Phase 4: Update Scenario Fixtures

**Files:** All 8 JSON files in `tests/fixtures/scenarios/`

Convert each scenario from:
```json
{
  "negotiationRules": "Accept if price <= $5.00...",
  "escalationTriggers": "Escalate if MOQ > 1000...",
  "orderContext": { "skuName": "...", "supplierSku": "...", ... }
}
```

To:
```json
{
  "orderInformation": {
    "merchant": { "merchantId": "m1", "merchantName": "Test Merchant", ... },
    "supplier": { "supplierName": "Test Supplier", ... },
    "product": { "productName": "Bamboo Cutting Board", "supplierProductCode": "BCB-M-001", ... },
    "pricing": { "targetPrice": 4.50, "maximumAcceptablePrice": 5.00, ... },
    "quantity": { "targetQuantity": 500, ... },
    "leadTime": { "maximumLeadTimeDays": 45, ... },
    "escalation": { "additionalTriggers": ["Escalate if supplier mentions discontinuation"] },
    "negotiation": { "neverAcceptFirstOffer": false, ... },
    ...
  }
}
```

Each scenario's free-text rules need to be decomposed into the correct structured fields. For example, `counter-price-high.json`'s rule "Target price is $3.80, acceptable range $3.50-$4.20" becomes `pricing: { targetPrice: 3.80, maximumAcceptablePrice: 4.20 }`.

---

## Phase 5: Update CLI Tools

**Files:** `src/cli/chat.ts`, `src/cli/pipeline.ts`, `src/cli/display.ts`, `src/cli/test-session.ts`

### 5a. `pipeline.ts`
- Update `ScenarioFile` interface to use `orderInformation: OrderInformation`
- Build `AgentProcessRequest` from new scenario format

### 5b. `chat.ts`
- Update `SessionConfig` to use `orderInformation: OrderInformation`
- Update `promptForConfig()` to build an `OrderInformation` object from interactive input (product, pricing, lead time, etc.)
- Update `loadScenarioConfig()` to read new scenario format
- Build `AgentProcessRequest` with `orderInformation`

### 5c. `display.ts`
- Update display functions to show structured order information fields

### 5d. `test-session.ts`
- Same pattern as pipeline.ts

---

## Phase 6: Update Tests

### 6a. Unit Tests — Update mocks

Every unit test that creates an `AgentProcessRequest` or `OrderContext` needs to use `OrderInformation`. Create a **test helper** `buildTestOrderInformation(overrides?)` that returns a complete `OrderInformation` with sensible defaults, allowing tests to override specific fields:

```typescript
function buildTestOrderInformation(overrides?: DeepPartial<OrderInformation>): OrderInformation {
  return deepMerge({
    merchant: { merchantId: "test-m1", merchantName: "Test Merchant", contactEmail: "test@example.com", contactName: "Test Contact" },
    supplier: { supplierName: "Test Supplier", ... },
    product: { merchantSKU: "TEST-SKU", supplierProductCode: "TST-001", productName: "Test Product", ... },
    pricing: { currency: "USD", targetPrice: 4.00, maximumAcceptablePrice: 5.00, lastKnownPrice: 4.25, neverCounterAbove: 5.00 },
    quantity: { targetQuantity: 500, minimumAcceptableQuantity: 200, maximumAcceptableQuantity: 1000 },
    ...
  }, overrides);
}
```

**Files to update:**
- `tests/unit/agent/pipeline.test.ts` - Update all mock requests
- `tests/unit/agent/orchestrator.test.ts` - Update orchestrator inputs
- `tests/unit/agent/prompts.test.ts` - Update prompt builder calls
- `tests/unit/agent/response-generator.test.ts` - Update response generator inputs
- `tests/unit/agent/experts/extraction.test.ts` - Minimal change (extraction is independent)
- `tests/unit/agent/experts/escalation.test.ts` - Update escalation inputs
- `tests/unit/agent/experts/needs.test.ts` - Update needs inputs
- `tests/unit/agent/experts/response-crafter.test.ts` - Update crafter inputs
- `tests/unit/agent/extractor.test.ts` - Minimal change
- `tests/unit/agent/output-parser.test.ts` - Minimal change
- Remove test for InstructionClassifier (if one exists)

### 6b. Live Integration Tests

- `tests/integration/agent/live-extraction.test.ts` - Minimal change
- `tests/integration/agent/live-pipeline.test.ts` - Update scenario data to OrderInformation
- `tests/integration/agent/live-structured.test.ts` - Update scenario data

---

## Phase 7: Cleanup

- Delete `src/lib/agent/instruction-classifier.ts`
- Remove `ClassifiedInstructions` and related types from `types.ts`
- Remove `INSTRUCTION_CLASSIFICATION_JSON_SCHEMA` from `types.ts`
- Remove `buildInstructionClassificationPrompt` from `prompts.ts`
- Remove any unit test for InstructionClassifier
- Update `src/lib/agent/conversation-context.ts` if it references `OrderContext`

---

## Implementation Order

Execute in this order to maintain a working test suite at each step:

1. **Phase 1** — Define `OrderInformation` type + Zod schema in `types.ts` (additive, nothing breaks)
2. **Phase 2** — Add new prompt serialization helpers alongside existing ones (additive)
3. **Phase 6a** — Create test helper `buildTestOrderInformation()` (additive)
4. **Phase 3** — Refactor pipeline + orchestrator + experts to accept `OrderInformation` (breaking change — update tests simultaneously)
5. **Phase 4** — Convert all 8 scenario fixtures
6. **Phase 5** — Update CLI tools
7. **Phase 6b** — Update live integration tests
8. **Phase 7** — Delete InstructionClassifier and dead code

---

## Verification

1. `npm test` — All 110 unit tests pass
2. `npm run typecheck` — No TypeScript errors
3. `npm run lint` — No linting errors
4. `npm run test:live` — All 21 live integration tests pass (requires ANTHROPIC_API_KEY)
5. `npm run pipeline -- --all-scenarios --verbose` — All 8 scenarios produce expected actions
6. `npm run chat` — Interactive session works with new OrderInformation input flow
