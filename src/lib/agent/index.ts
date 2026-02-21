// B1: Extraction
export { Extractor } from "./extractor";
export { buildExtractionPrompt } from "./prompts";
export { parseExtractionOutput, extractJson } from "./output-parser";
export { normalizeCurrency, LLMExtractionOutputSchema } from "./types";

// B1.5: Policy, Decision, Response, Pipeline
export { AgentPipeline, type InitialEmailResult } from "./pipeline";
export { PolicyEvaluator } from "./policy-evaluator";
export { ResponseGenerator } from "./response-generator";
export { checkPrePolicyEscalation, makeDecision } from "./decision-engine";
export { ConversationContext, type ConversationMessage } from "./conversation-context";
export { InstructionClassifier } from "./instruction-classifier";
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
