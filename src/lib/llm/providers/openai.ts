import OpenAI from "openai";
import type { LLMProvider, LLMRequest, LLMResponse } from "../types";

export class OpenAIProvider implements LLMProvider {
  public readonly name = "openai";
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
      });

      const latencyMs = Date.now() - start;

      return {
        content: response.choices[0]?.message?.content ?? "",
        provider: this.name,
        model: response.model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        latencyMs,
      };
    } catch (error) {
      throw new Error(
        `OpenAI API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
