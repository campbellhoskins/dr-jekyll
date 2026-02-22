// B1: Extraction
export { Extractor } from "./extractor";
export { buildExtractionPrompt } from "./prompts";
export { parseExtractionOutput, extractJson } from "./output-parser";
export { normalizeCurrency, LLMExtractionOutputSchema } from "./types";

// B1.5: Pipeline + Orchestration
export { AgentPipeline, type InitialEmailResult } from "./pipeline";
export { Orchestrator, type OrchestratorResult } from "./orchestrator";
export { ConversationContext, type ConversationMessage } from "./conversation-context";
export { InstructionClassifier } from "./instruction-classifier";

// Experts
export { ExtractionExpert } from "./experts/extraction";
export { EscalationExpert } from "./experts/escalation";
export { NeedsExpert } from "./experts/needs";
export { ResponseCrafter } from "./experts/response-crafter";

// Expert prompts
export {
  buildEscalationPrompt,
  buildNeedsPrompt,
  buildOrchestratorPrompt,
  buildCounterOfferCrafterPrompt,
  buildClarificationCrafterPrompt,
} from "./experts/prompts";

// Legacy prompts (instruction classification + initial email still in main prompts.ts)
export {
  buildPolicyDecisionPrompt,
  buildCounterOfferPrompt,
  buildClarificationPrompt,
  buildInitialEmailPrompt,
  buildInstructionClassificationPrompt,
} from "./prompts";

export {
  parsePolicyDecisionOutput,
  parseResponseGenerationOutput,
} from "./output-parser";

// Types
export type {
  ExtractedQuoteData,
  ExtractionResult,
  LLMExtractionOutput,
  AgentAction,
  ComplianceStatus,
  OrderContext,
  PolicyEvaluationResult,
  CounterOffer,
  ProposedApproval,
  GeneratedResponse,
  AgentProcessRequest,
  AgentProcessResponse,
  NegotiationStyle,
  ClassifiedInstructions,
} from "./types";
export {
  LLMPolicyDecisionOutputSchema,
  LLMResponseGenerationOutputSchema,
} from "./types";

// Expert types
export type {
  ExpertOpinion,
  ExtractionAnalysis,
  EscalationAnalysis,
  NeedsAnalysis,
  OrchestratorDecision,
  OrchestratorTrace,
  OrchestratorIteration,
  CounterTerms,
  ExtractionExpertInput,
  EscalationExpertInput,
  NeedsExpertInput,
  ResponseCrafterInput,
  OrchestratorInput,
} from "./experts/types";
