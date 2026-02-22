import { AgentPipeline } from "@/lib/agent/pipeline";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { LLMRequest } from "@/lib/llm/types";
import type { AgentProcessRequest } from "@/lib/agent/types";

// Track call count to return different responses for extraction vs policy vs response gen
function createSequentialMockLLMService(
  responses: Array<string | Error>
): LLMService {
  let callIndex = 0;
  return {
    call: jest.fn(async (): Promise<LLMServiceResult> => {
      const resp = responses[callIndex++];
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

const COMPLIANT_POLICY = JSON.stringify({
  rulesMatched: ["price within range"],
  complianceStatus: "compliant",
  recommendedAction: "accept",
  reasoning: "All rules satisfied at $4.50",
  escalationTriggered: false,
});

const NON_COMPLIANT_COUNTER_POLICY = JSON.stringify({
  rulesMatched: ["price range $3.50-$4.20"],
  complianceStatus: "non_compliant",
  recommendedAction: "counter",
  reasoning: "Price $4.50 exceeds max $4.20",
  escalationTriggered: false,
  counterTerms: { targetPrice: 3.8 },
});

const ESCALATION_POLICY = JSON.stringify({
  rulesMatched: ["MOQ limit"],
  complianceStatus: "non_compliant",
  recommendedAction: "escalate",
  reasoning: "MOQ 2000 exceeds trigger of 1000",
  escalationTriggered: true,
  escalationReason: "MOQ exceeds 1000 units",
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

const CLARIFY_POLICY = JSON.stringify({
  rulesMatched: [],
  complianceStatus: "partial",
  recommendedAction: "clarify",
  reasoning: "Insufficient data to evaluate - no price provided",
  escalationTriggered: false,
});

const CLARIFY_EMAIL = JSON.stringify({
  emailText: "Could you please provide your pricing?",
  proposedTermsSummary: "Asking for unit price",
});

const baseRequest: AgentProcessRequest = {
  supplierMessage: "Price is $4.50 per unit, MOQ 500, lead time 25-30 days.",
  negotiationRules: "Accept below $5. Lead time under 45 days.",
  escalationTriggers: "Escalate if MOQ > 1000.",
  orderContext: {
    skuName: "Bamboo Cutting Board",
    supplierSku: "BCB-001",
    quantityRequested: "500",
    lastKnownPrice: 4.25,
  },
};

describe("AgentPipeline", () => {
  it("acceptable quote flows through all stages -> action=accept", async () => {
    const service = createSequentialMockLLMService([GOOD_EXTRACTION, COMPLIANT_POLICY]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("accept");
    expect(result.proposedApproval).toBeDefined();
    expect(result.proposedApproval!.price).toBe(4.5);
    expect(result.policyEvaluation.complianceStatus).toBe("compliant");
  });

  it("price too high -> action=counter with draftEmail", async () => {
    const service = createSequentialMockLLMService([
      GOOD_EXTRACTION,
      NON_COMPLIANT_COUNTER_POLICY,
      COUNTER_EMAIL,
    ]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("counter");
    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail).toContain("$3.80");
  });

  it("extraction fails -> immediate escalation (no policy eval call)", async () => {
    const service = createSequentialMockLLMService([
      new Error("All LLM providers failed"),
    ]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(service.call).toHaveBeenCalledTimes(1); // Only extraction call
    expect(result.escalationReason).toContain("Extraction failed");
  });

  it("low confidence -> immediate escalation (no policy eval call)", async () => {
    const service = createSequentialMockLLMService([LOW_CONFIDENCE_EXTRACTION]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(service.call).toHaveBeenCalledTimes(1);
    expect(result.escalationReason).toContain("confidence");
  });

  it("discontinuation note -> immediate escalation", async () => {
    const service = createSequentialMockLLMService([DISCONTINUED_EXTRACTION]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(service.call).toHaveBeenCalledTimes(1);
    expect(result.escalationReason).toContain("discontinu");
  });

  it("escalation trigger fires -> action=escalate despite good extraction", async () => {
    const service = createSequentialMockLLMService([HIGH_MOQ_EXTRACTION, ESCALATION_POLICY]);
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
    const service = createSequentialMockLLMService([
      ambiguousExtraction,
      CLARIFY_POLICY,
      CLARIFY_EMAIL,
    ]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("clarify");
    expect(result.clarificationEmail).toBeTruthy();
  });

  it("response includes full policyEvaluation object", async () => {
    const service = createSequentialMockLLMService([GOOD_EXTRACTION, COMPLIANT_POLICY]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.policyEvaluation).toBeDefined();
    expect(result.policyEvaluation.rulesMatched).toEqual(["price within range"]);
    expect(result.policyEvaluation.complianceStatus).toBe("compliant");
    expect(result.policyEvaluation.details).toBeTruthy();
  });

  it("response includes extractedData from extraction stage", async () => {
    const service = createSequentialMockLLMService([GOOD_EXTRACTION, COMPLIANT_POLICY]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.extractedData).not.toBeNull();
    expect(result.extractedData!.quotedPrice).toBe(4.5);
    expect(result.extraction.confidence).toBe(0.95);
  });

  it("calls LLM correct count: accept=2, counter=3", async () => {
    // Accept: extraction + policy = 2
    const acceptService = createSequentialMockLLMService([GOOD_EXTRACTION, COMPLIANT_POLICY]);
    const acceptPipeline = new AgentPipeline(acceptService);
    await acceptPipeline.process(baseRequest);
    expect(acceptService.call).toHaveBeenCalledTimes(2);

    // Counter: extraction + policy + response gen = 3
    const counterService = createSequentialMockLLMService([
      GOOD_EXTRACTION, NON_COMPLIANT_COUNTER_POLICY, COUNTER_EMAIL,
    ]);
    const counterPipeline = new AgentPipeline(counterService);
    await counterPipeline.process(baseRequest);
    expect(counterService.call).toHaveBeenCalledTimes(3);
  });

  it("policy evaluator LLM failure -> escalation", async () => {
    const service = createSequentialMockLLMService([
      GOOD_EXTRACTION,
      new Error("Policy LLM failed"),
    ]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
  });

  it("response generator LLM failure -> escalation fallback", async () => {
    const service = createSequentialMockLLMService([
      GOOD_EXTRACTION,
      NON_COMPLIANT_COUNTER_POLICY,
      new Error("Response gen failed"),
    ]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    // Should still produce a result, falling back to escalation
    expect(result.action).toBe("counter");
    expect(result.escalationReason).toContain("failed");
    expect(result.counterOffer).toBeUndefined();
  });
});
