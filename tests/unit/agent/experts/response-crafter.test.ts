import { ResponseCrafter } from "@/lib/agent/experts/response-crafter";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { ExtractedQuoteData } from "@/lib/agent/types";
import type { ResponseCrafterInput } from "@/lib/agent/experts/types";
import { buildTestOrderInformation } from "../../../helpers/order-information";

function createMockLLMService(response: string | Error): LLMService {
  return {
    call: jest.fn(async (): Promise<LLMServiceResult> => {
      if (response instanceof Error) throw response;
      return {
        response: {
          content: response,
          provider: "claude",
          model: "claude-3-haiku-20240307",
          inputTokens: 200,
          outputTokens: 100,
          latencyMs: 150,
        },
        attempts: [{ provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 150, success: true }],
      };
    }),
  } as unknown as LLMService;
}

const orderInformation = buildTestOrderInformation({
  product: { productName: "Bamboo Cutting Board", supplierProductCode: "BCB-001", merchantSKU: "BCB-001" },
  pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00, lastKnownPrice: 4.25 },
  quantity: { targetQuantity: 500 },
});

const extractedData: ExtractedQuoteData = {
  quotedPrice: 4.5,
  quotedPriceCurrency: "USD",
  quotedPriceUsd: 4.5,
  availableQuantity: 500,
  moq: 500,
  leadTimeMinDays: 25,
  leadTimeMaxDays: 30,
  paymentTerms: "30% deposit",
  validityPeriod: null,
  rawExtractionJson: {},
};

const COUNTER_EMAIL = JSON.stringify({
  emailText: "We were hoping for $3.80 per unit.",
  proposedTermsSummary: "Counter at $3.80/unit",
});

const CLARIFY_EMAIL = JSON.stringify({
  emailText: "Could you please provide your lead time estimate?",
  proposedTermsSummary: "Asking for lead time",
});

describe("ResponseCrafter", () => {
  it("accept -> builds deterministic approval (no LLM call)", async () => {
    const service = createMockLLMService(COUNTER_EMAIL);
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "accept",
      reasoning: "All rules satisfied at $4.50",
      extractedData,
      orderInformation,
    });

    expect(result.proposedApproval).toBeDefined();
    expect(result.proposedApproval!.quantity).toBe(500);
    expect(result.proposedApproval!.price).toBe(4.5);
    expect(result.proposedApproval!.total).toBe(2250);
    expect(service.call).not.toHaveBeenCalled();
  });

  it("counter -> generates counter-offer email via LLM", async () => {
    const service = createMockLLMService(COUNTER_EMAIL);
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "counter",
      reasoning: "Price too high",
      extractedData,
      orderInformation,
      counterTerms: { targetPrice: 3.8 },
    });

    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail).toContain("$3.80");
    expect(result.counterOffer!.proposedTerms).toBe("Counter at $3.80/unit");
    expect(service.call).toHaveBeenCalledTimes(1);
  });

  it("clarify -> generates clarification email via LLM", async () => {
    const service = createMockLLMService(CLARIFY_EMAIL);
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "clarify",
      reasoning: "Missing lead time info",
      extractedData,
      orderInformation,
    });

    expect(result.clarificationEmail).toBeDefined();
    expect(result.clarificationEmail).toContain("lead time");
    expect(service.call).toHaveBeenCalledTimes(1);
  });

  it("clarify with needs analysis -> passes prioritized questions to prompt", async () => {
    const service = createMockLLMService(CLARIFY_EMAIL);
    const crafter = new ResponseCrafter(service);

    await crafter.craft({
      action: "clarify",
      reasoning: "Missing info",
      extractedData,
      orderInformation,
      needsAnalysis: {
        type: "needs",
        missingFields: ["leadTime"],
        prioritizedQuestions: ["What is the estimated lead time?"],
        reasoning: "Lead time needed for evaluation",
      },
    });

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.userMessage).toContain("Missing Information");
    expect(callArg.userMessage).toContain("leadTime");
    expect(callArg.userMessage).toContain("estimated lead time");
  });

  it("escalate -> returns escalation reason immediately (no LLM call)", async () => {
    const service = createMockLLMService(COUNTER_EMAIL);
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "escalate",
      reasoning: "MOQ exceeds trigger threshold",
      extractedData,
      orderInformation,
    });

    expect(result.escalationReason).toBe("MOQ exceeds trigger threshold");
    expect(service.call).not.toHaveBeenCalled();
  });

  it("counter LLM failure -> escalation fallback", async () => {
    const service = createMockLLMService(new Error("LLM failed"));
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "counter",
      reasoning: "Price too high",
      extractedData,
      orderInformation,
      counterTerms: { targetPrice: 3.8 },
    });

    expect(result.escalationReason).toContain("failed");
    expect(result.counterOffer).toBeUndefined();
  });

  it("clarify LLM failure -> escalation fallback", async () => {
    const service = createMockLLMService(new Error("LLM failed"));
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "clarify",
      reasoning: "Need more info",
      extractedData,
      orderInformation,
    });

    expect(result.escalationReason).toContain("failed");
    expect(result.clarificationEmail).toBeUndefined();
  });

  it("accept with null extracted data -> uses order context quantity", async () => {
    const service = createMockLLMService(COUNTER_EMAIL);
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "accept",
      reasoning: "Accept the deal",
      extractedData: null,
      orderInformation,
    });

    expect(result.proposedApproval!.quantity).toBe(500); // from quantityRequested
    expect(result.proposedApproval!.price).toBe(0); // no price data
  });

  it("counter prompt uses correct schema name", async () => {
    const service = createMockLLMService(COUNTER_EMAIL);
    const crafter = new ResponseCrafter(service);

    await crafter.craft({
      action: "counter",
      reasoning: "Price too high",
      extractedData,
      orderInformation,
      counterTerms: { targetPrice: 3.8 },
    });

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.outputSchema.name).toBe("generate_counter_offer");
  });

  it("clarify prompt uses correct schema name", async () => {
    const service = createMockLLMService(CLARIFY_EMAIL);
    const crafter = new ResponseCrafter(service);

    await crafter.craft({
      action: "clarify",
      reasoning: "Missing info",
      extractedData,
      orderInformation,
    });

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.outputSchema.name).toBe("generate_clarification");
  });

  it("includes LLM observability metadata in response", async () => {
    const service = createMockLLMService(COUNTER_EMAIL);
    const crafter = new ResponseCrafter(service);

    const result = await crafter.craft({
      action: "counter",
      reasoning: "Price too high",
      extractedData,
      orderInformation,
      counterTerms: { targetPrice: 3.8 },
    });

    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-3-haiku-20240307");
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(100);
  });
});
