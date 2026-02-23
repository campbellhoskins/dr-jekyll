// Pipeline
export { AgentPipeline, type InitialEmailResult } from "./pipeline";
export { ConversationContext, type ConversationMessage } from "./conversation-context";

// XML Parser
export { extractXmlTag, parseDecision } from "./xml-parser";

// Prompts
export {
  buildInitialEmailPrompt,
  buildRulesGenerationPrompt,
  buildAgentPrompt,
} from "./prompts";

// Types
export type {
  AgentAction,
  OrderInformation,
  AgentProcessRequest,
  AgentProcessResponse,
  RulesGenerationResult,
  RelationshipTier,
  ShippingMethod,
  CounterPriceStrategy,
  NegotiationPriority,
  OrderType,
  UrgencyLevel,
} from "./types";
export { OrderInformationSchema, normalizeCurrency } from "./types";
