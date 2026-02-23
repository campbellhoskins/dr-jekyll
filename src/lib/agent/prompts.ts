import type { LLMRequest } from "../llm/types";
import type { ExtractedQuoteData, OrderInformation } from "./types";
import {
  EXTRACTION_JSON_SCHEMA,
  POLICY_DECISION_JSON_SCHEMA,
  RESPONSE_GENERATION_JSON_SCHEMA,
} from "./types";
import { formatNegotiationRules, formatEscalationTriggers } from "./experts/prompts";

// ═══════════════════════════════════════════════════════════════════════════════
// Initial Outbound Email Generation
// ═══════════════════════════════════════════════════════════════════════════════

const INITIAL_EMAIL_SYSTEM_PROMPT = `You are drafting a professional initial email on behalf of a merchant to a supplier to start a purchase order conversation.

Write a concise, professional email that:
- Introduces the request clearly
- Follows the specified negotiation approach (ask for quote OR state price upfront)
- Includes all relevant order details (product, quantity, any special requirements)
- Maintains a warm, professional tone
- Does NOT include a subject line, greeting, or signature (those are added separately)
- Does NOT reveal the merchant is using AI

CRITICAL CONFIDENTIALITY RULES — the email must NEVER reveal:
- The merchant's target price range or acceptable price limits (unless the approach is "state price upfront", in which case only the proposed price is shared — not the acceptable range)
- The merchant's negotiation strategy or internal policies
- Any internal reasoning

Return ONLY valid JSON with:
- emailText: string — the email body text only
- subjectLine: string — a short professional subject line`;

export function buildInitialEmailPrompt(orderInformation: OrderInformation): LLMRequest {
  const lines = [
    `## Negotiation Approach`,
    `Ask the supplier for their best price and terms. Do NOT mention any target price.`,
    ``,
    `## Order Details`,
    `Product: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})`,
    `Quantity: ${orderInformation.quantity.targetQuantity}`,
  ];

  if (orderInformation.product.packagingRequirements) {
    lines.push(`Packaging: ${orderInformation.product.packagingRequirements}`);
  }
  if (orderInformation.product.requiredCertifications?.length) {
    lines.push(`Required Certifications: ${orderInformation.product.requiredCertifications.join(", ")}`);
  }
  if (orderInformation.shipping?.requiredIncoterms) {
    lines.push(`Shipping: ${orderInformation.shipping.requiredIncoterms}`);
  }
  if (orderInformation.shipping?.destinationLocation) {
    lines.push(`Destination: ${orderInformation.shipping.destinationLocation}`);
  }
  if (orderInformation.metadata?.orderNotes) {
    lines.push(`Special Requirements: ${orderInformation.metadata.orderNotes}`);
  }

  return {
    systemPrompt: INITIAL_EMAIL_SYSTEM_PROMPT,
    userMessage: lines.join("\n"),
    maxTokens: 1024,
    temperature: 0,
    outputSchema: {
      name: "generate_initial_email",
      description: "Generate the initial outbound email to a supplier",
      schema: RESPONSE_GENERATION_JSON_SCHEMA,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1: Data Extraction Prompt
// ═══════════════════════════════════════════════════════════════════════════════

const EXTRACTION_SYSTEM_PROMPT = `You are a data extraction assistant specialized in parsing supplier emails for purchase order negotiations.

Given a supplier email, extract ONLY the information that is EXPLICITLY stated. You must NEVER infer, assume, or hallucinate values that the supplier did not clearly provide.

CRITICAL RULE: If the supplier did not explicitly mention a field, you MUST set it to null. Do not guess. Do not use default values. Do not fill in "reasonable" values. null means "not mentioned".

Field definitions:
- quotedPrice: number or null — the per-unit price the supplier explicitly stated. null if no price mentioned.
- quotedPriceCurrency: string or null — ISO 4217 currency code (e.g., "USD", "CNY"). Default "USD" only if a dollar sign or dollar amount is used. null if no price at all.
- availableQuantity: number or null — the specific quantity the supplier is quoting for, ONLY if the supplier explicitly stated a quantity. Do NOT copy the requested quantity as the available quantity. null if not explicitly stated by the supplier.
- moq: number or null — minimum order quantity ONLY if the supplier explicitly used words like "minimum", "MOQ", "min order", or "at least". A supplier saying "I can do 100 units" does NOT mean MOQ is 100 — it means they are quoting for 100 units. null if not explicitly stated as a minimum.
- leadTimeMinDays: integer or null — ONLY if the supplier explicitly mentioned lead time, delivery time, shipping time, or production time. null if not mentioned. Do NOT assume or invent a lead time.
- leadTimeMaxDays: integer or null — same rule. If a range like "25-30 days", set min=25, max=30. If single value like "30 days", set both to 30. null if not mentioned.
- paymentTerms: string or null — ONLY if the supplier explicitly stated payment terms. null if not mentioned.
- validityPeriod: string or null — ONLY if the supplier explicitly stated how long the quote is valid. null if not mentioned.
- confidence: number 0.0-1.0:
  - 0.9-1.0: All key fields clearly stated, no ambiguity
  - 0.6-0.8: Some fields present, some missing
  - 0.3-0.5: Partial information
  - 0.0-0.2: No pricing data found
- notes: string array — observations that don't fit above. Include shipping terms (FOB, CIF), tiered pricing details, multi-item notes, discontinuation warnings, etc.

Additional rules:
- If the supplier quoted multiple items, extract the first item and note the rest in notes.
- If tiered pricing is given, extract the first tier as quotedPrice and capture all tiers in notes.
- Currency: "RMB" = "CNY". If "$" is used, assume "USD".
- CARRY-FORWARD: If prior conversation and previously extracted data are provided, carry forward any fields that the latest email does not contradict. For example, if a prior message established quantity=500 and the latest email only confirms a new price, keep quantity=500. But do NOT carry forward if the field was hallucinated in the prior data — only carry forward values that were genuinely stated by the supplier.`;

export function buildExtractionPrompt(
  emailText: string,
  conversationHistory?: string,
  priorData?: string
): LLMRequest {
  let userMessage = "";

  if (conversationHistory) {
    userMessage += `## Prior Conversation\n${conversationHistory}\n\n`;
  }
  if (priorData) {
    userMessage += `## Previously Extracted Data (carry forward any fields not contradicted)\n${priorData}\n\n`;
  }

  userMessage += `## Latest Supplier Email (extract from this)\n---\n${emailText}\n---`;

  return {
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1024,
    temperature: 0,
    outputSchema: {
      name: "extract_quote",
      description: "Extract structured quote data from a supplier email",
      schema: EXTRACTION_JSON_SCHEMA,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1.5: Policy Evaluation + Decision Prompt
// ═══════════════════════════════════════════════════════════════════════════════

const POLICY_DECISION_SYSTEM_PROMPT = `You are a purchasing policy evaluator for a small business.

Given extracted supplier quote data, the merchant's negotiation rules, escalation triggers, and order context, evaluate the quote and decide the next action.

Return ONLY valid JSON with these fields:
- rulesMatched: string[] — list of rules that are relevant to this quote (quote the rule text)
- complianceStatus: "compliant" | "non_compliant" | "partial" — how well the quote matches the rules
  - "compliant": ALL rules are satisfied
  - "non_compliant": one or more critical rules are violated
  - "partial": some rules satisfied, some violated or unverifiable
- recommendedAction: "accept" | "counter" | "escalate" | "clarify"
  - "accept": ALL rules satisfied, no escalation triggers, quote is good
  - "counter": quote is negotiable but terms need improvement (price too high, lead time too long, etc.)
  - "escalate": an escalation trigger has fired, or the situation is too complex/ambiguous for the agent
  - "clarify": insufficient data to evaluate — need more information from supplier
- reasoning: string — detailed explanation of your evaluation and why you chose this action
- escalationTriggered: boolean — true if any escalation trigger fires
- escalationReason: string or null — if escalation triggered, which trigger and why
- counterTerms: object (optional, only if recommendedAction is "counter") — what to propose:
  - targetPrice: number (optional) — the price to counter with
  - targetQuantity: number (optional) — the quantity to propose
  - otherTerms: string (optional) — other terms to negotiate

CRITICAL Decision guidelines:
- CHECK ESCALATION TRIGGERS FIRST before evaluating rules. Compare EACH trigger against the extracted data. If ANY trigger condition is met, you MUST set escalationTriggered=true and recommendedAction="escalate". This is mandatory — do not override with accept or counter.
- Only recommend "accept" if ALL rules are satisfied AND zero escalation triggers fire.
- For "counter", identify which specific terms to negotiate and provide counterTerms.
- For "clarify", explain what information is missing.
- The lastKnownPrice is informational context ONLY — it is NOT a rule. Do not recommend counter just because the price is above lastKnownPrice. Only the negotiation rules determine compliance.
- Do not invent rules. Only evaluate against the rules and triggers provided.
- CONVERSATION CONTEXT: If conversation history is provided, use it to understand the negotiation stage. A rule like "never accept the first price" applies to the supplier's FIRST offer, not to every price they mention. If the supplier is responding to our counter-offer with a revised price, that is NOT a "first price" — it is a negotiated price. Evaluate it against the acceptance rules normally.`;

function formatExtractedData(data: ExtractedQuoteData): string {
  const lines = [
    `Quoted Price: ${data.quotedPrice !== null ? `${data.quotedPrice} ${data.quotedPriceCurrency}` : "not provided"}`,
    `Price (USD): ${data.quotedPriceUsd !== null ? `$${data.quotedPriceUsd}` : "not available"}`,
    `Available Quantity: ${data.availableQuantity ?? "not specified"}`,
    `MOQ: ${data.moq ?? "not specified"}`,
    `Lead Time: ${data.leadTimeMinDays !== null ? (data.leadTimeMaxDays !== null && data.leadTimeMaxDays !== data.leadTimeMinDays ? `${data.leadTimeMinDays}-${data.leadTimeMaxDays} days` : `${data.leadTimeMinDays} days`) : "not specified"}`,
    `Payment Terms: ${data.paymentTerms ?? "not specified"}`,
    `Validity Period: ${data.validityPeriod ?? "not specified"}`,
  ];
  return lines.join("\n");
}

export function buildPolicyDecisionPrompt(
  extractedData: ExtractedQuoteData,
  orderInformation: OrderInformation,
  conversationHistory?: string
): LLMRequest {
  let userMessage = "";

  if (conversationHistory) {
    userMessage += `## Conversation History (use this to understand negotiation stage)\n${conversationHistory}\n\n`;
  }

  userMessage += `## Extracted Quote Data (from supplier's latest message)
${formatExtractedData(extractedData)}

## Merchant's Negotiation Rules
${formatNegotiationRules(orderInformation)}

## Merchant's Escalation Triggers
${formatEscalationTriggers(orderInformation)}

## Order Context
Product: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})
Quantity: ${orderInformation.quantity.targetQuantity}
Last Known Price: $${orderInformation.pricing.lastKnownPrice ?? "N/A"}`;

  return {
    systemPrompt: POLICY_DECISION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1024,
    temperature: 0,
    outputSchema: {
      name: "evaluate_policy",
      description: "Evaluate supplier quote against negotiation rules and decide action",
      schema: POLICY_DECISION_JSON_SCHEMA,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1.5: Counter-Offer Generation Prompt
// ═══════════════════════════════════════════════════════════════════════════════

const COUNTER_OFFER_SYSTEM_PROMPT = `You are drafting a professional counter-offer email on behalf of a merchant to their supplier.

Write a concise, professional email that:
- Acknowledges the supplier's quote
- Proposes a specific counter-price or asks for a better deal
- Maintains a warm, professional tone
- Does NOT include a subject line, greeting, or signature (those are added separately)
- Does NOT reveal the merchant is using AI

CRITICAL CONFIDENTIALITY RULES — the email must NEVER reveal:
- The merchant's target price, acceptable price range, or pricing rules
- The merchant's negotiation strategy or internal policies
- The merchant's last known price or what they previously paid
- Any internal reasoning about why the price is being countered
Instead, use natural negotiation language like "We were hoping for something closer to $X" or "Given current market conditions, could you do $X?" — propose a specific number without explaining the internal logic behind it.

Return ONLY valid JSON with:
- emailText: string — the email body text only
- proposedTermsSummary: string — one-line summary of what is being proposed`;

export function buildCounterOfferPrompt(
  extractedData: ExtractedQuoteData,
  reasoning: string,
  counterTerms: { targetPrice?: number; targetQuantity?: number; otherTerms?: string },
  orderInformation: OrderInformation
): LLMRequest {
  const termsLines: string[] = [];
  if (counterTerms.targetPrice) termsLines.push(`Target price: $${counterTerms.targetPrice} per unit`);
  if (counterTerms.targetQuantity) termsLines.push(`Quantity: ${counterTerms.targetQuantity} units`);
  if (counterTerms.otherTerms) termsLines.push(`Other: ${counterTerms.otherTerms}`);

  const userMessage = `## Supplier's Quote
${formatExtractedData(extractedData)}

## Why We're Countering
${reasoning}

## Counter Terms
${termsLines.length > 0 ? termsLines.join("\n") : "Negotiate for better terms based on the reasoning above."}

## Order Context
Product: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})
Quantity: ${orderInformation.quantity.targetQuantity}
Last Known Price: $${orderInformation.pricing.lastKnownPrice ?? "N/A"}`;

  return {
    systemPrompt: COUNTER_OFFER_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 2048,
    temperature: 0,
    outputSchema: {
      name: "generate_counter_offer",
      description: "Generate a professional counter-offer email",
      schema: RESPONSE_GENERATION_JSON_SCHEMA,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1.5: Clarification Email Prompt
// ═══════════════════════════════════════════════════════════════════════════════

const CLARIFICATION_SYSTEM_PROMPT = `You are drafting a professional clarification email on behalf of a merchant to their supplier.

Write a concise, professional email that:
- Acknowledges what the supplier has provided so far
- Clearly asks for the specific missing information
- Maintains a warm, professional tone
- Does NOT include a subject line, greeting, or signature
- Does NOT reveal the merchant is using AI

Return ONLY valid JSON with:
- emailText: string — the email body text only
- proposedTermsSummary: string — one-line summary of what is being asked`;

export function buildClarificationPrompt(
  extractedData: ExtractedQuoteData,
  notes: string[],
  orderInformation: OrderInformation
): LLMRequest {
  const nullFields: string[] = [];
  if (extractedData.quotedPrice === null) nullFields.push("unit price");
  if (extractedData.moq === null) nullFields.push("minimum order quantity");
  if (extractedData.leadTimeMinDays === null) nullFields.push("lead time");
  if (extractedData.paymentTerms === null) nullFields.push("payment terms");

  const userMessage = `## What We Know So Far
${formatExtractedData(extractedData)}

## Missing Information
${nullFields.length > 0 ? `Missing fields: ${nullFields.join(", ")}` : "No specific fields missing, but details are unclear."}

## Extraction Notes
${notes.length > 0 ? notes.join("\n") : "No additional notes."}

## Order Context
Product: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})
Quantity: ${orderInformation.quantity.targetQuantity}
Last Known Price: $${orderInformation.pricing.lastKnownPrice ?? "N/A"}`;

  return {
    systemPrompt: CLARIFICATION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 2048,
    temperature: 0,
    outputSchema: {
      name: "generate_clarification",
      description: "Generate a professional clarification email",
      schema: RESPONSE_GENERATION_JSON_SCHEMA,
    },
  };
}
