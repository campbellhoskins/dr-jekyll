import type { LLMService } from "../../llm/service";
import type {
  AgentAction,
  ExtractedQuoteData,
  OrderInformation,
  CounterOffer,
  ProposedApproval,
  GeneratedResponse,
} from "../types";
import { parseResponseGenerationOutput } from "../output-parser";
import { buildCounterOfferCrafterPrompt, buildClarificationCrafterPrompt } from "./prompts";
import type { CounterTerms, NeedsAnalysis, ResponseCrafterInput } from "./types";

/**
 * Response Crafter — drafts the output based on the orchestrator's decision.
 * Receives the decision + context for drafting, NOT raw negotiation rules.
 * When clarifying, uses NeedsAnalysis to know exactly what to ask.
 */
export class ResponseCrafter {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async craft(input: ResponseCrafterInput): Promise<GeneratedResponse> {
    switch (input.action) {
      case "accept":
        return this.buildAcceptResponse(input.extractedData, input.orderInformation, input.reasoning);
      case "counter":
        return this.buildCounterResponse(input);
      case "clarify":
        return this.buildClarifyResponse(input);
      case "escalate":
        return { escalationReason: input.reasoning };
    }
  }

  private buildAcceptResponse(
    data: ExtractedQuoteData | null,
    orderInformation: OrderInformation,
    reasoning: string
  ): GeneratedResponse {
    const quantity = data?.availableQuantity ?? orderInformation.quantity.targetQuantity;
    const price = data?.quotedPriceUsd ?? data?.quotedPrice ?? 0;
    const total = Math.round(quantity * price * 100) / 100;

    return {
      proposedApproval: {
        quantity,
        price,
        total,
        summary: reasoning,
      },
    };
  }

  private async buildCounterResponse(input: ResponseCrafterInput): Promise<GeneratedResponse> {
    const counterTerms = input.counterTerms ?? {};

    const prompt = buildCounterOfferCrafterPrompt(
      input.extractedData!,
      input.reasoning,
      counterTerms,
      input.orderInformation,
      input.conversationHistory
    );

    try {
      const llmResult = await this.llmService.call(prompt);
      const parsed = parseResponseGenerationOutput(llmResult.response.content);

      if (!parsed.success || !parsed.data) {
        return {
          escalationReason: `Counter-offer generation failed: ${parsed.error}`,
        };
      }

      return {
        counterOffer: {
          draftEmail: parsed.data.emailText,
          proposedTerms: parsed.data.proposedTermsSummary,
        },
        provider: llmResult.response.provider,
        model: llmResult.response.model,
        latencyMs: llmResult.response.latencyMs,
        inputTokens: llmResult.response.inputTokens,
        outputTokens: llmResult.response.outputTokens,
      };
    } catch (error) {
      return {
        escalationReason: `Counter-offer generation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async buildClarifyResponse(input: ResponseCrafterInput): Promise<GeneratedResponse> {
    const prompt = buildClarificationCrafterPrompt(
      input.extractedData,
      input.reasoning,
      input.orderInformation,
      input.needsAnalysis,
      input.conversationHistory
    );

    try {
      const llmResult = await this.llmService.call(prompt);
      const parsed = parseResponseGenerationOutput(llmResult.response.content);

      if (!parsed.success || !parsed.data) {
        return {
          escalationReason: `Clarification generation failed: ${parsed.error}`,
        };
      }

      return {
        clarificationEmail: parsed.data.emailText,
        provider: llmResult.response.provider,
        model: llmResult.response.model,
        latencyMs: llmResult.response.latencyMs,
        inputTokens: llmResult.response.inputTokens,
        outputTokens: llmResult.response.outputTokens,
      };
    } catch (error) {
      return {
        escalationReason: `Clarification generation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
