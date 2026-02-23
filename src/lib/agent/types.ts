import { z } from "zod/v4";

// ─── OrderInformation — structured merchant order input ─────────────────────

export type RelationshipTier = "preferred" | "standard" | "new";
export type ShippingMethod = "sea" | "air" | "express";
export type CounterPriceStrategy = "split_difference" | "anchor_low" | "target_only";
export type NegotiationPriority = "price" | "lead_time" | "payment_terms" | "quantity";
export type OrderType = "routine_reorder" | "initial_order" | "urgent_restock";
export type UrgencyLevel = "standard" | "urgent";

export interface OrderInformation {
  merchant: {
    merchantId: string;
    merchantName: string;
    contactName: string;
    contactEmail: string;
  };
  supplier: {
    supplierName: string;
    supplierContactName?: string;
    supplierContactEmail?: string;
    relationshipTier?: RelationshipTier;
  };
  product: {
    merchantSKU: string;
    supplierProductCode: string;
    productName: string;
    productDescription?: string;
    unitOfMeasure?: string;
    requiredCertifications?: string[];
    packagingRequirements?: string;
  };
  pricing: {
    currency: string;
    targetPrice: number;
    maximumAcceptablePrice: number;
    lastKnownPrice?: number;
    neverCounterAbove?: number;
  };
  quantity: {
    targetQuantity: number;
    minimumAcceptableQuantity?: number;
    maximumAcceptableQuantity?: number;
  };
  leadTime?: {
    maximumLeadTimeDays?: number;
    preferredLeadTimeDays?: number;
  };
  paymentTerms?: {
    requiredTerms?: string;
    acceptableAlternatives?: string[];
    maximumUpfrontPercent?: number;
  };
  shipping?: {
    requiredIncoterms?: string;
    originLocation?: string;
    destinationLocation?: string;
    preferredMethod?: ShippingMethod;
  };
  negotiation?: {
    neverAcceptFirstOffer?: boolean;
    maxNegotiationRounds?: number;
    counterPriceStrategy?: CounterPriceStrategy;
    priorityOrder?: NegotiationPriority[];
  };
  escalation?: {
    additionalTriggers?: string[];
  };
  metadata?: {
    poNumber?: string;
    orderType?: OrderType;
    urgency?: UrgencyLevel;
    orderNotes?: string;
  };
}

export const OrderInformationSchema = z.object({
  merchant: z.object({
    merchantId: z.string(),
    merchantName: z.string(),
    contactName: z.string(),
    contactEmail: z.string(),
  }),
  supplier: z.object({
    supplierName: z.string(),
    supplierContactName: z.string().optional(),
    supplierContactEmail: z.string().optional(),
    relationshipTier: z.enum(["preferred", "standard", "new"]).optional(),
  }),
  product: z.object({
    merchantSKU: z.string(),
    supplierProductCode: z.string(),
    productName: z.string(),
    productDescription: z.string().optional(),
    unitOfMeasure: z.string().optional(),
    requiredCertifications: z.array(z.string()).optional(),
    packagingRequirements: z.string().optional(),
  }),
  pricing: z.object({
    currency: z.string(),
    targetPrice: z.number(),
    maximumAcceptablePrice: z.number(),
    lastKnownPrice: z.number().optional(),
    neverCounterAbove: z.number().optional(),
  }),
  quantity: z.object({
    targetQuantity: z.number(),
    minimumAcceptableQuantity: z.number().optional(),
    maximumAcceptableQuantity: z.number().optional(),
  }),
  leadTime: z.object({
    maximumLeadTimeDays: z.number().optional(),
    preferredLeadTimeDays: z.number().optional(),
  }).optional(),
  paymentTerms: z.object({
    requiredTerms: z.string().optional(),
    acceptableAlternatives: z.array(z.string()).optional(),
    maximumUpfrontPercent: z.number().optional(),
  }).optional(),
  shipping: z.object({
    requiredIncoterms: z.string().optional(),
    originLocation: z.string().optional(),
    destinationLocation: z.string().optional(),
    preferredMethod: z.enum(["sea", "air", "express"]).optional(),
  }).optional(),
  negotiation: z.object({
    neverAcceptFirstOffer: z.boolean().optional(),
    maxNegotiationRounds: z.number().optional(),
    counterPriceStrategy: z.enum(["split_difference", "anchor_low", "target_only"]).optional(),
    priorityOrder: z.array(z.enum(["price", "lead_time", "payment_terms", "quantity"])).optional(),
  }).optional(),
  escalation: z.object({
    additionalTriggers: z.array(z.string()).optional(),
  }).optional(),
  metadata: z.object({
    poNumber: z.string().optional(),
    orderType: z.enum(["routine_reorder", "initial_order", "urgent_restock"]).optional(),
    urgency: z.enum(["standard", "urgent"]).optional(),
    orderNotes: z.string().optional(),
  }).optional(),
});

// ─── Currency normalization ───────────────────────────────────────────────────
// Maps common aliases to ISO 4217 codes
const CURRENCY_ALIASES: Record<string, string> = {
  RMB: "CNY",
  YUAN: "CNY",
  "¥": "CNY",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
};

export function normalizeCurrency(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return CURRENCY_ALIASES[upper] ?? upper;
}

// ─── Zod schema for LLM extraction output ─────────────────────────────────────
// This is what we ask the LLM to return. It may include extra fields like
// confidence and notes that live in ExtractionResult, not ExtractedQuoteData.
export const LLMExtractionOutputSchema = z.object({
  quotedPrice: z.union([z.number(), z.null()]).optional().default(null),
  quotedPriceCurrency: z.union([z.string(), z.null()]).optional().default("USD"),
  availableQuantity: z.union([z.number().int(), z.null()]).optional().default(null),
  moq: z.union([z.number().int(), z.null()]).optional().default(null),
  leadTimeMinDays: z.union([z.number().int(), z.null()]).optional().default(null),
  leadTimeMaxDays: z.union([z.number().int(), z.null()]).optional().default(null),
  paymentTerms: z.union([z.string(), z.null()]).optional().default(null),
  validityPeriod: z.union([z.string(), z.null()]).optional().default(null),
  confidence: z.number().optional().default(0.5),
  notes: z.array(z.string()).optional().default([]),
});

export type LLMExtractionOutput = z.infer<typeof LLMExtractionOutputSchema>;

// ─── JSON Schemas for Claude structured output (tool_use) ─────────────────────
// These mirror the Zod schemas above but in JSON Schema format for the API.

export const EXTRACTION_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    quotedPrice: { type: ["number", "null"], description: "Per-unit price quoted by supplier. null if not mentioned." },
    quotedPriceCurrency: { type: ["string", "null"], description: "ISO 4217 currency code (e.g. USD, CNY). Default USD. null if no price given." },
    availableQuantity: { type: ["integer", "null"], description: "Quantity the supplier quoted for (not MOQ). null if not mentioned — never use 0 to mean 'not mentioned'." },
    moq: { type: ["integer", "null"], description: "Minimum order quantity if mentioned. null if not mentioned — never use 0 to mean 'not mentioned'." },
    leadTimeMinDays: { type: ["integer", "null"], description: "Minimum lead time in days. null if not mentioned — never use 0 to mean 'not mentioned'. 0 is only valid if supplier explicitly says same-day." },
    leadTimeMaxDays: { type: ["integer", "null"], description: "Maximum lead time in days. Same as min if single value given. null if not mentioned — never use 0 to mean 'not mentioned'." },
    paymentTerms: { type: ["string", "null"], description: "Payment terms as stated. null if not mentioned." },
    validityPeriod: { type: ["string", "null"], description: "Quote validity period if mentioned. null if not mentioned." },
    confidence: { type: "number", description: "0.0-1.0 confidence in extraction. 0.9+ = all fields clear, 0.0-0.2 = no data found." },
    notes: { type: "array", items: { type: "string" }, description: "Observations that don't fit structured fields" },
  },
  required: ["quotedPrice", "quotedPriceCurrency", "confidence", "notes"],
};

export const POLICY_DECISION_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    rulesMatched: { type: "array", items: { type: "string" }, description: "Rules relevant to this quote" },
    complianceStatus: { type: "string", enum: ["compliant", "non_compliant", "partial"], description: "How well the quote matches rules" },
    recommendedAction: { type: "string", enum: ["accept", "counter", "escalate", "clarify"], description: "Next action to take" },
    reasoning: { type: "string", description: "Detailed explanation of evaluation" },
    escalationTriggered: { type: "boolean", description: "True if any escalation trigger fired" },
    escalationReason: { type: ["string", "null"], description: "Which trigger fired and why" },
    counterTerms: {
      type: ["object", "null"],
      properties: {
        targetPrice: { type: "number" },
        targetQuantity: { type: "number" },
        otherTerms: { type: ["string", "null"] },
      },
      description: "Counter-offer terms if recommending counter",
    },
  },
  required: ["rulesMatched", "complianceStatus", "recommendedAction", "reasoning", "escalationTriggered"],
};

export const RESPONSE_GENERATION_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    emailText: { type: "string", description: "Email body text (no subject, greeting, or signature)" },
    proposedTermsSummary: { type: "string", description: "One-line summary of what is being proposed or asked" },
    subjectLine: { type: "string", description: "Short professional subject line for the email" },
  },
  required: ["emailText"],
};


// ─── ExtractedQuoteData — mirrors PRODUCT_SPEC Section 3.11 ───────────────────
// Field names match the spec exactly. DB-only fields (id, messageId, orderId,
// createdAt) are omitted — they're added when persistence comes in B3.
export interface ExtractedQuoteData {
  quotedPrice: number | null;
  quotedPriceCurrency: string;
  quotedPriceUsd: number | null;
  availableQuantity: number | null;
  moq: number | null;
  leadTimeMinDays: number | null;
  leadTimeMaxDays: number | null;
  paymentTerms: string | null;
  validityPeriod: string | null;
  rawExtractionJson: Record<string, unknown>;
}

// ─── ExtractionResult — wrapper with metadata ─────────────────────────────────
export interface ExtractionResult {
  success: boolean;
  data: ExtractedQuoteData | null;
  confidence: number;
  notes: string[];
  error: string | null;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  retryCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1.5: Policy Evaluation, Decision, Response Generation
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Enums ────────────────────────────────────────────────────────────────────
export type AgentAction = "accept" | "counter" | "escalate" | "clarify";
export type ComplianceStatus = "compliant" | "non_compliant" | "partial";


// ─── Zod schema for combined policy evaluation + decision LLM output ──────────
export const LLMPolicyDecisionOutputSchema = z.object({
  rulesMatched: z.array(z.string()).default([]),
  complianceStatus: z.enum(["compliant", "non_compliant", "partial"]),
  recommendedAction: z.enum(["accept", "counter", "escalate", "clarify"]),
  reasoning: z.string(),
  escalationTriggered: z.boolean().default(false),
  escalationReason: z.union([z.string(), z.null()]).optional().default(null),
  counterTerms: z
    .union([
      z.object({
        targetPrice: z.number().optional(),
        targetQuantity: z.number().optional(),
        otherTerms: z.union([z.string(), z.null()]).optional().default(null),
      }),
      z.null(),
    ])
    .optional(),
});

export type LLMPolicyDecisionOutput = z.infer<typeof LLMPolicyDecisionOutputSchema>;

// ─── Policy evaluation result ─────────────────────────────────────────────────
export interface PolicyEvaluationResult {
  rulesMatched: string[];
  complianceStatus: ComplianceStatus;
  recommendedAction: AgentAction;
  reasoning: string;
  escalationTriggered: boolean;
  escalationReason?: string;
  counterTerms?: {
    targetPrice?: number;
    targetQuantity?: number;
    otherTerms?: string;
  };
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

// ─── Zod schema for response generation LLM output ────────────────────────────
export const LLMResponseGenerationOutputSchema = z.object({
  emailText: z.string(),
  proposedTermsSummary: z.string().optional().default(""),
});

export type LLMResponseGenerationOutput = z.infer<typeof LLMResponseGenerationOutputSchema>;

// ─── Response generation types ────────────────────────────────────────────────
export interface CounterOffer {
  draftEmail: string;
  proposedTerms: string;
}

export interface ProposedApproval {
  quantity: number;
  price: number;
  total: number;
  summary: string;
}

export interface GeneratedResponse {
  counterOffer?: CounterOffer;
  proposedApproval?: ProposedApproval;
  escalationReason?: string;
  clarificationEmail?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

// ─── Top-level pipeline types ─────────────────────────────────────────────────
export interface AgentProcessRequest {
  supplierMessage: string;
  orderInformation: OrderInformation;
  conversationHistory?: string;   // Formatted conversation thread for LLM context
  priorExtractedData?: Partial<ExtractedQuoteData>; // Merged data from prior turns
  turnNumber?: number;            // For neverAcceptFirstOffer logic
}

export interface AgentProcessResponse {
  action: AgentAction;
  reasoning: string;
  extractedData: ExtractedQuoteData | null;
  extraction: ExtractionResult;
  counterOffer?: CounterOffer;
  proposedApproval?: ProposedApproval;
  escalationReason?: string;
  clarificationEmail?: string;
  policyEvaluation: {
    rulesMatched: string[];
    complianceStatus: ComplianceStatus;
    details: string;
    provider?: string;
    model?: string;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  responseGeneration?: {
    provider: string;
    model: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
  // New fields for multi-agent orchestration observability
  expertOpinions?: import("./experts/types").ExpertOpinion[];
  orchestratorTrace?: import("./experts/types").OrchestratorTrace;
  totalLLMCalls?: number;
  totalLatencyMs?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}
