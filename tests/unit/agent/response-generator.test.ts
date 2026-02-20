import { ResponseGenerator } from "@/lib/agent/response-generator";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { LLMRequest } from "@/lib/llm/types";
import type {
  ExtractedQuoteData,
  OrderContext,
  PolicyEvaluationResult,
} from "@/lib/agent/types";

function createMockLLMService(
  impl?: (req: LLMRequest) => Promise<LLMServiceResult>
): LLMService {
  const defaultImpl = async (): Promise<LLMServiceResult> => ({
    response: {
      content: JSON.stringify({
        emailText: "Thank you for the quote. We were hoping for a price closer to $3.80 per unit.",
        proposedTermsSummary: "Counter at $3.80/unit",
      }),
      provider: "claude",
      model: "claude-3-haiku-20240307",
      inputTokens: 200,
      outputTokens: 150,
      latencyMs: 400,
    },
    attempts: [
      { provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 400, success: true },
    ],
  });
  return { call: jest.fn(impl ?? defaultImpl) } as unknown as LLMService;
}

const sampleData: ExtractedQuoteData = {
  quotedPrice: 4.8,
  quotedPriceCurrency: "USD",
  quotedPriceUsd: 4.8,
  availableQuantity: 500,
  moq: 500,
  leadTimeMinDays: 25,
  leadTimeMaxDays: 30,
  paymentTerms: "30% deposit",
  validityPeriod: null,
  rawExtractionJson: {},
};

const sampleContext: OrderContext = {
  skuName: "LED Desk Lamp",
  supplierSku: "LDL-200",
  quantityRequested: "500",
  lastKnownPrice: 3.8,
};

const samplePolicyEval: PolicyEvaluationResult = {
  rulesMatched: ["price range"],
  complianceStatus: "non_compliant",
  recommendedAction: "counter",
  reasoning: "Price $4.80 exceeds target of $3.80",
  escalationTriggered: false,
  counterTerms: { targetPrice: 3.8 },
  provider: "claude",
  model: "m",
  latencyMs: 300,
};

describe("ResponseGenerator", () => {
  it("accept: builds ProposedApproval deterministically, no LLM call", async () => {
    const service = createMockLLMService();
    const generator = new ResponseGenerator(service);

    const result = await generator.generate(
      "accept",
      sampleData,
      samplePolicyEval,
      sampleContext,
      "All rules satisfied"
    );

    expect(service.call).not.toHaveBeenCalled();
    expect(result.proposedApproval).toBeDefined();
    expect(result.proposedApproval!.price).toBe(4.8);
    expect(result.proposedApproval!.summary).toBeTruthy();
  });

  it("accept: computes correct total (quantity * price)", async () => {
    const service = createMockLLMService();
    const generator = new ResponseGenerator(service);

    const result = await generator.generate(
      "accept",
      sampleData,
      samplePolicyEval,
      sampleContext,
      "All rules satisfied"
    );

    expect(result.proposedApproval!.quantity).toBe(500);
    expect(result.proposedApproval!.total).toBe(500 * 4.8);
  });

  it("counter: calls LLM with counter-offer prompt", async () => {
    const service = createMockLLMService();
    const generator = new ResponseGenerator(service);

    const result = await generator.generate(
      "counter",
      sampleData,
      samplePolicyEval,
      sampleContext,
      "Price too high"
    );

    expect(service.call).toHaveBeenCalledTimes(1);
    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail).toContain("$3.80");
    expect(result.counterOffer!.proposedTerms).toBeTruthy();
  });

  it("clarify: calls LLM with clarification prompt", async () => {
    const service = createMockLLMService(async () => ({
      response: {
        content: JSON.stringify({
          emailText: "Could you please provide your pricing for the water bottles?",
          proposedTermsSummary: "Asking for unit price and lead time",
        }),
        provider: "claude", model: "m", inputTokens: 200, outputTokens: 100, latencyMs: 300,
      },
      attempts: [{ provider: "claude", model: "m", latencyMs: 300, success: true }],
    }));
    const generator = new ResponseGenerator(service);

    const result = await generator.generate(
      "clarify",
      sampleData,
      null,
      sampleContext,
      "Need pricing info"
    );

    expect(service.call).toHaveBeenCalledTimes(1);
    expect(result.clarificationEmail).toBeTruthy();
    expect(result.clarificationEmail).toContain("pricing");
  });

  it("escalate: returns escalationReason, no LLM call", async () => {
    const service = createMockLLMService();
    const generator = new ResponseGenerator(service);

    const result = await generator.generate(
      "escalate",
      sampleData,
      samplePolicyEval,
      sampleContext,
      "MOQ too high"
    );

    expect(service.call).not.toHaveBeenCalled();
    expect(result.escalationReason).toBe("MOQ too high");
  });

  it("counter: handles LLM error gracefully", async () => {
    const service = createMockLLMService(async () => {
      throw new Error("LLM failed");
    });
    const generator = new ResponseGenerator(service);

    const result = await generator.generate(
      "counter",
      sampleData,
      samplePolicyEval,
      sampleContext,
      "Price too high"
    );

    expect(result.escalationReason).toBeTruthy();
    expect(result.counterOffer).toBeUndefined();
  });

  it("accept: handles null availableQuantity by using quantityRequested", async () => {
    const service = createMockLLMService();
    const generator = new ResponseGenerator(service);
    const dataNoQty = { ...sampleData, availableQuantity: null };

    const result = await generator.generate(
      "accept",
      dataNoQty,
      samplePolicyEval,
      sampleContext,
      "OK"
    );

    expect(result.proposedApproval!.quantity).toBe(500);
  });

  it("LLM is NOT called for accept and escalate actions", async () => {
    const service = createMockLLMService();
    const generator = new ResponseGenerator(service);

    await generator.generate("accept", sampleData, samplePolicyEval, sampleContext, "OK");
    await generator.generate("escalate", sampleData, samplePolicyEval, sampleContext, "Problem");

    expect(service.call).not.toHaveBeenCalled();
  });
});
