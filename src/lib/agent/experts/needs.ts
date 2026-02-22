import type { LLMService } from "../../llm/service";
import { z } from "zod/v4";
import { buildNeedsPrompt } from "./prompts";
import type {
  ExpertOpinion,
  NeedsAnalysis,
  NeedsExpertInput,
} from "./types";

const NeedsOutputSchema = z.object({
  missingFields: z.array(z.string()).default([]),
  prioritizedQuestions: z.array(z.string()).default([]),
  reasoning: z.string(),
});

/**
 * Needs Expert — identifies information gaps in the supplier's quote.
 * Called on-demand by the orchestrator when extraction shows gaps.
 * Receives extracted data + negotiation rules (to know which fields matter).
 * Does NOT see escalation triggers, target prices, or special instructions.
 */
export class NeedsExpert {
  readonly name = "needs" as const;
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async analyze(input: NeedsExpertInput): Promise<ExpertOpinion> {
    try {
      const prompt = buildNeedsPrompt(
        input.extractedData,
        input.negotiationRules,
        input.orderContext,
        input.conversationHistory,
        input.additionalQuestion
      );

      const llmResult = await this.llmService.call(prompt);
      const parsed = JSON.parse(llmResult.response.content);
      const validated = NeedsOutputSchema.parse(parsed);

      const analysis: NeedsAnalysis = {
        type: "needs",
        missingFields: validated.missingFields,
        prioritizedQuestions: validated.prioritizedQuestions,
        reasoning: validated.reasoning,
      };

      return {
        expertName: this.name,
        analysis,
        provider: llmResult.response.provider,
        model: llmResult.response.model,
        latencyMs: llmResult.response.latencyMs,
        inputTokens: llmResult.response.inputTokens,
        outputTokens: llmResult.response.outputTokens,
      };
    } catch (error) {
      // On failure, return empty needs analysis
      const analysis: NeedsAnalysis = {
        type: "needs",
        missingFields: [],
        prioritizedQuestions: [],
        reasoning: `Needs analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      };

      return {
        expertName: this.name,
        analysis,
        provider: "unknown",
        model: "unknown",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }
}
