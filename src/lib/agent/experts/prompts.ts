import type { LLMRequest } from "../../llm/types";
import type { ExtractedQuoteData, OrderInformation } from "../types";
import { RESPONSE_GENERATION_JSON_SCHEMA } from "../types";
import type { CounterTerms, NeedsAnalysis } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// JSON Schemas for expert structured output (tool_use)
// ═══════════════════════════════════════════════════════════════════════════════

export const ESCALATION_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    shouldEscalate: { type: "boolean", description: "True if any escalation trigger condition is met" },
    reasoning: { type: "string", description: "Detailed explanation of the evaluation" },
    triggersEvaluated: { type: "array", items: { type: "string" }, description: "List of trigger conditions that were evaluated" },
    triggeredTriggers: { type: "array", items: { type: "string" }, description: "List of trigger conditions that actually fired" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Severity of the escalation if triggered" },
  },
  required: ["shouldEscalate", "reasoning", "triggersEvaluated", "triggeredTriggers", "severity"],
};

export const NEEDS_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    missingFields: { type: "array", items: { type: "string" }, description: "Fields that are missing or unclear" },
    prioritizedQuestions: { type: "array", items: { type: "string" }, description: "Questions to ask the supplier, ordered by importance" },
    reasoning: { type: "string", description: "Why these questions matter for evaluating the quote" },
  },
  required: ["missingFields", "prioritizedQuestions", "reasoning"],
};

export const ORCHESTRATOR_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    readyToAct: { type: "boolean", description: "True if enough information to make a final decision" },
    action: { type: ["string", "null"], enum: ["accept", "counter", "escalate", "clarify", null], description: "The decided action, or null if not ready" },
    reasoning: { type: "string", description: "Detailed explanation of the decision" },
    nextExpert: { type: ["string", "null"], description: "Which expert to re-consult if not ready (extraction, escalation, needs)" },
    questionForExpert: { type: ["string", "null"], description: "Specific follow-up question for the expert" },
    counterTerms: {
      type: ["object", "null"],
      properties: {
        targetPrice: { type: "number" },
        targetQuantity: { type: "number" },
        otherTerms: { type: ["string", "null"] },
      },
      description: "Counter-offer terms if action is counter",
    },
  },
  required: ["readyToAct", "reasoning"],
};

// ═══════════════════════════════════════════════════════════════════════════════
// OrderInformation → Prompt Serialization Helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function formatOrderInformation(oi: OrderInformation): string {
  const sections: string[] = [];

  // Product
  const productLines = [`- Name: ${oi.product.productName} (${oi.product.supplierProductCode})`];
  productLines.push(`- Merchant SKU: ${oi.product.merchantSKU}`);
  if (oi.product.unitOfMeasure) productLines.push(`- Unit of Measure: ${oi.product.unitOfMeasure}`);
  if (oi.product.requiredCertifications?.length) productLines.push(`- Required Certifications: ${oi.product.requiredCertifications.join(", ")}`);
  if (oi.product.packagingRequirements) productLines.push(`- Packaging: ${oi.product.packagingRequirements}`);
  if (oi.product.productDescription) productLines.push(`- Description: ${oi.product.productDescription}`);
  sections.push(`### Product\n${productLines.join("\n")}`);

  // Quantity
  const qtyLines = [`- Target: ${oi.quantity.targetQuantity} units`];
  if (oi.quantity.minimumAcceptableQuantity != null) qtyLines.push(`- Minimum Acceptable: ${oi.quantity.minimumAcceptableQuantity} units`);
  if (oi.quantity.maximumAcceptableQuantity != null) qtyLines.push(`- Maximum Acceptable: ${oi.quantity.maximumAcceptableQuantity} units`);
  sections.push(`### Quantity\n${qtyLines.join("\n")}`);

  // Pricing Rules
  const priceLines = [`- Currency: ${oi.pricing.currency}`];
  priceLines.push(`- Target Price: $${oi.pricing.targetPrice}/unit (ideal — happy at this or below)`);
  priceLines.push(`- Maximum Acceptable Price: $${oi.pricing.maximumAcceptablePrice}/unit (hard ceiling — escalate if exceeded)`);
  if (oi.pricing.lastKnownPrice != null) priceLines.push(`- Last Known Price: $${oi.pricing.lastKnownPrice}/unit (reference only)`);
  if (oi.pricing.neverCounterAbove != null) priceLines.push(`- Never Counter Above: $${oi.pricing.neverCounterAbove}/unit`);
  sections.push(`### Pricing Rules\n${priceLines.join("\n")}`);

  // Lead Time Rules
  if (oi.leadTime) {
    const ltLines: string[] = [];
    if (oi.leadTime.maximumLeadTimeDays != null) ltLines.push(`- Maximum Acceptable: ${oi.leadTime.maximumLeadTimeDays} days`);
    if (oi.leadTime.preferredLeadTimeDays != null) ltLines.push(`- Preferred: ${oi.leadTime.preferredLeadTimeDays} days`);
    if (ltLines.length > 0) sections.push(`### Lead Time Rules\n${ltLines.join("\n")}`);
  }

  // Payment Terms
  if (oi.paymentTerms) {
    const ptLines: string[] = [];
    if (oi.paymentTerms.requiredTerms) ptLines.push(`- Required: ${oi.paymentTerms.requiredTerms}`);
    if (oi.paymentTerms.acceptableAlternatives?.length) ptLines.push(`- Acceptable Alternatives: ${oi.paymentTerms.acceptableAlternatives.join(", ")}`);
    if (oi.paymentTerms.maximumUpfrontPercent != null) ptLines.push(`- Maximum Upfront: ${oi.paymentTerms.maximumUpfrontPercent}%`);
    if (ptLines.length > 0) sections.push(`### Payment Terms\n${ptLines.join("\n")}`);
  }

  // Shipping
  if (oi.shipping) {
    const shipLines: string[] = [];
    if (oi.shipping.requiredIncoterms) shipLines.push(`- Required Incoterms: ${oi.shipping.requiredIncoterms}`);
    if (oi.shipping.originLocation || oi.shipping.destinationLocation) {
      shipLines.push(`- Origin: ${oi.shipping.originLocation ?? "N/A"} → Destination: ${oi.shipping.destinationLocation ?? "N/A"}`);
    }
    if (oi.shipping.preferredMethod) shipLines.push(`- Preferred Method: ${oi.shipping.preferredMethod}`);
    if (shipLines.length > 0) sections.push(`### Shipping\n${shipLines.join("\n")}`);
  }

  // Negotiation Behavior
  if (oi.negotiation) {
    const negLines: string[] = [];
    if (oi.negotiation.neverAcceptFirstOffer != null) negLines.push(`- Never Accept First Offer: ${oi.negotiation.neverAcceptFirstOffer}`);
    if (oi.negotiation.maxNegotiationRounds != null) negLines.push(`- Max Negotiation Rounds: ${oi.negotiation.maxNegotiationRounds}`);
    if (oi.negotiation.counterPriceStrategy) negLines.push(`- Counter Strategy: ${oi.negotiation.counterPriceStrategy}`);
    if (oi.negotiation.priorityOrder?.length) negLines.push(`- Priority Order: ${oi.negotiation.priorityOrder.join(" > ")}`);
    if (negLines.length > 0) sections.push(`### Negotiation Behavior\n${negLines.join("\n")}`);
  }

  // Escalation Triggers (derived from structured fields + custom)
  sections.push(`### Escalation Triggers\n${formatEscalationTriggers(oi)}`);

  // Merchant
  const merchantLines = [`- Company: ${oi.merchant.merchantName}`];
  merchantLines.push(`- Contact: ${oi.merchant.contactName} (${oi.merchant.contactEmail})`);
  if (oi.metadata?.poNumber) merchantLines.push(`- PO Number: ${oi.metadata.poNumber}`);
  if (oi.metadata?.orderType) merchantLines.push(`- Order Type: ${oi.metadata.orderType} (${oi.metadata.urgency ?? "standard"} urgency)`);
  if (oi.metadata?.orderNotes) merchantLines.push(`- Notes: ${oi.metadata.orderNotes}`);
  sections.push(`### Merchant\n${merchantLines.join("\n")}`);

  return `## Order Information\n\n${sections.join("\n\n")}`;
}

export function formatEscalationTriggers(oi: OrderInformation): string {
  const triggers: string[] = [];

  triggers.push(`- Price exceeds $${oi.pricing.maximumAcceptablePrice}/unit`);

  if (oi.leadTime?.maximumLeadTimeDays != null) {
    triggers.push(`- Lead time exceeds ${oi.leadTime.maximumLeadTimeDays} days`);
  }

  if (oi.paymentTerms?.maximumUpfrontPercent != null) {
    triggers.push(`- Upfront payment exceeds ${oi.paymentTerms.maximumUpfrontPercent}%`);
  }

  if (oi.quantity.minimumAcceptableQuantity != null) {
    triggers.push(`- Supplier MOQ exceeds ${oi.quantity.maximumAcceptableQuantity ?? oi.quantity.targetQuantity} units`);
  }

  if (oi.escalation?.additionalTriggers?.length) {
    for (const t of oi.escalation.additionalTriggers) {
      triggers.push(`- ${t}`);
    }
  }

  return triggers.join("\n");
}

export function formatNegotiationRules(oi: OrderInformation): string {
  const rules: string[] = [];

  // Pricing
  rules.push(`Target price $${oi.pricing.targetPrice}/unit. Accept at or below $${oi.pricing.maximumAcceptablePrice}/unit.`);
  if (oi.pricing.neverCounterAbove != null) {
    rules.push(`Never counter above $${oi.pricing.neverCounterAbove}/unit.`);
  }

  // Lead time
  if (oi.leadTime?.maximumLeadTimeDays != null) {
    let lt = `Maximum lead time ${oi.leadTime.maximumLeadTimeDays} days.`;
    if (oi.leadTime.preferredLeadTimeDays != null) {
      lt += ` Prefer ${oi.leadTime.preferredLeadTimeDays} days.`;
    }
    rules.push(lt);
  }

  // Payment
  if (oi.paymentTerms?.requiredTerms) {
    let pt = `Required payment terms: ${oi.paymentTerms.requiredTerms}.`;
    if (oi.paymentTerms.acceptableAlternatives?.length) {
      pt += ` Accept alternatives: ${oi.paymentTerms.acceptableAlternatives.join(", ")}.`;
    }
    rules.push(pt);
  }

  // Quantity
  const qtyParts: string[] = [`Target ${oi.quantity.targetQuantity} units.`];
  if (oi.quantity.minimumAcceptableQuantity != null || oi.quantity.maximumAcceptableQuantity != null) {
    const min = oi.quantity.minimumAcceptableQuantity ?? 0;
    const max = oi.quantity.maximumAcceptableQuantity ?? "∞";
    qtyParts.push(`Acceptable range: ${min}-${max}.`);
  }
  rules.push(qtyParts.join(" "));

  // Behavior
  if (oi.negotiation) {
    const behav: string[] = [];
    if (oi.negotiation.neverAcceptFirstOffer) behav.push("Never accept first offer.");
    if (oi.negotiation.maxNegotiationRounds != null) behav.push(`Max ${oi.negotiation.maxNegotiationRounds} negotiation rounds.`);
    if (oi.negotiation.counterPriceStrategy) behav.push(`Strategy: ${oi.negotiation.counterPriceStrategy}.`);
    if (behav.length > 0) rules.push(behav.join(" "));
  }

  return rules.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Escalation Expert Prompt
// ═══════════════════════════════════════════════════════════════════════════════

const ESCALATION_SYSTEM_PROMPT = `You are an escalation evaluation specialist for a purchase order negotiation system.

Your ONLY job is to determine whether any of the merchant's escalation trigger conditions have fired, based on the supplier's message and any extracted data.

For each trigger condition provided:
1. Parse the condition (e.g., "MOQ exceeds 1000", "price above $5", "product discontinued")
2. Compare it against the supplier message and extracted data
3. Determine if it has fired

Rules:
- Evaluate EVERY trigger condition listed. Do not skip any.
- A trigger fires when the condition is CLEARLY met based on the available data.
- If a trigger involves a numeric threshold (price, MOQ, lead time), compare the extracted value against the threshold.
- If a trigger involves a qualitative condition (discontinued, unavailable, unacceptable terms), look for clear evidence in the supplier's message.
- When in doubt about whether a trigger has fired, err on the side of NOT triggering — only fire when the condition is clearly met.
- Do NOT evaluate whether the quote is "good" or "bad" — that's not your job. Only check trigger conditions.
- If the supplier's message indicates the product is discontinued, out of stock, or unavailable, and there is a relevant trigger for this, it should fire.
- If no escalation triggers are provided, set shouldEscalate to false.

Severity levels:
- "low": minor concern, borderline trigger
- "medium": clear trigger fired, needs merchant attention
- "high": serious issue (product unavailable, price far above threshold)
- "critical": deal-breaker (product discontinued, supplier refusing to deal)`;

export function buildEscalationPrompt(
  supplierMessage: string,
  orderInformation: OrderInformation,
  extractedData?: ExtractedQuoteData,
  conversationHistory?: string,
  additionalQuestion?: string
): LLMRequest {
  let userMessage = "";

  if (conversationHistory) {
    userMessage += `## Conversation History\n${conversationHistory}\n\n`;
  }

  userMessage += `## Supplier's Latest Message\n---\n${supplierMessage}\n---\n\n`;

  if (extractedData) {
    userMessage += `## Extracted Data\n${formatExtractedData(extractedData)}\n\n`;
  }

  userMessage += `## Product\n${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})\n\n`;

  userMessage += `## Escalation Triggers to Evaluate\n${formatEscalationTriggers(orderInformation)}`;

  if (additionalQuestion) {
    userMessage += `\n\n## Additional Question from Orchestrator\n${additionalQuestion}`;
  }

  return {
    systemPrompt: ESCALATION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1024,
    temperature: 0,
    outputSchema: {
      name: "evaluate_escalation",
      description: "Evaluate supplier message against escalation triggers",
      schema: ESCALATION_JSON_SCHEMA,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Needs Expert Prompt
// ═══════════════════════════════════════════════════════════════════════════════

const NEEDS_SYSTEM_PROMPT = `You are an information gap analyst for a purchase order negotiation system.

Your job is to identify what information is missing from the supplier's quote and determine the most important questions to ask.

Given extracted data and the merchant's negotiation rules, determine:
1. Which fields are missing that are needed to evaluate the quote against the rules
2. What specific questions to ask the supplier, in priority order
3. Why these questions matter

Rules:
- Only flag fields as missing if they are genuinely needed to evaluate the quote.
- If the negotiation rules mention a specific field (price, MOQ, lead time, payment terms), and that field is missing, it's high priority.
- If the rules don't mention a field, it may still be useful but is lower priority.
- Prioritize questions that would unlock the ability to make a decision (accept/counter/escalate).
- Frame questions professionally — they will be used to draft an email to the supplier.
- Do NOT ask about fields that are already known from the extracted data.
- If there are no missing fields and enough data to evaluate, return empty arrays.`;

export function buildNeedsPrompt(
  extractedData: ExtractedQuoteData | null,
  orderInformation: OrderInformation,
  conversationHistory?: string,
  additionalQuestion?: string
): LLMRequest {
  let userMessage = "";

  if (conversationHistory) {
    userMessage += `## Conversation History\n${conversationHistory}\n\n`;
  }

  userMessage += `## Extracted Data\n${extractedData ? formatExtractedData(extractedData) : "No data extracted (extraction failed or no pricing found)"}\n\n`;
  userMessage += `## Merchant's Negotiation Rules\n${formatNegotiationRules(orderInformation)}\n\n`;
  userMessage += `## Order Context\nProduct: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})\nQuantity: ${orderInformation.quantity.targetQuantity}`;

  if (additionalQuestion) {
    userMessage += `\n\n## Additional Question from Orchestrator\n${additionalQuestion}`;
  }

  return {
    systemPrompt: NEEDS_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1024,
    temperature: 0,
    outputSchema: {
      name: "analyze_needs",
      description: "Analyze information gaps in the supplier's quote",
      schema: NEEDS_JSON_SCHEMA,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Orchestrator Prompt
// ═══════════════════════════════════════════════════════════════════════════════

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the decision-making orchestrator for a purchase order negotiation system. You act on behalf of a MERCHANT who is BUYING goods from a supplier.

You receive expert opinions from specialized analysts and must decide the next action. You have the FULL picture — all expert opinions, the merchant's rules, triggers, and order context.

## CRITICAL: You Represent the Buyer

The merchant is the BUYER. The goal is always to get the BEST deal for the merchant:
- **Lower prices are ALWAYS better.** A price below the target is a win, not a problem.
- **NEVER counter to increase a price.** If the supplier offers $11.50 and the target is $12.00, that is a GOOD deal — accept it. Do NOT counter with $12.00.
- **NEVER negotiate for worse terms.** If the supplier offers better terms than the merchant's rules require, that is favorable — accept it.
- **Only counter to IMPROVE terms for the merchant** — lower prices, shorter lead times, better payment terms, lower MOQs.

When evaluating rules like "target price $12, acceptable up to $13":
- $11.50 from the supplier = BELOW target = ACCEPT (great deal)
- $12.50 from the supplier = above target but within acceptable = ACCEPT
- $14.00 from the supplier = above acceptable range = COUNTER down
- "Target" means "we'd be happy at this price or lower" — it is NOT a minimum.

## Your Decision Process

1. Review the extraction expert's analysis: what data was extracted, confidence level, any issues
2. Review the escalation expert's analysis: did any triggers fire?
3. If a needs expert opinion is present, review what information gaps were identified
4. Synthesize all opinions with the merchant's rules to decide the action

## Actions

- **accept**: EVERY rule the merchant specified is satisfied — no exceptions. No escalation triggers fired. Sufficient data is available. You MUST have price data to accept. If the price is at or below the merchant's target/acceptable range, that rule is satisfied — do not counter for a higher price.
- **counter**: One or more merchant rules are violated. The quote is negotiable — counter to push for BETTER terms (lower price, shorter lead time, etc.). Never counter to worsen the merchant's position.
- **escalate**: An escalation trigger has fired, OR the situation is too complex/risky for automated handling. Include the reason.
- **clarify**: Insufficient data to evaluate — need more information from the supplier. Only if extraction confidence is moderate and key fields are missing.

## CRITICAL: Rules Are Not Suggestions

The merchant's rules are hard requirements. If a rule says "lead time must be under 35 days" and the supplier quotes 40 days, that rule is VIOLATED — you MUST counter, even if everything else looks great. You do not get to decide that a rule violation is "minor" or a "reasonable trade-off." The merchant set the rules; you enforce them.

- "must be under X" = hard limit, counter if exceeded
- "acceptable up to X" = hard limit, counter if exceeded
- "prefer X" = soft preference, acceptable if close
- Only words like "prefer", "ideally", "if possible" indicate flexibility. Words like "must", "required", "under", "maximum" are absolute.

## Priority Rules

1. **Escalation triggers take priority.** If the escalation expert says a trigger fired, escalate — do not override with accept or counter.
2. **Extraction failure → escalate.** If extraction failed entirely (success=false), escalate.
3. **Very low confidence → consider escalate or clarify.** If confidence < 0.3, the data is unreliable.
4. **ALL rules satisfied → accept.** Only accept if EVERY merchant rule is met. One violated rule = do not accept.
5. **Any rule violated → counter.** If even one rule is broken (price too high, lead time too long, MOQ too high), counter to fix it — even if the other terms are excellent.
6. **Clarify when data gaps prevent evaluation.** If you can't tell whether rules are satisfied because data is missing.

## Re-consultation

If you need more information from an expert, set readyToAct=false and specify:
- nextExpert: "extraction", "escalation", or "needs"
- questionForExpert: your specific follow-up question

Use re-consultation sparingly. Common reasons:
- Ask "needs" expert to prioritize what to ask the supplier (when you see extraction gaps)
- Ask "escalation" expert to re-evaluate with additional context
- Ask "extraction" expert about an ambiguous field

## Conversation Context

If conversation history is provided, use it to understand the negotiation stage:
- A rule like "never accept the first price" applies to the supplier's FIRST offer, not every price
- If the supplier is responding to our counter with a revised price, evaluate it normally against acceptance rules
- The lastKnownPrice is informational context ONLY — not a rule

## Counter Terms

When countering, provide specific counterTerms to IMPROVE the deal for the merchant:
- targetPrice: a LOWER price to propose (never higher than what the supplier offered)
- targetQuantity: the quantity to propose (if relevant)
- otherTerms: any other terms to negotiate (free text)

Do NOT reveal the merchant's acceptable range — only propose a specific target.`;

export function buildOrchestratorPrompt(
  supplierMessage: string,
  orderInformation: OrderInformation,
  expertOpinions: Array<{ expertName: string; analysis: unknown }>,
  conversationHistory?: string,
  priorDecisions?: Array<{ reasoning: string; nextExpert?: string | null; questionForExpert?: string | null }>,
  turnNumber?: number
): LLMRequest {
  let userMessage = "";

  if (conversationHistory) {
    userMessage += `## Conversation History\n${conversationHistory}\n\n`;
  }

  userMessage += `## Supplier's Latest Message\n---\n${supplierMessage}\n---\n\n`;

  userMessage += formatOrderInformation(orderInformation);
  userMessage += `\n\n`;

  userMessage += `## Merchant's Negotiation Rules\n${formatNegotiationRules(orderInformation)}\n\n`;

  if (turnNumber != null) {
    userMessage += `## Turn Number: ${turnNumber}\n`;
    if (orderInformation.negotiation?.neverAcceptFirstOffer && turnNumber <= 1) {
      userMessage += `NOTE: The merchant requires never accepting the first offer. This is turn ${turnNumber}.\n`;
    }
    userMessage += `\n`;
  }

  userMessage += `## Expert Opinions\n\n`;
  for (const opinion of expertOpinions) {
    userMessage += `### ${opinion.expertName} Expert\n\`\`\`json\n${JSON.stringify(opinion.analysis, null, 2)}\n\`\`\`\n\n`;
  }

  if (priorDecisions && priorDecisions.length > 0) {
    userMessage += `## Prior Orchestrator Decisions (this loop)\n`;
    for (let i = 0; i < priorDecisions.length; i++) {
      const pd = priorDecisions[i];
      userMessage += `Iteration ${i + 1}: ${pd.reasoning}`;
      if (pd.nextExpert) userMessage += ` → Re-consulted ${pd.nextExpert}: "${pd.questionForExpert}"`;
      userMessage += `\n`;
    }
    userMessage += `\n`;
  }

  return {
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1024,
    temperature: 0,
    outputSchema: {
      name: "orchestrate_decision",
      description: "Synthesize expert opinions and decide the next action",
      schema: ORCHESTRATOR_JSON_SCHEMA,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response Crafter Prompts (counter-offer + clarification)
// These re-use the existing JSON schema for response generation.
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

export function buildCounterOfferCrafterPrompt(
  extractedData: ExtractedQuoteData,
  reasoning: string,
  counterTerms: CounterTerms,
  orderInformation: OrderInformation,
  conversationHistory?: string
): LLMRequest {
  const termsLines: string[] = [];
  if (counterTerms.targetPrice) termsLines.push(`Target price: $${counterTerms.targetPrice} per unit`);
  if (counterTerms.targetQuantity) termsLines.push(`Quantity: ${counterTerms.targetQuantity} units`);
  if (counterTerms.otherTerms) termsLines.push(`Other: ${counterTerms.otherTerms}`);

  let userMessage = "";

  if (conversationHistory) {
    userMessage += `## Conversation History\n${conversationHistory}\n\n`;
  }

  userMessage += `## Supplier's Quote\n${formatExtractedData(extractedData)}\n\n`;
  userMessage += `## Why We're Countering\n${reasoning}\n\n`;
  userMessage += `## Counter Terms\n${termsLines.length > 0 ? termsLines.join("\n") : "Negotiate for better terms based on the reasoning above."}\n\n`;
  userMessage += `## Order Context\nProduct: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})\nQuantity: ${orderInformation.quantity.targetQuantity}\nLast Known Price: $${orderInformation.pricing.lastKnownPrice ?? "N/A"}`;

  if (orderInformation.product.packagingRequirements || orderInformation.metadata?.orderNotes) {
    const extras: string[] = [];
    if (orderInformation.product.packagingRequirements) extras.push(`Packaging: ${orderInformation.product.packagingRequirements}`);
    if (orderInformation.metadata?.orderNotes) extras.push(`Notes: ${orderInformation.metadata.orderNotes}`);
    userMessage += `\n${extras.join("\n")}`;
  }

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

export function buildClarificationCrafterPrompt(
  extractedData: ExtractedQuoteData | null,
  reasoning: string,
  orderInformation: OrderInformation,
  needsAnalysis?: NeedsAnalysis,
  conversationHistory?: string
): LLMRequest {
  let userMessage = "";

  if (conversationHistory) {
    userMessage += `## Conversation History\n${conversationHistory}\n\n`;
  }

  userMessage += `## What We Know So Far\n${extractedData ? formatExtractedData(extractedData) : "No data extracted yet."}\n\n`;

  if (needsAnalysis) {
    userMessage += `## Missing Information\n`;
    userMessage += `Fields needed: ${needsAnalysis.missingFields.join(", ")}\n\n`;
    userMessage += `## Questions to Ask (in priority order)\n`;
    needsAnalysis.prioritizedQuestions.forEach((q, i) => {
      userMessage += `${i + 1}. ${q}\n`;
    });
    userMessage += `\n`;
  } else {
    userMessage += `## Why We Need Clarification\n${reasoning}\n\n`;
  }

  userMessage += `## Order Context\nProduct: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})\nQuantity: ${orderInformation.quantity.targetQuantity}\nLast Known Price: $${orderInformation.pricing.lastKnownPrice ?? "N/A"}`;

  if (orderInformation.product.packagingRequirements || orderInformation.metadata?.orderNotes) {
    const extras: string[] = [];
    if (orderInformation.product.packagingRequirements) extras.push(`Packaging: ${orderInformation.product.packagingRequirements}`);
    if (orderInformation.metadata?.orderNotes) extras.push(`Notes: ${orderInformation.metadata.orderNotes}`);
    userMessage += `\n${extras.join("\n")}`;
  }

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

// ═══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

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
