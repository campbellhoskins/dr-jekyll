import { EscalationExpert } from "@/lib/agent/experts/escalation";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { EscalationAnalysis, EscalationExpertInput } from "@/lib/agent/experts/types";
import type { ExtractedQuoteData } from "@/lib/agent/types";

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

const baseInput: EscalationExpertInput = {
  supplierMessage: "Price is $4.50 per unit, MOQ 500.",
  escalationTriggers: "Escalate if MOQ exceeds 1000 units.",
  orderContext: { skuName: "Bamboo Board", supplierSku: "BCB-001" },
};

const extractedData: ExtractedQuoteData = {
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

const NO_ESCALATION = JSON.stringify({
  shouldEscalate: false,
  reasoning: "MOQ 500 is within the 1000 unit threshold.",
  triggersEvaluated: ["MOQ exceeds 1000"],
  triggeredTriggers: [],
  severity: "low",
});

const ESCALATION_TRIGGERED = JSON.stringify({
  shouldEscalate: true,
  reasoning: "MOQ 2000 exceeds the trigger threshold of 1000.",
  triggersEvaluated: ["MOQ exceeds 1000"],
  triggeredTriggers: ["MOQ exceeds 1000"],
  severity: "high",
});

const DISCONTINUED_ESCALATION = JSON.stringify({
  shouldEscalate: true,
  reasoning: "Supplier indicated the product has been discontinued.",
  triggersEvaluated: ["Product discontinued", "Price above $10"],
  triggeredTriggers: ["Product discontinued"],
  severity: "critical",
});

describe("EscalationExpert", () => {
  it("returns no escalation when triggers are not met", async () => {
    const service = createMockLLMService(NO_ESCALATION);
    const expert = new EscalationExpert(service);

    const opinion = await expert.analyze({ ...baseInput, extractedData });

    expect(opinion.expertName).toBe("escalation");
    const analysis = opinion.analysis as EscalationAnalysis;
    expect(analysis.type).toBe("escalation");
    expect(analysis.shouldEscalate).toBe(false);
    expect(analysis.triggeredTriggers).toEqual([]);
  });

  it("returns escalation when trigger fires", async () => {
    const service = createMockLLMService(ESCALATION_TRIGGERED);
    const expert = new EscalationExpert(service);

    const opinion = await expert.analyze({
      ...baseInput,
      extractedData: { ...extractedData, moq: 2000 },
    });

    const analysis = opinion.analysis as EscalationAnalysis;
    expect(analysis.shouldEscalate).toBe(true);
    expect(analysis.triggeredTriggers).toContain("MOQ exceeds 1000");
    expect(analysis.severity).toBe("high");
  });

  it("handles discontinuation as critical escalation", async () => {
    const service = createMockLLMService(DISCONTINUED_ESCALATION);
    const expert = new EscalationExpert(service);

    const opinion = await expert.analyze({
      supplierMessage: "Unfortunately, this product has been discontinued.",
      escalationTriggers: "Escalate if product discontinued. Escalate if price above $10.",
      orderContext: { skuName: "Widget", supplierSku: "W-001" },
    });

    const analysis = opinion.analysis as EscalationAnalysis;
    expect(analysis.shouldEscalate).toBe(true);
    expect(analysis.severity).toBe("critical");
    expect(analysis.triggeredTriggers).toContain("Product discontinued");
  });

  it("returns no-escalation opinion when no triggers provided", async () => {
    const service = createMockLLMService(NO_ESCALATION);
    const expert = new EscalationExpert(service);

    const opinion = await expert.analyze({
      supplierMessage: "Price is $4.50.",
      escalationTriggers: "",
      orderContext: { skuName: "Widget", supplierSku: "W-001" },
    });

    // Should NOT call the LLM
    expect(service.call).not.toHaveBeenCalled();
    const analysis = opinion.analysis as EscalationAnalysis;
    expect(analysis.shouldEscalate).toBe(false);
    expect(analysis.reasoning).toContain("No escalation triggers");
  });

  it("falls back to escalation on LLM failure", async () => {
    const service = createMockLLMService(new Error("LLM unavailable"));
    const expert = new EscalationExpert(service);

    const opinion = await expert.analyze(baseInput);

    const analysis = opinion.analysis as EscalationAnalysis;
    expect(analysis.shouldEscalate).toBe(true); // safety fallback
    expect(analysis.reasoning).toContain("failed");
    expect(analysis.severity).toBe("high");
  });

  it("passes correct schema name for routing mock compatibility", async () => {
    const service = createMockLLMService(NO_ESCALATION);
    const expert = new EscalationExpert(service);

    await expert.analyze(baseInput);

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.outputSchema.name).toBe("evaluate_escalation");
  });

  it("includes conversation history in prompt when provided", async () => {
    const service = createMockLLMService(NO_ESCALATION);
    const expert = new EscalationExpert(service);

    await expert.analyze({
      ...baseInput,
      conversationHistory: "[AGENT] Requesting quote\n[SUPPLIER] Here it is",
    });

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.userMessage).toContain("Conversation History");
    expect(callArg.userMessage).toContain("Requesting quote");
  });

  it("includes LLM observability metadata", async () => {
    const service = createMockLLMService(NO_ESCALATION);
    const expert = new EscalationExpert(service);

    const opinion = await expert.analyze(baseInput);

    expect(opinion.provider).toBe("claude");
    expect(opinion.model).toBe("claude-3-haiku-20240307");
    expect(opinion.inputTokens).toBe(200);
    expect(opinion.outputTokens).toBe(100);
  });
});
