import type { LLMService } from "../llm/service";
import type {
  AgentProcessRequest,
  AgentProcessResponse,
  ComplianceStatus,
  ExtractionResult,
  OrderContext,
  PolicyEvaluationResult,
} from "./types";
import { Extractor } from "./extractor";
import { PolicyEvaluator } from "./policy-evaluator";
import { ResponseGenerator } from "./response-generator";
import { buildInitialEmailPrompt } from "./prompts";
import { parseResponseGenerationOutput } from "./output-parser";
import {
  checkPrePolicyEscalation,
  makeDecision,
  type DecisionOutput,
} from "./decision-engine";

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
  private extractor: Extractor;
  private policyEvaluator: PolicyEvaluator;
  private responseGenerator: ResponseGenerator;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
    this.extractor = new Extractor(llmService);
    this.policyEvaluator = new PolicyEvaluator(llmService);
    this.responseGenerator = new ResponseGenerator(llmService);
  }

  async generateInitialEmail(orderContext: OrderContext): Promise<InitialEmailResult> {
    const prompt = buildInitialEmailPrompt(orderContext);
    const llmResult = await this.llmService.call(prompt);
    const parsed = parseResponseGenerationOutput(llmResult.response.content);

    if (!parsed.success || !parsed.data) {
      throw new Error(`Initial email generation failed: ${parsed.error}`);
    }

    // subjectLine comes through the structured output schema directly
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
    // Stage 1: Extract data from supplier email
    const extraction = await this.extractor.extract(request.supplierMessage);

    // Stage 2: Deterministic pre-policy checks
    const preCheck = checkPrePolicyEscalation(extraction);
    if (preCheck) {
      return this.buildEscalationResponse(extraction, preCheck.reasoning);
    }

    // Stage 3: Policy evaluation + decision (single LLM call)
    const policyResult = await this.policyEvaluator.evaluate(
      extraction.data!,
      request.negotiationRules,
      request.escalationTriggers,
      request.orderContext
    );

    // Stage 4: Final decision (deterministic overrides)
    const decision = makeDecision({
      extraction,
      policyEvaluation: policyResult,
    });

    // Stage 5: Generate response (conditional LLM call)
    const generatedResponse = await this.responseGenerator.generate(
      decision.action,
      extraction.data!,
      policyResult,
      request.orderContext,
      decision.reasoning
    );

    // Stage 6: Assemble final response
    return {
      action: decision.action,
      reasoning: decision.reasoning,
      extractedData: extraction.data,
      extraction,
      counterOffer: generatedResponse.counterOffer,
      proposedApproval: generatedResponse.proposedApproval,
      escalationReason: generatedResponse.escalationReason,
      clarificationEmail: generatedResponse.clarificationEmail,
      policyEvaluation: {
        rulesMatched: policyResult.rulesMatched,
        complianceStatus: policyResult.complianceStatus,
        details: policyResult.reasoning,
        provider: policyResult.provider,
        model: policyResult.model,
        latencyMs: policyResult.latencyMs,
        inputTokens: policyResult.inputTokens,
        outputTokens: policyResult.outputTokens,
      },
      responseGeneration: generatedResponse.provider
        ? {
            provider: generatedResponse.provider,
            model: generatedResponse.model!,
            latencyMs: generatedResponse.latencyMs!,
            inputTokens: generatedResponse.inputTokens!,
            outputTokens: generatedResponse.outputTokens!,
          }
        : undefined,
    };
  }

  private buildEscalationResponse(
    extraction: ExtractionResult,
    reasoning: string
  ): AgentProcessResponse {
    return {
      action: "escalate",
      reasoning,
      extractedData: extraction.data,
      extraction,
      escalationReason: reasoning,
      policyEvaluation: {
        rulesMatched: [],
        complianceStatus: "non_compliant" as ComplianceStatus,
        details: "Escalated before policy evaluation",
      },
    };
  }
}
