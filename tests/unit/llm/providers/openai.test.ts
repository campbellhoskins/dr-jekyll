import { OpenAIProvider } from "@/lib/llm/providers/openai";
import type { LLMRequest } from "@/lib/llm/types";

jest.mock("openai", () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    _mockCreate: mockCreate,
  };
});

function getMockCreate() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("openai")._mockCreate as jest.Mock;
}

const TEST_REQUEST: LLMRequest = {
  systemPrompt: "You are a helpful assistant.",
  userMessage: "Extract data from this email.",
  maxTokens: 1024,
  temperature: 0,
};

describe("OpenAIProvider", () => {
  let provider: OpenAIProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAIProvider("test-api-key", "gpt-4o");
    mockCreate = getMockCreate();
  });

  it("sends correct parameters to OpenAI SDK", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"result": true}' } }],
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    await provider.call(TEST_REQUEST);

    expect(mockCreate).toHaveBeenCalledWith({
      model: "gpt-4o",
      max_tokens: 1024,
      temperature: 0,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Extract data from this email." },
      ],
    });
  });

  it("maps OpenAI response to LLMResponse", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"quotedPrice": 4.50}' } }],
      model: "gpt-4o",
      usage: { prompt_tokens: 150, completion_tokens: 75 },
    });

    const response = await provider.call(TEST_REQUEST);

    expect(response.content).toBe('{"quotedPrice": 4.50}');
    expect(response.provider).toBe("openai");
    expect(response.model).toBe("gpt-4o");
    expect(response.inputTokens).toBe(150);
    expect(response.outputTokens).toBe(75);
    expect(typeof response.latencyMs).toBe("number");
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("throws on API error with descriptive message", async () => {
    mockCreate.mockRejectedValue(new Error("429 Rate limit exceeded"));

    await expect(provider.call(TEST_REQUEST)).rejects.toThrow(
      "OpenAI API error: 429 Rate limit exceeded"
    );
  });

  it("measures latency accurately", async () => {
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                choices: [{ message: { content: "ok" } }],
                model: "gpt-4o",
                usage: { prompt_tokens: 10, completion_tokens: 5 },
              }),
            50
          )
        )
    );

    const response = await provider.call(TEST_REQUEST);

    expect(response.latencyMs).toBeGreaterThanOrEqual(40);
    expect(response.latencyMs).toBeLessThan(200);
  });
});
