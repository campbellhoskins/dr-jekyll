import { ClaudeProvider } from "@/lib/llm/providers/claude";
import type { LLMRequest } from "@/lib/llm/types";

// Mock the Anthropic SDK
jest.mock("@anthropic-ai/sdk", () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    _mockCreate: mockCreate,
  };
});

function getMockCreate() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@anthropic-ai/sdk")._mockCreate as jest.Mock;
}

const TEST_REQUEST: LLMRequest = {
  systemPrompt: "You are a helpful assistant.",
  userMessage: "Extract data from this email.",
  maxTokens: 1024,
  temperature: 0,
};

describe("ClaudeProvider", () => {
  let provider: ClaudeProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new ClaudeProvider("test-api-key", "claude-3-haiku-20240307");
    mockCreate = getMockCreate();
  });

  it("sends correct parameters to Anthropic SDK", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"result": true}' }],
      model: "claude-3-haiku-20240307",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await provider.call(TEST_REQUEST);

    expect(mockCreate).toHaveBeenCalledWith({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      temperature: 0,
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Extract data from this email." }],
    });
  });

  it("maps Anthropic response to LLMResponse", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"quotedPrice": 4.50}' }],
      model: "claude-3-haiku-20240307",
      usage: { input_tokens: 150, output_tokens: 75 },
    });

    const response = await provider.call(TEST_REQUEST);

    expect(response.content).toBe('{"quotedPrice": 4.50}');
    expect(response.provider).toBe("claude");
    expect(response.model).toBe("claude-3-haiku-20240307");
    expect(response.inputTokens).toBe(150);
    expect(response.outputTokens).toBe(75);
    expect(typeof response.latencyMs).toBe("number");
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("throws on API error with descriptive message", async () => {
    mockCreate.mockRejectedValue(new Error("401 Unauthorized"));

    await expect(provider.call(TEST_REQUEST)).rejects.toThrow(
      "Claude API error: 401 Unauthorized"
    );
  });

  it("measures latency accurately", async () => {
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: [{ type: "text", text: "ok" }],
                model: "claude-3-haiku-20240307",
                usage: { input_tokens: 10, output_tokens: 5 },
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
