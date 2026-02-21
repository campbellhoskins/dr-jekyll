import type { LLMService } from "../llm/service";
import type {
  ExtractedQuoteData,
  OrderContext,
  PolicyEvaluationResult,
} from "./types";
import { buildPolicyDecisionPrompt } from "./prompts";
import { parsePolicyDecisionOutput } from "./output-parser";

export class PolicyEvaluator {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async evaluate(
    extractedData: ExtractedQuoteData,
    negotiationRules: string,
    escalationTriggers: string,
    orderContext: OrderContext
  ): Promise<PolicyEvaluationResult> {
    const prompt = buildPolicyDecisionPrompt(
      extractedData,
      negotiationRules,
      escalationTriggers,
      orderContext
    );

    let llmContent: string;
    let provider: string;
    let model: string;
    let latencyMs: number;
    let inputTokens: number;
    let outputTokens: number;

    try {
      const llmResult = await this.llmService.call(prompt);
      llmContent = llmResult.response.content;
      provider = llmResult.response.provider;
      model = llmResult.response.model;
      latencyMs = llmResult.response.latencyMs;
      inputTokens = llmResult.response.inputTokens;
      outputTokens = llmResult.response.outputTokens;
    } catch (error) {
      return this.buildEscalationResult(
        `Policy evaluation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const parsed = parsePolicyDecisionOutput(llmContent);

    if (!parsed.success || !parsed.data) {
      return this.buildEscalationResult(
        `Policy evaluation output unparseable: ${parsed.error}`,
        provider,
        model,
        latencyMs
      );
    }

    const data = parsed.data;

    return {
      rulesMatched: data.rulesMatched,
      complianceStatus: data.complianceStatus,
      recommendedAction: data.recommendedAction,
      reasoning: data.reasoning,
      escalationTriggered: data.escalationTriggered,
      escalationReason: data.escalationReason ?? undefined,
      counterTerms: data.counterTerms ?? undefined,
      provider: provider!,
      model: model!,
      latencyMs: latencyMs!,
      inputTokens: inputTokens!,
      outputTokens: outputTokens!,
    };
  }

  private buildEscalationResult(
    reasoning: string,
    provider = "unknown",
    model = "unknown",
    latencyMs = 0
  ): PolicyEvaluationResult {
    return {
      rulesMatched: [],
      complianceStatus: "non_compliant",
      recommendedAction: "escalate",
      reasoning,
      escalationTriggered: true,
      escalationReason: reasoning,
      provider,
      model,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
