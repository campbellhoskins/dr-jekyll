import { AgentPipeline } from "@/lib/agent/pipeline";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { LLMRequest } from "@/lib/llm/types";
import type { AgentProcessRequest } from "@/lib/agent/types";
import { buildTestOrderInformation } from "../../helpers/order-information";

/**
 * Routing mock: inspects outputSchema.name to return the correct response.
 * Supports parallel expert calls and sequential orchestrator iterations.
 */
function createRoutingMockLLMService(
  responses: Record<string, string | Error | ((callIndex: number) => string | Error)>
): LLMService {
  const callCounts: Record<string, number> = {};
  return {
    call: jest.fn(async (req: LLMRequest): Promise<LLMServiceResult> => {
      const schemaName = req.outputSchema?.name ?? "unknown";
      callCounts[schemaName] = (callCounts[schemaName] ?? 0) + 1;
      const respOrFn = responses[schemaName];
      if (respOrFn === undefined) throw new Error(`No mock response for schema: ${schemaName}`);
      const resp = typeof respOrFn === "function" ? respOrFn(callCounts[schemaName]) : respOrFn;
      if (resp instanceof Error) throw resp;
      return {
        response: {
          content: resp,
          provider: "claude",
          model: "claude-3-haiku-20240307",
          inputTokens: 200,
          outputTokens: 100,
          latencyMs: 200,
        },
        attempts: [{ provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 200, success: true }],
      };
    }),
  } as unknown as LLMService;
}

// ─── Mock LLM responses ─────────────────────────────────────────────────────

const GOOD_EXTRACTION = JSON.stringify({
  quotedPrice: 4.5,
  quotedPriceCurrency: "USD",
  moq: 500,
  leadTimeMinDays: 25,
  leadTimeMaxDays: 30,
  paymentTerms: "30% deposit",
  confidence: 0.95,
  notes: [],
});

const NO_ESCALATION = JSON.stringify({
  shouldEscalate: false,
  reasoning: "MOQ 500 is within threshold of 1000.",
  triggersEvaluated: ["MOQ exceeds 1000"],
  triggeredTriggers: [],
  severity: "low",
});

const ACCEPT_DECISION = JSON.stringify({
  readyToAct: true,
  action: "accept",
  reasoning: "All rules satisfied at $4.50",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const COUNTER_DECISION = JSON.stringify({
  readyToAct: true,
  action: "counter",
  reasoning: "Price $4.50 exceeds max $4.20",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: { targetPrice: 3.8 },
});

const ESCALATION_TRIGGERED = JSON.stringify({
  shouldEscalate: true,
  reasoning: "MOQ 2000 exceeds trigger threshold of 1000.",
  triggersEvaluated: ["MOQ exceeds 1000"],
  triggeredTriggers: ["MOQ exceeds 1000"],
  severity: "high",
});

const ESCALATE_DECISION = JSON.stringify({
  readyToAct: true,
  action: "escalate",
  reasoning: "Escalation trigger fired: MOQ exceeds 1000",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const COUNTER_EMAIL = JSON.stringify({
  emailText: "We were hoping for $3.80 per unit.",
  proposedTermsSummary: "Counter at $3.80/unit",
});

const LOW_CONFIDENCE_EXTRACTION = JSON.stringify({
  quotedPrice: null,
  quotedPriceCurrency: "USD",
  confidence: 0.15,
  notes: ["No pricing data found"],
});

const ESCALATE_LOW_CONFIDENCE = JSON.stringify({
  readyToAct: true,
  action: "escalate",
  reasoning: "Extraction confidence too low to evaluate",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const HIGH_MOQ_EXTRACTION = JSON.stringify({
  quotedPrice: 4.5,
  quotedPriceCurrency: "USD",
  moq: 2000,
  leadTimeMinDays: 25,
  leadTimeMaxDays: 30,
  paymentTerms: "30% deposit",
  confidence: 0.95,
  notes: [],
});

const DISCONTINUED_EXTRACTION = JSON.stringify({
  quotedPrice: null,
  quotedPriceCurrency: "USD",
  confidence: 0.8,
  notes: ["Supplier mentioned product discontinuation"],
});

const DISCONTINUED_ESCALATION = JSON.stringify({
  shouldEscalate: true,
  reasoning: "Supplier indicated product discontinuation.",
  triggersEvaluated: ["Product discontinuation"],
  triggeredTriggers: ["Product discontinuation"],
  severity: "critical",
});

const ESCALATE_DISCONTINUED = JSON.stringify({
  readyToAct: true,
  action: "escalate",
  reasoning: "Supplier indicated: product discontinuation",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const CLARIFY_DECISION = JSON.stringify({
  readyToAct: true,
  action: "clarify",
  reasoning: "Insufficient data to evaluate - no price provided",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const CLARIFY_EMAIL = JSON.stringify({
  emailText: "Could you please provide your pricing?",
  proposedTermsSummary: "Asking for unit price",
});

const baseRequest: AgentProcessRequest = {
  supplierMessage: "Price is $4.50 per unit, MOQ 500, lead time 25-30 days.",
  orderInformation: buildTestOrderInformation({
    product: { productName: "Bamboo Cutting Board", supplierProductCode: "BCB-001", merchantSKU: "BCB-001" },
    pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00, lastKnownPrice: 4.25 },
    quantity: { targetQuantity: 500 },
    escalation: { additionalTriggers: ["Escalate if MOQ exceeds 1000 units"] },
  }),
};

describe("AgentPipeline", () => {
  it("acceptable quote flows through all stages -> action=accept", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("accept");
    expect(result.proposedApproval).toBeDefined();
    expect(result.proposedApproval!.price).toBe(4.5);
    expect(result.policyEvaluation.complianceStatus).toBe("compliant");
  });

  it("price too high -> action=counter with draftEmail", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: COUNTER_DECISION,
      generate_counter_offer: COUNTER_EMAIL,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("counter");
    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail).toContain("$3.80");
  });

  it("extraction fails -> orchestrator sees failure and escalates", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: new Error("All LLM providers failed"),
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ESCALATE_DECISION,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toBeTruthy();
  });

  it("low confidence -> orchestrator escalates", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: LOW_CONFIDENCE_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ESCALATE_LOW_CONFIDENCE,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toContain("confidence");
  });

  it("discontinuation note -> escalation via LLM experts", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: DISCONTINUED_EXTRACTION,
      evaluate_escalation: DISCONTINUED_ESCALATION,
      orchestrate_decision: ESCALATE_DISCONTINUED,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toContain("discontinu");
  });

  it("escalation trigger fires -> action=escalate despite good extraction", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: HIGH_MOQ_EXTRACTION,
      evaluate_escalation: ESCALATION_TRIGGERED,
      orchestrate_decision: ESCALATE_DECISION,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toContain("MOQ");
  });

  it("ambiguous response -> action=clarify with clarificationEmail", async () => {
    const ambiguousExtraction = JSON.stringify({
      quotedPrice: null,
      quotedPriceCurrency: "USD",
      confidence: 0.4,
      notes: ["Supplier asked for specifications before quoting"],
    });
    const service = createRoutingMockLLMService({
      extract_quote: ambiguousExtraction,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: CLARIFY_DECISION,
      generate_clarification: CLARIFY_EMAIL,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("clarify");
    expect(result.clarificationEmail).toBeTruthy();
  });

  it("response includes policyEvaluation object for backward compatibility", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.policyEvaluation).toBeDefined();
    expect(result.policyEvaluation.complianceStatus).toBe("compliant");
    expect(result.policyEvaluation.details).toBeTruthy();
  });

  it("response includes extractedData from extraction stage", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.extractedData).not.toBeNull();
    expect(result.extractedData!.quotedPrice).toBe(4.5);
    expect(result.extraction.confidence).toBe(0.95);
  });

  it("response includes new orchestration observability fields", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.expertOpinions).toBeDefined();
    expect(result.expertOpinions!.length).toBe(2); // extraction + escalation
    expect(result.orchestratorTrace).toBeDefined();
    expect(result.orchestratorTrace!.totalIterations).toBe(1);
    expect(result.totalLLMCalls).toBeGreaterThan(0);
  });

  it("orchestrator LLM failure -> escalation safety valve", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: new Error("Orchestrator failed"),
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
  });

  it("response generator LLM failure -> escalation fallback in response", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: COUNTER_DECISION,
      generate_counter_offer: new Error("Response gen failed"),
    });
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    // Still counter action, but with escalation reason since email gen failed
    expect(result.action).toBe("counter");
    expect(result.escalationReason).toContain("failed");
    expect(result.counterOffer).toBeUndefined();
  });
});
