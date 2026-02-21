import type { LLMService } from "../llm/service";
import type { ClassifiedInstructions, OrderContext } from "./types";
import { LLMInstructionClassificationSchema } from "./types";
import { buildInstructionClassificationPrompt } from "./prompts";
import { extractJson } from "./output-parser";

export class InstructionClassifier {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async classify(
    merchantInstructions: string,
    orderContext: OrderContext
  ): Promise<ClassifiedInstructions> {
    // If the input is empty, return empty classifications
    if (!merchantInstructions.trim()) {
      return {
        negotiationRules: "",
        escalationTriggers: "",
        specialInstructions: "",
      };
    }

    const prompt = buildInstructionClassificationPrompt(
      merchantInstructions,
      orderContext
    );

    try {
      const llmResult = await this.llmService.call(prompt);
      const raw = llmResult.response.content;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const json = extractJson(raw);
        if (!json) {
          return this.fallback(merchantInstructions);
        }
        parsed = JSON.parse(json);
      }

      const validation = LLMInstructionClassificationSchema.safeParse(parsed);
      if (!validation.success) {
        return this.fallback(merchantInstructions);
      }

      return validation.data;
    } catch {
      // If LLM fails entirely, put everything in negotiation rules as a safe default
      return this.fallback(merchantInstructions);
    }
  }

  private fallback(merchantInstructions: string): ClassifiedInstructions {
    return {
      negotiationRules: merchantInstructions,
      escalationTriggers: "",
      specialInstructions: "",
    };
  }
}
