import { LLMService } from "@/lib/llm/service";
import type { LLMProvider, LLMRequest, LLMResponse } from "@/lib/llm/types";

function createMockProvider(
  name: string,
  impl?: (req: LLMRequest) => Promise<LLMResponse>
): LLMProvider {
  const defaultImpl = async (): Promise<LLMResponse> => ({
    content: "mock response",
    provider: name,
    model: `${name}-model`,
    inputTokens: 10,
    outputTokens: 5,
    latencyMs: 100,
  });
  return { name, call: jest.fn(impl ?? defaultImpl) };
}

const TEST_REQUEST: LLMRequest = {
  systemPrompt: "system",
  userMessage: "user",
};

describe("LLMService", () => {
  it("calls primary provider with correct request shape", async () => {
    const primary = createMockProvider("primary");
    const service = new LLMService({
      primaryProvider: primary,
      maxRetriesPerProvider: 3,
      retryDelayMs: 0,
    });

    await service.call(TEST_REQUEST);

    expect(primary.call).toHaveBeenCalledWith(TEST_REQUEST);
  });

  it("returns response from primary provider on success", async () => {
    const primary = createMockProvider("primary", async () => ({
      content: "hello",
      provider: "primary",
      model: "primary-model",
      inputTokens: 20,
      outputTokens: 10,
      latencyMs: 50,
    }));
    const service = new LLMService({
      primaryProvider: primary,
      maxRetriesPerProvider: 3,
      retryDelayMs: 0,
    });

    const result = await service.call(TEST_REQUEST);

    expect(result.response.content).toBe("hello");
    expect(result.response.provider).toBe("primary");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].success).toBe(true);
  });

  it("retries on primary provider failure", async () => {
    let callCount = 0;
    const primary = createMockProvider("primary", async () => {
      callCount++;
      if (callCount < 3) throw new Error("temporary failure");
      return {
        content: "success on third try",
        provider: "primary",
        model: "m",
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 50,
      };
    });

    const service = new LLMService({
      primaryProvider: primary,
      maxRetriesPerProvider: 3,
      retryDelayMs: 0,
    });

    const result = await service.call(TEST_REQUEST);

    expect(result.response.content).toBe("success on third try");
    expect(primary.call).toHaveBeenCalledTimes(3);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[1].success).toBe(false);
    expect(result.attempts[2].success).toBe(true);
  });

  it("falls back to secondary after primary exhausted", async () => {
    const primary = createMockProvider("primary", async () => {
      throw new Error("primary down");
    });
    const fallback = createMockProvider("fallback", async () => ({
      content: "fallback response",
      provider: "fallback",
      model: "fallback-model",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 50,
    }));

    const service = new LLMService({
      primaryProvider: primary,
      fallbackProvider: fallback,
      maxRetriesPerProvider: 2,
      retryDelayMs: 0,
    });

    const result = await service.call(TEST_REQUEST);

    expect(result.response.content).toBe("fallback response");
    expect(result.response.provider).toBe("fallback");
    expect(primary.call).toHaveBeenCalledTimes(2);
    expect(fallback.call).toHaveBeenCalledTimes(1);
  });

  it("throws after all providers exhausted", async () => {
    const primary = createMockProvider("primary", async () => {
      throw new Error("primary down");
    });
    const fallback = createMockProvider("fallback", async () => {
      throw new Error("fallback down");
    });

    const service = new LLMService({
      primaryProvider: primary,
      fallbackProvider: fallback,
      maxRetriesPerProvider: 2,
      retryDelayMs: 0,
    });

    await expect(service.call(TEST_REQUEST)).rejects.toThrow(
      "All LLM providers failed"
    );
    expect(primary.call).toHaveBeenCalledTimes(2);
    expect(fallback.call).toHaveBeenCalledTimes(2);
  });

  it("logs every attempt", async () => {
    let callCount = 0;
    const primary = createMockProvider("primary", async () => {
      callCount++;
      if (callCount === 1) throw new Error("first fail");
      return {
        content: "ok",
        provider: "primary",
        model: "m",
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 50,
      };
    });

    const service = new LLMService({
      primaryProvider: primary,
      maxRetriesPerProvider: 3,
      retryDelayMs: 0,
    });

    const result = await service.call(TEST_REQUEST);

    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({
      provider: "primary",
      success: false,
      error: "first fail",
    });
    expect(result.attempts[1]).toMatchObject({
      provider: "primary",
      success: true,
    });
    expect(typeof result.attempts[0].latencyMs).toBe("number");
  });

  it("respects retry delay between attempts", async () => {
    let callCount = 0;
    const primary = createMockProvider("primary", async () => {
      callCount++;
      if (callCount < 3) throw new Error("fail");
      return {
        content: "ok",
        provider: "primary",
        model: "m",
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 10,
      };
    });

    const service = new LLMService({
      primaryProvider: primary,
      maxRetriesPerProvider: 3,
      retryDelayMs: 50,
    });

    const start = Date.now();
    await service.call(TEST_REQUEST);
    const elapsed = Date.now() - start;

    // 2 retries × 50ms delay = 100ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("works without fallback provider configured", async () => {
    const primary = createMockProvider("primary", async () => {
      throw new Error("always fails");
    });

    const service = new LLMService({
      primaryProvider: primary,
      maxRetriesPerProvider: 2,
      retryDelayMs: 0,
    });

    await expect(service.call(TEST_REQUEST)).rejects.toThrow(
      "All LLM providers failed"
    );
    expect(primary.call).toHaveBeenCalledTimes(2);
  });
});
