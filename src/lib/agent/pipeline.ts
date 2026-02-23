import type { LLMService } from "../llm/service";
import type {
  AgentProcessRequest,
  AgentProcessResponse,
  ComplianceStatus,
  ExtractionResult,
  OrderInformation,
} from "./types";
import { buildInitialEmailPrompt } from "./prompts";
import { parseResponseGenerationOutput } from "./output-parser";
import { Orchestrator } from "./orchestrator";
import { ResponseCrafter } from "./experts/response-crafter";
import type {
  ExtractionAnalysis,
  EscalationAnalysis,
  ExpertOpinion,
} from "./experts/types";

export interface InitialEmailResult {
  emailText: string;
  subjectLine: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export class AgentPipeline {
  private llmService: LLMService;
  private orchestrator: Orchestrator;
  private responseCrafter: ResponseCrafter;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
    this.orchestrator = new Orchestrator(llmService);
    this.responseCrafter = new ResponseCrafter(llmService);
  }

  async generateInitialEmail(orderInformation: OrderInformation): Promise<InitialEmailResult> {
    const prompt = buildInitialEmailPrompt(orderInformation);
    const llmResult = await this.llmService.call(prompt);
    const parsed = parseResponseGenerationOutput(llmResult.response.content);

    if (!parsed.success || !parsed.data) {
      throw new Error(`Initial email generation failed: ${parsed.error}`);
    }

    let subjectLine = "Quote Request";
    try {
      const raw = JSON.parse(llmResult.response.content);
      if (raw.subjectLine) subjectLine = raw.subjectLine;
    } catch {
      // Fall back to default
    }

    return {
      emailText: parsed.data.emailText,
      subjectLine,
      provider: llmResult.response.provider,
      model: llmResult.response.model,
      latencyMs: llmResult.response.latencyMs,
      inputTokens: llmResult.response.inputTokens,
      outputTokens: llmResult.response.outputTokens,
    };
  }

  async process(request: AgentProcessRequest): Promise<AgentProcessResponse> {
    // Stage 1-2: Orchestrator runs experts in parallel, makes decision via LLM loop
    const orchestratorResult = await this.orchestrator.run(
      request.supplierMessage,
      request.orderInformation,
      request.conversationHistory,
      request.priorExtractedData,
      request.turnNumber
    );

    const { decision, trace, expertOpinions, extractedData, extractionOpinion, needsAnalysis } = orchestratorResult;

    // Build extraction result for backward compatibility
    const extractionAnalysis = extractionOpinion.analysis as ExtractionAnalysis;
    const extraction: ExtractionResult = {
      success: extractionAnalysis.success,
      data: extractionAnalysis.extractedData,
      confidence: extractionAnalysis.confidence,
      notes: extractionAnalysis.notes,
      error: extractionAnalysis.error,
      provider: extractionOpinion.provider,
      model: extractionOpinion.model,
      latencyMs: extractionOpinion.latencyMs,
      inputTokens: extractionOpinion.inputTokens,
      outputTokens: extractionOpinion.outputTokens,
      retryCount: 0,
    };

    const action = decision.action!;

    // Stage 3: Craft response (conditional LLM call for counter/clarify)
    const generatedResponse = await this.responseCrafter.craft({
      action,
      reasoning: decision.reasoning,
      extractedData,
      orderInformation: request.orderInformation,
      conversationHistory: request.conversationHistory,
      counterTerms: decision.counterTerms ?? undefined,
      needsAnalysis,
    });

    // Compute backward-compatible policyEvaluation from expert opinions
    const policyEvaluation = this.buildPolicyEvaluation(expertOpinions, decision.reasoning, action);

    // Compute observability totals
    const allOpinionMetrics = expertOpinions.map(o => ({
      latencyMs: o.latencyMs,
      inputTokens: o.inputTokens,
      outputTokens: o.outputTokens,
    }));
    const totalLLMCalls = expertOpinions.filter(o => o.provider !== "none").length
      + trace.totalIterations
      + (generatedResponse.provider ? 1 : 0);
    const totalLatencyMs = allOpinionMetrics.reduce((s, m) => s + m.latencyMs, 0)
      + (generatedResponse.latencyMs ?? 0);
    const totalInputTokens = allOpinionMetrics.reduce((s, m) => s + m.inputTokens, 0)
      + (generatedResponse.inputTokens ?? 0);
    const totalOutputTokens = allOpinionMetrics.reduce((s, m) => s + m.outputTokens, 0)
      + (generatedResponse.outputTokens ?? 0);

    return {
      action,
      reasoning: decision.reasoning,
      extractedData,
      extraction,
      counterOffer: generatedResponse.counterOffer,
      proposedApproval: generatedResponse.proposedApproval,
      escalationReason: generatedResponse.escalationReason,
      clarificationEmail: generatedResponse.clarificationEmail,
      policyEvaluation,
      responseGeneration: generatedResponse.provider
        ? {
            provider: generatedResponse.provider,
            model: generatedResponse.model!,
            latencyMs: generatedResponse.latencyMs!,
            inputTokens: generatedResponse.inputTokens!,
            outputTokens: generatedResponse.outputTokens!,
          }
        : undefined,
      // New orchestration fields
      expertOpinions,
      orchestratorTrace: trace,
      totalLLMCalls,
      totalLatencyMs,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  private buildPolicyEvaluation(
    opinions: ExpertOpinion[],
    reasoning: string,
    action: string
  ): AgentProcessResponse["policyEvaluation"] {
    // Synthesize compliance from expert opinions
    const escalationOpinion = opinions.find(o => o.expertName === "escalation");
    const escalationAnalysis = escalationOpinion?.analysis as EscalationAnalysis | undefined;

    let complianceStatus: ComplianceStatus;
    if (escalationAnalysis?.shouldEscalate) {
      complianceStatus = "non_compliant";
    } else if (action === "accept") {
      complianceStatus = "compliant";
    } else if (action === "counter") {
      complianceStatus = "non_compliant";
    } else {
      complianceStatus = "partial";
    }

    const rulesMatched = escalationAnalysis?.triggersEvaluated ?? [];

    return {
      rulesMatched,
      complianceStatus,
      details: reasoning,
    };
  }
}
