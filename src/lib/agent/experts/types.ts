import type { ExtractedQuoteData, OrderContext, AgentAction } from "../types";

// ─── Expert Opinion (common output shape) ────────────────────────────────────

export interface ExpertOpinion {
  expertName: string;
  analysis: ExtractionAnalysis | EscalationAnalysis | NeedsAnalysis;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

// ─── Analysis shapes (one per expert) ────────────────────────────────────────

export interface ExtractionAnalysis {
  type: "extraction";
  extractedData: ExtractedQuoteData | null;
  confidence: number;
  notes: string[];
  success: boolean;
  error: string | null;
}

export interface EscalationAnalysis {
  type: "escalation";
  shouldEscalate: boolean;
  reasoning: string;
  triggersEvaluated: string[];
  triggeredTriggers: string[];
  severity: "low" | "medium" | "high" | "critical";
}

export interface NeedsAnalysis {
  type: "needs";
  missingFields: string[];
  prioritizedQuestions: string[];
  reasoning: string;
}

// ─── Expert-specific inputs (tailored — each expert sees only what it needs) ─

export interface ExtractionExpertInput {
  supplierMessage: string;
  conversationHistory?: string;
  priorExtractedData?: Partial<ExtractedQuoteData>;
  additionalQuestion?: string;
}

export interface EscalationExpertInput {
  supplierMessage: string;
  conversationHistory?: string;
  escalationTriggers: string;
  extractedData?: ExtractedQuoteData;
  orderContext: {
    skuName: string;
    supplierSku: string;
  };
  additionalQuestion?: string;
}

export interface NeedsExpertInput {
  extractedData: ExtractedQuoteData | null;
  negotiationRules: string;
  orderContext: {
    skuName: string;
    supplierSku: string;
    quantityRequested: string;
  };
  conversationHistory?: string;
  additionalQuestion?: string;
}

// ─── Response Crafter input ──────────────────────────────────────────────────

export interface ResponseCrafterInput {
  action: AgentAction;
  reasoning: string;
  extractedData: ExtractedQuoteData | null;
  orderContext: OrderContext;
  conversationHistory?: string;
  specialInstructions?: string;
  counterTerms?: CounterTerms;
  needsAnalysis?: NeedsAnalysis;
}

// ─── Orchestrator types ──────────────────────────────────────────────────────

export interface CounterTerms {
  targetPrice?: number;
  targetQuantity?: number;
  otherTerms?: string;
}

export interface OrchestratorDecision {
  readyToAct: boolean;
  action: AgentAction | null;
  reasoning: string;
  nextExpert: string | null;
  questionForExpert: string | null;
  counterTerms: CounterTerms | null;
}

export interface OrchestratorInput {
  supplierMessage: string;
  conversationHistory?: string;
  orderContext: OrderContext;
  classifiedInstructions: {
    negotiationRules: string;
    escalationTriggers: string;
    specialInstructions: string;
  };
  expertOpinions: ExpertOpinion[];
  priorOrchestratorDecisions: OrchestratorDecision[];
}

// ─── Orchestrator trace (for observability) ──────────────────────────────────

export interface OrchestratorTrace {
  iterations: OrchestratorIteration[];
  finalDecision: OrchestratorDecision;
  totalIterations: number;
}

export interface OrchestratorIteration {
  decision: OrchestratorDecision;
  reConsultedExpert?: string;
  followUpOpinion?: ExpertOpinion;
}
