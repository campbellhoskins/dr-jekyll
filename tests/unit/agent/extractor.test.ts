import { Extractor } from "@/lib/agent/extractor";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { LLMRequest } from "@/lib/llm/types";

function createMockLLMService(
  impl?: (req: LLMRequest) => Promise<LLMServiceResult>
): LLMService {
  const defaultImpl = async (): Promise<LLMServiceResult> => ({
    response: {
      content: JSON.stringify({
        quotedPrice: 4.5,
        quotedPriceCurrency: "USD",
        availableQuantity: null,
        moq: 500,
        leadTimeDays: 25,
        paymentTerms: "30% deposit",
        validityPeriod: null,
        confidence: 0.95,
        notes: [],
      }),
      provider: "claude",
      model: "claude-3-haiku-20240307",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
    },
    attempts: [
      {
        provider: "claude",
        model: "claude-3-haiku-20240307",
        latencyMs: 200,
        success: true,
      },
    ],
  });

  return { call: jest.fn(impl ?? defaultImpl) } as unknown as LLMService;
}

describe("Extractor", () => {
  it("builds extraction prompt with supplier email embedded", async () => {
    const mockService = createMockLLMService();
    const extractor = new Extractor(mockService);

    await extractor.extract("Hello, our price is $5.00 per unit.");

    expect(mockService.call).toHaveBeenCalledTimes(1);
    const callArg = (mockService.call as jest.Mock).mock.calls[0][0];
    expect(callArg.userMessage).toContain(
      "Hello, our price is $5.00 per unit."
    );
    expect(callArg.systemPrompt).toContain("quotedPrice");
  });

  it("returns ExtractionResult with ExtractedQuoteData on success", async () => {
    const mockService = createMockLLMService();
    const extractor = new Extractor(mockService);

    const result = await extractor.extract("Price is $4.50 per unit.");

    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.quotedPrice).toBe(4.5);
    expect(result.data!.quotedPriceCurrency).toBe("USD");
    expect(result.data!.moq).toBe(500);
    expect(result.confidence).toBe(0.95);
  });

  it("computes quotedPriceUsd for non-USD currencies", async () => {
    const mockService = createMockLLMService(async () => ({
      response: {
        content: JSON.stringify({
          quotedPrice: 100,
          quotedPriceCurrency: "CNY",
          confidence: 0.8,
          notes: [],
        }),
        provider: "claude",
        model: "claude-3-haiku-20240307",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 200,
      },
      attempts: [
        {
          provider: "claude",
          model: "claude-3-haiku-20240307",
          latencyMs: 200,
          success: true,
        },
      ],
    }));

    const extractor = new Extractor(mockService);
    const result = await extractor.extract("Price is 100 RMB.");

    expect(result.success).toBe(true);
    expect(result.data!.quotedPriceCurrency).toBe("CNY");
    expect(result.data!.quotedPriceUsd).not.toBeNull();
    expect(result.data!.quotedPriceUsd).toBeGreaterThan(0);
    // CNY to USD should be roughly 0.14 * 100 = ~14
    expect(result.data!.quotedPriceUsd!).toBeLessThan(100);
  });

  it("sets quotedPriceUsd equal to quotedPrice for USD", async () => {
    const mockService = createMockLLMService();
    const extractor = new Extractor(mockService);

    const result = await extractor.extract("Price is $4.50.");

    expect(result.success).toBe(true);
    expect(result.data!.quotedPriceUsd).toBe(4.5);
  });

  it("returns success=false when LLM returns unparseable output", async () => {
    const mockService = createMockLLMService(async () => ({
      response: {
        content: "I cannot process this request.",
        provider: "claude",
        model: "claude-3-haiku-20240307",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 200,
      },
      attempts: [
        {
          provider: "claude",
          model: "claude-3-haiku-20240307",
          latencyMs: 200,
          success: true,
        },
      ],
    }));

    const extractor = new Extractor(mockService);
    const result = await extractor.extract("Some email text");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.data).toBeNull();
  });

  it("returns success=false when LLM service throws", async () => {
    const mockService = createMockLLMService(async () => {
      throw new Error("All LLM providers failed");
    });

    const extractor = new Extractor(mockService);
    const result = await extractor.extract("Some email text");

    expect(result.success).toBe(false);
    expect(result.error).toContain("All LLM providers failed");
    expect(result.data).toBeNull();
  });

  it("includes provider metadata in result", async () => {
    const mockService = createMockLLMService();
    const extractor = new Extractor(mockService);

    const result = await extractor.extract("Price is $4.50.");

    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-3-haiku-20240307");
    expect(result.latencyMs).toBe(200);
    expect(result.retryCount).toBe(0); // 1 attempt, 0 retries
  });

  it("handles empty email input", async () => {
    const mockService = createMockLLMService(async () => ({
      response: {
        content: JSON.stringify({
          quotedPrice: null,
          quotedPriceCurrency: "USD",
          confidence: 0,
          notes: ["Empty email provided"],
        }),
        provider: "claude",
        model: "claude-3-haiku-20240307",
        inputTokens: 50,
        outputTokens: 30,
        latencyMs: 100,
      },
      attempts: [
        {
          provider: "claude",
          model: "claude-3-haiku-20240307",
          latencyMs: 100,
          success: true,
        },
      ],
    }));

    const extractor = new Extractor(mockService);
    const result = await extractor.extract("");

    expect(result.success).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.data!.quotedPrice).toBeNull();
  });
});
