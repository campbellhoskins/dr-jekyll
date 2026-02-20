import { z } from "zod/v4";

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
  retryCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1.5: Policy Evaluation, Decision, Response Generation
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Enums ────────────────────────────────────────────────────────────────────
export type AgentAction = "accept" | "counter" | "escalate" | "clarify";
export type ComplianceStatus = "compliant" | "non_compliant" | "partial";

// ─── Order context (from AgentProcessRequest) ─────────────────────────────────
export interface OrderContext {
  skuName: string;
  supplierSku: string;
  quantityRequested: string;
  lastKnownPrice: number;
  specialInstructions?: string;
}

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
}

// ─── Top-level pipeline types ─────────────────────────────────────────────────
export interface AgentProcessRequest {
  supplierMessage: string;
  negotiationRules: string;
  escalationTriggers: string;
  orderContext: OrderContext;
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
  };
}
