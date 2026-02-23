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

// ─── Simplified agent types ─────────────────────────────────────────────────

export type AgentAction = "accept" | "counter" | "escalate";

export interface AgentProcessRequest {
  supplierMessage: string;
  orderInformation: OrderInformation;
  conversationHistory?: string;
  cachedOrderContext?: string;
  cachedMerchantRules?: string;
}

export interface AgentProcessResponse {
  action: AgentAction;
  reasoning: string;
  decision: string;
  responseText: string;
  orderContext: string;
  merchantRules: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RulesGenerationResult {
  orderContext: string;
  merchantRules: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}
