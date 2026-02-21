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
import { InstructionClassifier } from "./instruction-classifier";
import { buildInitialEmailPrompt } from "./prompts";
import { parseResponseGenerationOutput } from "./output-parser";
import type { ExtractedQuoteData as PartialQuote } from "./types";
import {
  checkPrePolicyEscalation,
  makeDecision,
  type DecisionOutput,
} from "./decision-engine";

function formatPriorDataForPrompt(data: Partial<PartialQuote>): string {
  const lines: string[] = [];
  if (data.quotedPrice !== undefined && data.quotedPrice !== null) lines.push(`Price: ${data.quotedPrice} ${data.quotedPriceCurrency ?? "USD"}`);
  if (data.availableQuantity !== undefined && data.availableQuantity !== null) lines.push(`Quantity: ${data.availableQuantity}`);
  if (data.moq !== undefined && data.moq !== null) lines.push(`MOQ: ${data.moq}`);
  if (data.leadTimeMinDays !== undefined && data.leadTimeMinDays !== null) {
    const lt = data.leadTimeMaxDays && data.leadTimeMaxDays !== data.leadTimeMinDays
      ? `${data.leadTimeMinDays}-${data.leadTimeMaxDays} days`
      : `${data.leadTimeMinDays} days`;
    lines.push(`Lead Time: ${lt}`);
  }
  if (data.paymentTerms) lines.push(`Payment: ${data.paymentTerms}`);
  if (data.validityPeriod) lines.push(`Validity: ${data.validityPeriod}`);
  return lines.length > 0 ? lines.join("\n") : "No prior data.";
}

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
  private instructionClassifier: InstructionClassifier;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
    this.extractor = new Extractor(llmService);
    this.policyEvaluator = new PolicyEvaluator(llmService);
    this.responseGenerator = new ResponseGenerator(llmService);
    this.instructionClassifier = new InstructionClassifier(llmService);
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
    // Stage 0: Classify merchant instructions if provided as single field
    let { negotiationRules, escalationTriggers } = request;
    let orderContext = request.orderContext;

    if (request.merchantInstructions) {
      const classified = await this.instructionClassifier.classify(
        request.merchantInstructions,
        request.orderContext
      );
      negotiationRules = classified.negotiationRules || negotiationRules;
      escalationTriggers = classified.escalationTriggers || escalationTriggers;
      if (classified.specialInstructions) {
        orderContext = {
          ...request.orderContext,
          specialInstructions: classified.specialInstructions,
        };
      }
    }

    // Stage 1: Extract data from supplier email (with conversation context if available)
    const extraction = await this.extractor.extract(
      request.supplierMessage,
      request.conversationHistory,
      request.priorExtractedData
        ? formatPriorDataForPrompt(request.priorExtractedData)
        : undefined
    );

    // Stage 2: Deterministic pre-policy checks
    const preCheck = checkPrePolicyEscalation(extraction);
    if (preCheck) {
      return this.buildEscalationResponse(extraction, preCheck.reasoning);
    }

    // Stage 3: Policy evaluation + decision (single LLM call)
    const policyResult = await this.policyEvaluator.evaluate(
      extraction.data!,
      negotiationRules,
      escalationTriggers,
      orderContext
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
      orderContext,
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
