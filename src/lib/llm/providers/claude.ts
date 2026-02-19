import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResponse } from "../types";

export class ClaudeProvider implements LLMProvider {
  public readonly name = "claude";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userMessage }],
      });

      const latencyMs = Date.now() - start;
      const textBlock = response.content.find((b) => b.type === "text");

      return {
        content: textBlock ? textBlock.text : "",
        provider: this.name,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs,
      };
    } catch (error) {
      throw new Error(
        `Claude API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
