import { ExtractionExpert } from "@/lib/agent/experts/extraction";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { ExtractionAnalysis } from "@/lib/agent/experts/types";

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

const FAILED_EXTRACTION = JSON.stringify({
  quotedPrice: null,
  quotedPriceCurrency: "USD",
  confidence: 0.1,
  notes: ["No pricing data found"],
});

describe("ExtractionExpert", () => {
  it("wraps Extractor and returns ExpertOpinion with ExtractionAnalysis", async () => {
    const service = createMockLLMService(GOOD_EXTRACTION);
    const expert = new ExtractionExpert(service);

    const opinion = await expert.analyze({
      supplierMessage: "Price is $4.50 per unit, MOQ 500.",
    });

    expect(opinion.expertName).toBe("extraction");
    expect(opinion.provider).toBe("claude");
    expect(opinion.latencyMs).toBe(150);

    const analysis = opinion.analysis as ExtractionAnalysis;
    expect(analysis.type).toBe("extraction");
    expect(analysis.success).toBe(true);
    expect(analysis.confidence).toBe(0.95);
    expect(analysis.extractedData).not.toBeNull();
    expect(analysis.extractedData!.quotedPrice).toBe(4.5);
    expect(analysis.extractedData!.moq).toBe(500);
  });

  it("passes conversation history and prior data to extractor", async () => {
    const service = createMockLLMService(GOOD_EXTRACTION);
    const expert = new ExtractionExpert(service);

    await expert.analyze({
      supplierMessage: "The new price is $4.50.",
      conversationHistory: "[AGENT] Can you do $4?\n[SUPPLIER] Let me check.",
      priorExtractedData: { quotedPrice: 5.0, quotedPriceCurrency: "USD" },
    });

    expect(service.call).toHaveBeenCalledTimes(1);
    const callArg = (service.call as jest.Mock).mock.calls[0][0];
    expect(callArg.userMessage).toContain("Prior Conversation");
    expect(callArg.userMessage).toContain("Previously Extracted Data");
    expect(callArg.userMessage).toContain("Price: 5 USD");
  });

  it("handles LLM failure gracefully", async () => {
    const service = createMockLLMService(new Error("LLM service unavailable"));
    const expert = new ExtractionExpert(service);

    const opinion = await expert.analyze({
      supplierMessage: "Some supplier message",
    });

    const analysis = opinion.analysis as ExtractionAnalysis;
    expect(analysis.success).toBe(false);
    expect(analysis.error).toContain("LLM service unavailable");
    expect(analysis.extractedData).toBeNull();
  });

  it("handles low confidence extraction", async () => {
    const service = createMockLLMService(FAILED_EXTRACTION);
    const expert = new ExtractionExpert(service);

    const opinion = await expert.analyze({
      supplierMessage: "We'll get back to you on pricing.",
    });

    const analysis = opinion.analysis as ExtractionAnalysis;
    expect(analysis.success).toBe(true); // parsing succeeded
    expect(analysis.confidence).toBe(0.1);
    expect(analysis.extractedData!.quotedPrice).toBeNull();
    expect(analysis.notes).toContain("No pricing data found");
  });

  it("includes LLM observability metadata", async () => {
    const service = createMockLLMService(GOOD_EXTRACTION);
    const expert = new ExtractionExpert(service);

    const opinion = await expert.analyze({
      supplierMessage: "Price is $4.50.",
    });

    expect(opinion.provider).toBe("claude");
    expect(opinion.model).toBe("claude-3-haiku-20240307");
    expect(opinion.inputTokens).toBe(200);
    expect(opinion.outputTokens).toBe(100);
    expect(opinion.latencyMs).toBe(150);
  });
});
