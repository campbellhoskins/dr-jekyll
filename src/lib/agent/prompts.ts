import type { LLMRequest } from "../llm/types";
import type { ExtractedQuoteData, OrderContext } from "./types";
import {
  EXTRACTION_JSON_SCHEMA,
  POLICY_DECISION_JSON_SCHEMA,
  RESPONSE_GENERATION_JSON_SCHEMA,
} from "./types";

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

const INITIAL_EMAIL_RESPONSE_SCHEMA = `{
  "emailText": "string",
  "subjectLine": "string"
}`;

export function buildInitialEmailPrompt(orderContext: OrderContext): LLMRequest {
  const style = orderContext.negotiationStyle ?? "ask_for_quote";
  const approach = style === "state_price_upfront"
    ? `State your target price of $${orderContext.lastKnownPrice} per unit upfront and ask if they can match it.`
    : `Ask the supplier for their best price and terms. Do NOT mention any target price.`;

  const lines = [
    `## Negotiation Approach`,
    approach,
    ``,
    `## Order Details`,
    `Product: ${orderContext.skuName} (${orderContext.supplierSku})`,
    `Quantity: ${orderContext.quantityRequested}`,
  ];
  if (orderContext.specialInstructions) {
    lines.push(`Special Requirements: ${orderContext.specialInstructions}`);
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

Given a supplier email, extract structured quote data as JSON. Return ONLY valid JSON with no additional text.

Required JSON fields:
- quotedPrice: number or null — the per-unit price quoted by the supplier
- quotedPriceCurrency: string — ISO 4217 currency code (e.g., "USD", "CNY", "EUR"). Default to "USD" if the currency is not explicitly stated but prices appear to be in dollars.
- availableQuantity: number or null — the quantity the supplier is quoting for (not MOQ)
- moq: number or null — minimum order quantity, if mentioned
- leadTimeMinDays: integer or null — minimum lead time in days. Convert weeks to days (1 week = 7 days). If a single value is given (e.g., "30 days"), set both min and max to that value.
- leadTimeMaxDays: integer or null — maximum lead time in days. If a range is given (e.g., "25-30 days"), set leadTimeMinDays to 25 and leadTimeMaxDays to 30.
- paymentTerms: string or null — payment terms as stated (e.g., "30% deposit, balance before shipping", "T/T", "NET 30")
- validityPeriod: string or null — how long the quote is valid, if mentioned (e.g., "valid for 30 days", "expires March 15")
- confidence: number between 0.0 and 1.0 — how confident you are in the extraction:
  - 0.9-1.0: All key fields clearly stated with no ambiguity
  - 0.6-0.8: Some fields present, some inferred or missing
  - 0.3-0.5: Partial information, significant uncertainty
  - 0.0-0.2: No pricing data found, email is conversational or unrelated
- notes: string array — important observations that don't fit the structured fields above. Examples:
  - "Supplier mentioned product discontinuation"
  - "Tiered pricing: 100-499 at $2.80, 500-999 at $2.40, 1000+ at $2.10"
  - "Multiple items quoted — only first extracted"
  - "Supplier is asking for specifications before quoting"
  - "FOB Shenzhen shipping terms"

Rules:
- If the supplier did not provide a price, set quotedPrice to null and confidence low.
- If the supplier quoted multiple items, extract the first item and note the rest in notes.
- If tiered pricing is given, extract the first tier as quotedPrice and capture all tiers in notes.
- Do not invent or hallucinate data. If a field is not mentioned, set it to null.
- Currency: "RMB" = "CNY". If only "$" is used with no further context, assume "USD".`;

export function buildExtractionPrompt(emailText: string): LLMRequest {
  return {
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userMessage: `Extract structured quote data from the following supplier email:\n\n---\n${emailText}\n---`,
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
- Do not invent rules. Only evaluate against the rules and triggers provided.`;

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

function formatOrderContext(ctx: OrderContext): string {
  const lines = [
    `SKU: ${ctx.skuName} (${ctx.supplierSku})`,
    `Quantity Requested: ${ctx.quantityRequested}`,
    `Last Known Price: $${ctx.lastKnownPrice}`,
  ];
  if (ctx.specialInstructions) {
    lines.push(`Special Instructions: ${ctx.specialInstructions}`);
  }
  return lines.join("\n");
}

export function buildPolicyDecisionPrompt(
  extractedData: ExtractedQuoteData,
  negotiationRules: string,
  escalationTriggers: string,
  orderContext: OrderContext
): LLMRequest {
  const userMessage = `## Extracted Quote Data
${formatExtractedData(extractedData)}

## Merchant's Negotiation Rules
${negotiationRules}

## Merchant's Escalation Triggers
${escalationTriggers}

## Order Context
${formatOrderContext(orderContext)}`;

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
  orderContext: OrderContext
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
${formatOrderContext(orderContext)}`;

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
  orderContext: OrderContext
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
${formatOrderContext(orderContext)}`;

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
