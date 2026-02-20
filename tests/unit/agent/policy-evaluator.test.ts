import { PolicyEvaluator } from "@/lib/agent/policy-evaluator";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { LLMRequest } from "@/lib/llm/types";
import type { ExtractedQuoteData, OrderContext } from "@/lib/agent/types";

function createMockLLMService(
  impl?: (req: LLMRequest) => Promise<LLMServiceResult>
): LLMService {
  const defaultImpl = async (): Promise<LLMServiceResult> => ({
    response: {
      content: JSON.stringify({
        rulesMatched: ["price within range"],
        complianceStatus: "compliant",
        recommendedAction: "accept",
        reasoning: "All rules satisfied",
        escalationTriggered: false,
        escalationReason: null,
      }),
      provider: "claude",
      model: "claude-3-haiku-20240307",
      inputTokens: 200,
      outputTokens: 100,
      latencyMs: 300,
    },
    attempts: [
      { provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 300, success: true },
    ],
  });
  return { call: jest.fn(impl ?? defaultImpl) } as unknown as LLMService;
}

const sampleData: ExtractedQuoteData = {
  quotedPrice: 4.5,
  quotedPriceCurrency: "USD",
  quotedPriceUsd: 4.5,
  availableQuantity: null,
  moq: 500,
  leadTimeMinDays: 25,
  leadTimeMaxDays: 30,
  paymentTerms: "30% deposit",
  validityPeriod: null,
  rawExtractionJson: {},
};

const sampleContext: OrderContext = {
  skuName: "Bamboo Cutting Board",
  supplierSku: "BCB-001",
  quantityRequested: "500",
  lastKnownPrice: 4.25,
};

describe("PolicyEvaluator", () => {
  it("calls LLM with correct prompt structure", async () => {
    const service = createMockLLMService();
    const evaluator = new PolicyEvaluator(service);

    await evaluator.evaluate(sampleData, "Accept below $5", "Escalate if MOQ > 1000", sampleContext);

    expect(service.call).toHaveBeenCalledTimes(1);
    const req = (service.call as jest.Mock).mock.calls[0][0];
    expect(req.systemPrompt).toBeTruthy();
    expect(req.userMessage).toContain("4.5");
    expect(req.userMessage).toContain("Accept below $5");
    expect(req.userMessage).toContain("Escalate if MOQ > 1000");
  });

  it("returns compliant evaluation for good quote", async () => {
    const service = createMockLLMService();
    const evaluator = new PolicyEvaluator(service);

    const result = await evaluator.evaluate(sampleData, "rules", "triggers", sampleContext);

    expect(result.complianceStatus).toBe("compliant");
    expect(result.recommendedAction).toBe("accept");
    expect(result.escalationTriggered).toBe(false);
  });

  it("returns non_compliant for price above threshold", async () => {
    const service = createMockLLMService(async () => ({
      response: {
        content: JSON.stringify({
          rulesMatched: ["price range $3.50-$4.20"],
          complianceStatus: "non_compliant",
          recommendedAction: "counter",
          reasoning: "Price $4.80 exceeds acceptable range",
          escalationTriggered: false,
          counterTerms: { targetPrice: 3.8 },
        }),
        provider: "claude", model: "m", inputTokens: 200, outputTokens: 100, latencyMs: 300,
      },
      attempts: [{ provider: "claude", model: "m", latencyMs: 300, success: true }],
    }));
    const evaluator = new PolicyEvaluator(service);

    const result = await evaluator.evaluate(sampleData, "rules", "triggers", sampleContext);

    expect(result.complianceStatus).toBe("non_compliant");
    expect(result.recommendedAction).toBe("counter");
    expect(result.counterTerms?.targetPrice).toBe(3.8);
  });

  it("returns partial compliance for mixed satisfaction", async () => {
    const service = createMockLLMService(async () => ({
      response: {
        content: JSON.stringify({
          rulesMatched: ["price OK", "lead time too long"],
          complianceStatus: "partial",
          recommendedAction: "counter",
          reasoning: "Price is fine but lead time exceeds preference",
          escalationTriggered: false,
        }),
        provider: "claude", model: "m", inputTokens: 200, outputTokens: 100, latencyMs: 300,
      },
      attempts: [{ provider: "claude", model: "m", latencyMs: 300, success: true }],
    }));
    const evaluator = new PolicyEvaluator(service);

    const result = await evaluator.evaluate(sampleData, "rules", "triggers", sampleContext);

    expect(result.complianceStatus).toBe("partial");
  });

  it("sets escalationTriggered when trigger matches", async () => {
    const service = createMockLLMService(async () => ({
      response: {
        content: JSON.stringify({
          rulesMatched: ["MOQ limit"],
          complianceStatus: "non_compliant",
          recommendedAction: "escalate",
          reasoning: "MOQ 2000 exceeds trigger of 1000",
          escalationTriggered: true,
          escalationReason: "MOQ exceeds 1000 units",
        }),
        provider: "claude", model: "m", inputTokens: 200, outputTokens: 100, latencyMs: 300,
      },
      attempts: [{ provider: "claude", model: "m", latencyMs: 300, success: true }],
    }));
    const evaluator = new PolicyEvaluator(service);

    const result = await evaluator.evaluate(sampleData, "rules", "triggers", sampleContext);

    expect(result.escalationTriggered).toBe(true);
    expect(result.escalationReason).toContain("MOQ");
  });

  it("handles LLM service throwing error", async () => {
    const service = createMockLLMService(async () => {
      throw new Error("All LLM providers failed");
    });
    const evaluator = new PolicyEvaluator(service);

    const result = await evaluator.evaluate(sampleData, "rules", "triggers", sampleContext);

    expect(result.escalationTriggered).toBe(true);
    expect(result.recommendedAction).toBe("escalate");
    expect(result.reasoning).toContain("failed");
  });

  it("handles unparseable LLM output", async () => {
    const service = createMockLLMService(async () => ({
      response: {
        content: "Sorry, I can't help with that.",
        provider: "claude", model: "m", inputTokens: 200, outputTokens: 100, latencyMs: 300,
      },
      attempts: [{ provider: "claude", model: "m", latencyMs: 300, success: true }],
    }));
    const evaluator = new PolicyEvaluator(service);

    const result = await evaluator.evaluate(sampleData, "rules", "triggers", sampleContext);

    expect(result.escalationTriggered).toBe(true);
    expect(result.recommendedAction).toBe("escalate");
  });

  it("includes provider metadata in result", async () => {
    const service = createMockLLMService();
    const evaluator = new PolicyEvaluator(service);

    const result = await evaluator.evaluate(sampleData, "rules", "triggers", sampleContext);

    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-3-haiku-20240307");
    expect(result.latencyMs).toBe(300);
  });

  it("prompt includes all input data", async () => {
    const service = createMockLLMService();
    const evaluator = new PolicyEvaluator(service);

    await evaluator.evaluate(
      sampleData,
      "Target price $3.80, max $4.20",
      "Escalate if MOQ > 1000",
      { ...sampleContext, specialInstructions: "Custom logo" }
    );

    const req = (service.call as jest.Mock).mock.calls[0][0];
    expect(req.userMessage).toContain("Target price $3.80");
    expect(req.userMessage).toContain("Escalate if MOQ > 1000");
    expect(req.userMessage).toContain("Bamboo Cutting Board");
    expect(req.userMessage).toContain("Custom logo");
  });
});
