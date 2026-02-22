import { NeedsExpert } from "@/lib/agent/experts/needs";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { NeedsAnalysis, NeedsExpertInput } from "@/lib/agent/experts/types";
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

const completeData: ExtractedQuoteData = {
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

const partialData: ExtractedQuoteData = {
  quotedPrice: 4.5,
  quotedPriceCurrency: "USD",
  quotedPriceUsd: 4.5,
  availableQuantity: null,
  moq: null,
  leadTimeMinDays: null,
  leadTimeMaxDays: null,
  paymentTerms: null,
  validityPeriod: null,
  rawExtractionJson: {},
};

const baseInput: NeedsExpertInput = {
  extractedData: partialData,
  negotiationRules: "Accept if price below $5 and lead time under 30 days.",
  orderContext: {
    skuName: "Bamboo Board",
    supplierSku: "BCB-001",
    quantityRequested: "500",
  },
};

const MISSING_FIELDS_RESPONSE = JSON.stringify({
  missingFields: ["leadTime", "paymentTerms"],
  prioritizedQuestions: [
    "What is the estimated lead time for 500 units?",
    "What are your payment terms?",
  ],
  reasoning: "Lead time is required by the negotiation rules to determine compliance. Payment terms would help evaluate the full deal.",
});

const NO_GAPS_RESPONSE = JSON.stringify({
  missingFields: [],
  prioritizedQuestions: [],
  reasoning: "All key fields are present. Price and lead time are available for rule evaluation.",
});

describe("NeedsExpert", () => {
  it("identifies missing fields and generates prioritized questions", async () => {
    const service = createMockLLMService(MISSING_FIELDS_RESPONSE);
    const expert = new NeedsExpert(service);

    const opinion = await expert.analyze(baseInput);

    expect(opinion.expertName).toBe("needs");
    const analysis = opinion.analysis as NeedsAnalysis;
    expect(analysis.type).toBe("needs");
    expect(analysis.missingFields).toContain("leadTime");
    expect(analysis.prioritizedQuestions.length).toBe(2);
    expect(analysis.prioritizedQuestions[0]).toContain("lead time");
  });

  it("returns empty arrays when no gaps found", async () => {
    const service = createMockLLMService(NO_GAPS_RESPONSE);
    const expert = new NeedsExpert(service);

    const opinion = await expert.analyze({
      ...baseInput,
      extractedData: completeData,
    });

    const analysis = opinion.analysis as NeedsAnalysis;
    expect(analysis.missingFields).toEqual([]);
    expect(analysis.prioritizedQuestions).toEqual([]);
  });

  it("handles null extracted data", async () => {
    const service = createMockLLMService(MISSING_FIELDS_RESPONSE);
    const expert = new NeedsExpert(service);

    const opinion = await expert.analyze({
      ...baseInput,
      extractedData: null,
    });

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.userMessage).toContain("No data extracted");
  });

  it("handles LLM failure gracefully", async () => {
    const service = createMockLLMService(new Error("LLM failed"));
    const expert = new NeedsExpert(service);

    const opinion = await expert.analyze(baseInput);

    const analysis = opinion.analysis as NeedsAnalysis;
    expect(analysis.missingFields).toEqual([]);
    expect(analysis.prioritizedQuestions).toEqual([]);
    expect(analysis.reasoning).toContain("failed");
  });

  it("passes correct schema name for routing mock compatibility", async () => {
    const service = createMockLLMService(NO_GAPS_RESPONSE);
    const expert = new NeedsExpert(service);

    await expert.analyze(baseInput);

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.outputSchema.name).toBe("analyze_needs");
  });

  it("includes additional question when provided", async () => {
    const service = createMockLLMService(MISSING_FIELDS_RESPONSE);
    const expert = new NeedsExpert(service);

    await expert.analyze({
      ...baseInput,
      additionalQuestion: "Focus on whether MOQ information is needed",
    });

    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.userMessage).toContain("Additional Question from Orchestrator");
    expect(callArg.userMessage).toContain("Focus on whether MOQ");
  });

  it("includes LLM observability metadata", async () => {
    const service = createMockLLMService(MISSING_FIELDS_RESPONSE);
    const expert = new NeedsExpert(service);

    const opinion = await expert.analyze(baseInput);

    expect(opinion.provider).toBe("claude");
    expect(opinion.model).toBe("claude-3-haiku-20240307");
    expect(opinion.inputTokens).toBe(200);
    expect(opinion.outputTokens).toBe(100);
  });
});
