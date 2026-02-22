import type { LLMService } from "../llm/service";
import { z } from "zod/v4";
import type { OrderContext, ClassifiedInstructions, ExtractedQuoteData } from "./types";
import { buildOrchestratorPrompt } from "./experts/prompts";
import { ExtractionExpert } from "./experts/extraction";
import { EscalationExpert } from "./experts/escalation";
import { NeedsExpert } from "./experts/needs";
import type {
  ExpertOpinion,
  ExtractionAnalysis,
  EscalationAnalysis,
  NeedsAnalysis,
  OrchestratorDecision,
  OrchestratorTrace,
  OrchestratorIteration,
  CounterTerms,
} from "./experts/types";

const MAX_ITERATIONS = 10;

const OrchestratorOutputSchema = z.object({
  readyToAct: z.boolean(),
  action: z.union([z.enum(["accept", "counter", "escalate", "clarify"]), z.null()]).optional().default(null),
  reasoning: z.string(),
  nextExpert: z.union([z.string(), z.null()]).optional().default(null),
  questionForExpert: z.union([z.string(), z.null()]).optional().default(null),
  counterTerms: z.union([
    z.object({
      targetPrice: z.number().optional(),
      targetQuantity: z.number().optional(),
      otherTerms: z.union([z.string(), z.null()]).optional().default(null),
    }),
    z.null(),
  ]).optional().default(null),
});

export interface OrchestratorResult {
  decision: OrchestratorDecision;
  trace: OrchestratorTrace;
  expertOpinions: ExpertOpinion[];
  extractedData: ExtractedQuoteData | null;
  extractionOpinion: ExpertOpinion;
  needsAnalysis?: NeedsAnalysis;
}

export class Orchestrator {
  private llmService: LLMService;
  private extractionExpert: ExtractionExpert;
  private escalationExpert: EscalationExpert;
  private needsExpert: NeedsExpert;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
    this.extractionExpert = new ExtractionExpert(llmService);
    this.escalationExpert = new EscalationExpert(llmService);
    this.needsExpert = new NeedsExpert(llmService);
  }

  async run(
    supplierMessage: string,
    orderContext: OrderContext,
    classifiedInstructions: ClassifiedInstructions,
    conversationHistory?: string,
    priorExtractedData?: Partial<ExtractedQuoteData>
  ): Promise<OrchestratorResult> {
    // Step 1: Parallel fan-out — extraction + escalation run simultaneously
    const extractionInput = {
      supplierMessage,
      conversationHistory,
      priorExtractedData,
    };

    const escalationInput = {
      supplierMessage,
      conversationHistory,
      escalationTriggers: classifiedInstructions.escalationTriggers,
      orderContext: {
        skuName: orderContext.skuName,
        supplierSku: orderContext.supplierSku,
      },
    };

    const [extractionOpinion, escalationOpinion] = await Promise.all([
      this.extractionExpert.analyze(extractionInput),
      this.escalationExpert.analyze(escalationInput),
    ]);

    // Get extracted data for passing to escalation re-consultation if needed
    const extractionAnalysis = extractionOpinion.analysis as ExtractionAnalysis;
    const extractedData = extractionAnalysis.extractedData;

    // Update escalation opinion with extracted data if we have it
    // (The initial escalation ran without extracted data; if needed,
    // the orchestrator can re-consult with extracted data)

    const opinions: ExpertOpinion[] = [extractionOpinion, escalationOpinion];
    const iterations: OrchestratorIteration[] = [];
    const priorDecisions: OrchestratorDecision[] = [];
    let needsAnalysis: NeedsAnalysis | undefined;

    // Step 2: Orchestrator loop
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const prompt = buildOrchestratorPrompt(
        supplierMessage,
        orderContext,
        classifiedInstructions,
        opinions.map(o => ({ expertName: o.expertName, analysis: o.analysis })),
        conversationHistory,
        priorDecisions.length > 0 ? priorDecisions.map(d => ({
          reasoning: d.reasoning,
          nextExpert: d.nextExpert,
          questionForExpert: d.questionForExpert,
        })) : undefined
      );

      let decision: OrchestratorDecision;

      try {
        const llmResult = await this.llmService.call(prompt);
        const parsed = JSON.parse(llmResult.response.content);
        const validated = OrchestratorOutputSchema.parse(parsed);

        decision = {
          readyToAct: validated.readyToAct,
          action: validated.action,
          reasoning: validated.reasoning,
          nextExpert: validated.nextExpert,
          questionForExpert: validated.questionForExpert,
          counterTerms: validated.counterTerms as CounterTerms | null,
        };
      } catch (error) {
        // LLM failure in orchestrator → escalate as safety valve
        decision = {
          readyToAct: true,
          action: "escalate",
          reasoning: `Orchestrator LLM failure: ${error instanceof Error ? error.message : String(error)}`,
          nextExpert: null,
          questionForExpert: null,
          counterTerms: null,
        };
      }

      if (decision.readyToAct && decision.action) {
        iterations.push({ decision });
        return {
          decision,
          trace: {
            iterations,
            finalDecision: decision,
            totalIterations: i + 1,
          },
          expertOpinions: opinions,
          extractedData,
          extractionOpinion,
          needsAnalysis,
        };
      }

      // Not ready — re-consult an expert
      if (decision.nextExpert) {
        const followUp = await this.reConsultExpert(
          decision.nextExpert,
          decision.questionForExpert ?? "",
          supplierMessage,
          classifiedInstructions,
          orderContext,
          extractedData,
          conversationHistory
        );

        // Track needs analysis for response crafter
        if (decision.nextExpert === "needs" && followUp.analysis.type === "needs") {
          needsAnalysis = followUp.analysis as NeedsAnalysis;
        }

        opinions.push(followUp);
        iterations.push({ decision, reConsultedExpert: decision.nextExpert, followUpOpinion: followUp });
        priorDecisions.push(decision);
      } else {
        // No expert specified — shouldn't happen, but treat as ready with best guess
        iterations.push({ decision });
        priorDecisions.push(decision);
      }
    }

    // Safety valve: max iterations reached → escalate
    const safetyDecision: OrchestratorDecision = {
      readyToAct: true,
      action: "escalate",
      reasoning: "Orchestrator reached maximum iteration limit — escalating for safety",
      nextExpert: null,
      questionForExpert: null,
      counterTerms: null,
    };

    return {
      decision: safetyDecision,
      trace: {
        iterations,
        finalDecision: safetyDecision,
        totalIterations: MAX_ITERATIONS,
      },
      expertOpinions: opinions,
      extractedData,
      extractionOpinion,
      needsAnalysis,
    };
  }

  private async reConsultExpert(
    expertName: string,
    question: string,
    supplierMessage: string,
    classifiedInstructions: ClassifiedInstructions,
    orderContext: OrderContext,
    extractedData: ExtractedQuoteData | null,
    conversationHistory?: string
  ): Promise<ExpertOpinion> {
    switch (expertName) {
      case "extraction":
        return this.extractionExpert.analyze({
          supplierMessage,
          conversationHistory,
          additionalQuestion: question,
        });

      case "escalation":
        return this.escalationExpert.analyze({
          supplierMessage,
          conversationHistory,
          escalationTriggers: classifiedInstructions.escalationTriggers,
          extractedData: extractedData ?? undefined,
          orderContext: {
            skuName: orderContext.skuName,
            supplierSku: orderContext.supplierSku,
          },
          additionalQuestion: question,
        });

      case "needs":
        return this.needsExpert.analyze({
          extractedData,
          negotiationRules: classifiedInstructions.negotiationRules,
          orderContext: {
            skuName: orderContext.skuName,
            supplierSku: orderContext.supplierSku,
            quantityRequested: orderContext.quantityRequested,
          },
          conversationHistory,
          additionalQuestion: question,
        });

      default:
        // Unknown expert → return empty opinion
        return {
          expertName: expertName,
          analysis: {
            type: "needs" as const,
            missingFields: [],
            prioritizedQuestions: [],
            reasoning: `Unknown expert "${expertName}" requested`,
          },
          provider: "none",
          model: "none",
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
    }
  }
}
