import type { LLMService } from "../llm/service";
import type {
  AgentAction,
  ExtractedQuoteData,
  GeneratedResponse,
  OrderInformation,
  PolicyEvaluationResult,
} from "./types";
import { buildCounterOfferPrompt, buildClarificationPrompt } from "./prompts";
import { parseResponseGenerationOutput } from "./output-parser";

export class ResponseGenerator {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async generate(
    action: AgentAction,
    extractedData: ExtractedQuoteData,
    policyEvaluation: PolicyEvaluationResult | null,
    orderInformation: OrderInformation,
    reasoning: string
  ): Promise<GeneratedResponse> {
    switch (action) {
      case "accept":
        return this.buildAcceptResponse(extractedData, orderInformation, reasoning);
      case "counter":
        return this.buildCounterResponse(
          extractedData,
          policyEvaluation,
          orderInformation,
          reasoning
        );
      case "clarify":
        return this.buildClarifyResponse(extractedData, orderInformation, reasoning);
      case "escalate":
        return { escalationReason: reasoning };
    }
  }

  private buildAcceptResponse(
    data: ExtractedQuoteData,
    orderInformation: OrderInformation,
    reasoning: string
  ): GeneratedResponse {
    const quantity = data.availableQuantity ?? orderInformation.quantity.targetQuantity;
    const price = data.quotedPriceUsd ?? data.quotedPrice ?? 0;
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

  private async buildCounterResponse(
    data: ExtractedQuoteData,
    policyEvaluation: PolicyEvaluationResult | null,
    orderInformation: OrderInformation,
    reasoning: string
  ): Promise<GeneratedResponse> {
    const counterTerms = policyEvaluation?.counterTerms ?? {};

    const prompt = buildCounterOfferPrompt(
      data,
      reasoning,
      counterTerms,
      orderInformation
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

  private async buildClarifyResponse(
    data: ExtractedQuoteData,
    orderInformation: OrderInformation,
    reasoning: string
  ): Promise<GeneratedResponse> {
    const notes = [reasoning];
    const prompt = buildClarificationPrompt(data, notes, orderInformation);

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
