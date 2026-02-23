import type { LLMService } from "../llm/service";
import type {
  AgentProcessRequest,
  AgentProcessResponse,
  OrderInformation,
  RulesGenerationResult,
} from "./types";
import { buildInitialEmailPrompt, buildRulesGenerationPrompt, buildAgentPrompt } from "./prompts";
import { extractXmlTag, parseDecision } from "./xml-parser";

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

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async generateInitialEmail(orderInformation: OrderInformation): Promise<InitialEmailResult> {
    const prompt = buildInitialEmailPrompt(orderInformation);
    const llmResult = await this.llmService.call(prompt);

    let emailText = "";
    let subjectLine = "Quote Request";
    try {
      const raw = JSON.parse(llmResult.response.content);
      emailText = raw.emailText ?? "";
      if (raw.subjectLine) subjectLine = raw.subjectLine;
    } catch {
      emailText = llmResult.response.content;
    }

    return {
      emailText,
      subjectLine,
      provider: llmResult.response.provider,
      model: llmResult.response.model,
      latencyMs: llmResult.response.latencyMs,
      inputTokens: llmResult.response.inputTokens,
      outputTokens: llmResult.response.outputTokens,
    };
  }

  async generateRules(orderInformation: OrderInformation): Promise<RulesGenerationResult> {
    const prompt = buildRulesGenerationPrompt(orderInformation);
    const llmResult = await this.llmService.call(prompt);
    const content = llmResult.response.content;

    const orderContext = extractXmlTag(content, "order_context") ?? "";
    const merchantRules = extractXmlTag(content, "merchant_rules") ?? "";

    return {
      orderContext,
      merchantRules,
      provider: llmResult.response.provider,
      model: llmResult.response.model,
      latencyMs: llmResult.response.latencyMs,
      inputTokens: llmResult.response.inputTokens,
      outputTokens: llmResult.response.outputTokens,
    };
  }

  async process(request: AgentProcessRequest): Promise<AgentProcessResponse> {
    // Step 1: Generate rules if not cached
    let orderContext = request.cachedOrderContext ?? "";
    let merchantRules = request.cachedMerchantRules ?? "";
    let rulesLatencyMs = 0;
    let rulesInputTokens = 0;
    let rulesOutputTokens = 0;

    if (!orderContext || !merchantRules) {
      const rules = await this.generateRules(request.orderInformation);
      orderContext = rules.orderContext;
      merchantRules = rules.merchantRules;
      rulesLatencyMs = rules.latencyMs;
      rulesInputTokens = rules.inputTokens;
      rulesOutputTokens = rules.outputTokens;
    }

    // Step 2: Single agent call
    const agentPrompt = buildAgentPrompt(
      request.conversationHistory ?? "",
      orderContext,
      merchantRules,
      request.supplierMessage
    );
    const agentResult = await this.llmService.call(agentPrompt);
    const rawOutput = agentResult.response.content;

    // Step 3: Parse XML output
    const reasoning = extractXmlTag(rawOutput, "systematic_evaluation") ?? "";
    const decisionText = extractXmlTag(rawOutput, "decision") ?? "";
    const responseText = extractXmlTag(rawOutput, "response") ?? "";
    const { action } = parseDecision(decisionText);

    return {
      action,
      reasoning,
      decision: decisionText,
      responseText,
      orderContext,
      merchantRules,
      provider: agentResult.response.provider,
      model: agentResult.response.model,
      latencyMs: agentResult.response.latencyMs + rulesLatencyMs,
      inputTokens: agentResult.response.inputTokens + rulesInputTokens,
      outputTokens: agentResult.response.outputTokens + rulesOutputTokens,
    };
  }
}
