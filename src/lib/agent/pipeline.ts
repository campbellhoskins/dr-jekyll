import type { LLMService } from "../llm/service";
import type {
  AgentProcessRequest,
  AgentProcessResponse,
  ComplianceStatus,
  ExtractionResult,
  PolicyEvaluationResult,
} from "./types";
import { Extractor } from "./extractor";
import { PolicyEvaluator } from "./policy-evaluator";
import { ResponseGenerator } from "./response-generator";
import {
  checkPrePolicyEscalation,
  makeDecision,
  type DecisionOutput,
} from "./decision-engine";

export class AgentPipeline {
  private extractor: Extractor;
  private policyEvaluator: PolicyEvaluator;
  private responseGenerator: ResponseGenerator;

  constructor(llmService: LLMService) {
    this.extractor = new Extractor(llmService);
    this.policyEvaluator = new PolicyEvaluator(llmService);
    this.responseGenerator = new ResponseGenerator(llmService);
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
      },
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
