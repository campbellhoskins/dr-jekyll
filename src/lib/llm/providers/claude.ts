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
      // Build base params
      const params: Record<string, unknown> = {
        model: this.model,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userMessage }],
      };

      // Add structured output (tool_use) when schema is provided
      if (request.outputSchema) {
        params.tools = [
          {
            name: request.outputSchema.name,
            description: request.outputSchema.description,
            input_schema: request.outputSchema.schema,
          },
        ];
        params.tool_choice = {
          type: "tool",
          name: request.outputSchema.name,
        };
      }

      const response = await this.client.messages.create(
        params as Anthropic.MessageCreateParamsNonStreaming
      );

      const latencyMs = Date.now() - start;

      // Extract content based on response type
      let content: string;
      if (request.outputSchema) {
        // Structured output: extract from tool_use block
        const toolBlock = response.content.find(
          (b) => b.type === "tool_use"
        );
        content = toolBlock && "input" in toolBlock
          ? JSON.stringify(toolBlock.input)
          : "";
      } else {
        // Text output: extract from text block
        const textBlock = response.content.find((b) => b.type === "text");
        content = textBlock && "text" in textBlock ? textBlock.text : "";
      }

      return {
        content,
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
