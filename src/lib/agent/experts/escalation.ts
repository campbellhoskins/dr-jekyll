import type { LLMService } from "../../llm/service";
import { z } from "zod/v4";
import { buildEscalationPrompt } from "./prompts";
import type {
  ExpertOpinion,
  EscalationAnalysis,
  EscalationExpertInput,
} from "./types";

const EscalationOutputSchema = z.object({
  shouldEscalate: z.boolean(),
  reasoning: z.string(),
  triggersEvaluated: z.array(z.string()).default([]),
  triggeredTriggers: z.array(z.string()).default([]),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
});

/**
 * Escalation Expert — evaluates supplier message against escalation triggers via LLM.
 * Receives triggers + supplier message + extracted data.
 * Does NOT see negotiation rules, target prices, or special instructions.
 */
export class EscalationExpert {
  readonly name = "escalation" as const;
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async analyze(input: EscalationExpertInput): Promise<ExpertOpinion> {
    // If no escalation triggers provided, return a no-escalation opinion immediately
    if (!input.escalationTriggers || input.escalationTriggers.trim() === "") {
      return this.buildNoTriggersOpinion();
    }

    try {
      const prompt = buildEscalationPrompt(
        input.supplierMessage,
        input.escalationTriggers,
        input.extractedData,
        input.orderContext,
        input.conversationHistory,
        input.additionalQuestion
      );

      const llmResult = await this.llmService.call(prompt);
      const parsed = JSON.parse(llmResult.response.content);
      const validated = EscalationOutputSchema.parse(parsed);

      const analysis: EscalationAnalysis = {
        type: "escalation",
        shouldEscalate: validated.shouldEscalate,
        reasoning: validated.reasoning,
        triggersEvaluated: validated.triggersEvaluated,
        triggeredTriggers: validated.triggeredTriggers,
        severity: validated.severity,
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
      // On LLM failure, return escalation as safety fallback
      const analysis: EscalationAnalysis = {
        type: "escalation",
        shouldEscalate: true,
        reasoning: `Escalation evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        triggersEvaluated: [],
        triggeredTriggers: [],
        severity: "high",
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

  private buildNoTriggersOpinion(): ExpertOpinion {
    const analysis: EscalationAnalysis = {
      type: "escalation",
      shouldEscalate: false,
      reasoning: "No escalation triggers provided",
      triggersEvaluated: [],
      triggeredTriggers: [],
      severity: "low",
    };

    return {
      expertName: this.name,
      analysis,
      provider: "none",
      model: "none",
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
