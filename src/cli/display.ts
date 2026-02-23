/**
 * Shared display helpers for CLI tools.
 * Prints the full reasoning trace: input context, expert opinions,
 * orchestrator decisions, and response details.
 */

import type { AgentProcessRequest, AgentProcessResponse } from "../lib/agent/types";
import type {
  ExpertOpinion,
  ExtractionAnalysis,
  EscalationAnalysis,
  NeedsAnalysis,
  OrchestratorTrace,
} from "../lib/agent/experts/types";

// ─── Input Context ───────────────────────────────────────────────────────────

export function printInputContext(request: AgentProcessRequest, indent = "  "): void {
  console.log(`${indent}--- Supplier Message ---`);
  request.supplierMessage.split("\n").forEach((line) => {
    console.log(`${indent}  ${line}`);
  });

  const oi = request.orderInformation;
  console.log();
  console.log(`${indent}--- Order Information ---`);
  console.log(`${indent}  Product:     ${oi.product.productName} (${oi.product.supplierProductCode})`);
  console.log(`${indent}  Quantity:    ${oi.quantity.targetQuantity}`);
  console.log(`${indent}  Pricing:     target $${oi.pricing.targetPrice}, max $${oi.pricing.maximumAcceptablePrice}`);
  if (oi.pricing.lastKnownPrice != null) {
    console.log(`${indent}  Last Price:  $${oi.pricing.lastKnownPrice}`);
  }
  if (oi.leadTime?.maximumLeadTimeDays != null) {
    console.log(`${indent}  Lead Time:   max ${oi.leadTime.maximumLeadTimeDays} days`);
  }
  if (oi.paymentTerms?.requiredTerms) {
    console.log(`${indent}  Payment:     ${oi.paymentTerms.requiredTerms}`);
  }
  if (oi.escalation?.additionalTriggers?.length) {
    console.log(`${indent}  Triggers:    ${oi.escalation.additionalTriggers.join("; ")}`);
  }
  if (oi.metadata?.orderNotes) {
    console.log(`${indent}  Notes:       ${oi.metadata.orderNotes}`);
  }

  if (request.conversationHistory) {
    console.log();
    console.log(`${indent}--- Conversation History ---`);
    request.conversationHistory.split("\n").forEach((line) => {
      console.log(`${indent}  ${line}`);
    });
  }
}

// ─── Expert Opinions ─────────────────────────────────────────────────────────

export function printExpertOpinionWithContext(
  opinion: ExpertOpinion,
  request: AgentProcessRequest,
  indent = "  "
): void {
  const oi = request.orderInformation;

  // Show what this expert received (tailored input)
  console.log(`${indent}[INPUT to ${opinion.expertName}]`);
  if (opinion.expertName === "extraction") {
    console.log(`${indent}  Sees: supplier message, conversation history, prior extracted data`);
    console.log(`${indent}  Does NOT see: merchant rules, triggers, pricing targets`);
  } else if (opinion.expertName === "escalation") {
    console.log(`${indent}  Sees: supplier message, escalation triggers, product name`);
    console.log(`${indent}  Triggers: ${oi.escalation?.additionalTriggers?.join("; ") ?? "(derived from structured fields)"}`);
    console.log(`${indent}  Does NOT see: negotiation rules, target prices`);
  } else if (opinion.expertName === "needs") {
    console.log(`${indent}  Sees: extracted data, negotiation rules, product/quantity`);
    console.log(`${indent}  Pricing: target $${oi.pricing.targetPrice}, max $${oi.pricing.maximumAcceptablePrice}`);
    console.log(`${indent}  Does NOT see: escalation triggers`);
  }

  console.log();
  console.log(`${indent}[OUTPUT from ${opinion.expertName}]`);
  console.log(`${indent}  Provider:    ${opinion.provider} (${opinion.model})`);
  console.log(`${indent}  Latency:     ${opinion.latencyMs}ms`);
  console.log(`${indent}  Tokens:      ${opinion.inputTokens} in / ${opinion.outputTokens} out`);
  printAnalysis(opinion, indent);
}

export function printExpertOpinion(opinion: ExpertOpinion, indent = "  "): void {
  console.log(`${indent}Provider:    ${opinion.provider} (${opinion.model})`);
  console.log(`${indent}Latency:     ${opinion.latencyMs}ms`);
  console.log(`${indent}Tokens:      ${opinion.inputTokens} in / ${opinion.outputTokens} out`);
  printAnalysis(opinion, indent);
}

function printAnalysis(opinion: ExpertOpinion, indent: string): void {
  if (opinion.analysis.type === "extraction") {
    const a = opinion.analysis as ExtractionAnalysis;
    console.log(`${indent}  Success:     ${a.success}`);
    console.log(`${indent}  Confidence:  ${a.confidence}`);
    if (a.extractedData) {
      const d = a.extractedData;
      console.log(`${indent}  Price:       ${d.quotedPrice !== null ? `${d.quotedPrice} ${d.quotedPriceCurrency} ($${d.quotedPriceUsd} USD)` : "---"}`);
      console.log(`${indent}  Qty:         ${d.availableQuantity ?? "---"}`);
      console.log(`${indent}  MOQ:         ${d.moq ?? "---"}`);
      console.log(`${indent}  Lead Time:   ${d.leadTimeMinDays !== null ? (d.leadTimeMaxDays !== null && d.leadTimeMaxDays !== d.leadTimeMinDays ? `${d.leadTimeMinDays}-${d.leadTimeMaxDays} days` : `${d.leadTimeMinDays} days`) : "---"}`);
      console.log(`${indent}  Payment:     ${d.paymentTerms ?? "---"}`);
      console.log(`${indent}  Validity:    ${d.validityPeriod ?? "---"}`);
    }
    if (a.notes.length > 0) console.log(`${indent}  Notes:       ${JSON.stringify(a.notes)}`);
    if (a.error) console.log(`${indent}  Error:       ${a.error}`);
  } else if (opinion.analysis.type === "escalation") {
    const a = opinion.analysis as EscalationAnalysis;
    console.log(`${indent}  Escalate:    ${a.shouldEscalate}`);
    console.log(`${indent}  Severity:    ${a.severity}`);
    console.log(`${indent}  Triggers evaluated: ${JSON.stringify(a.triggersEvaluated)}`);
    if (a.triggeredTriggers.length > 0) {
      console.log(`${indent}  Triggered:   ${JSON.stringify(a.triggeredTriggers)}`);
    }
    console.log(`${indent}  Reasoning:   ${a.reasoning}`);
  } else if (opinion.analysis.type === "needs") {
    const a = opinion.analysis as NeedsAnalysis;
    console.log(`${indent}  Missing:     ${a.missingFields.length > 0 ? a.missingFields.join(", ") : "(none)"}`);
    if (a.prioritizedQuestions.length > 0) {
      console.log(`${indent}  Questions:`);
      a.prioritizedQuestions.forEach((q, i) => {
        console.log(`${indent}    ${i + 1}. ${q}`);
      });
    }
    console.log(`${indent}  Reasoning:   ${a.reasoning}`);
  } else {
    console.log(`${indent}  Analysis:    ${JSON.stringify(opinion.analysis, null, 2)}`);
  }
}

// ─── Orchestrator Trace ──────────────────────────────────────────────────────

export function printOrchestratorTrace(
  trace: OrchestratorTrace,
  request: AgentProcessRequest,
  indent = "  "
): void {
  const oi = request.orderInformation;
  console.log(`${indent}Total iterations: ${trace.totalIterations}`);
  console.log();
  console.log(`${indent}[INPUT to orchestrator]`);
  console.log(`${indent}  Sees: ALL expert opinions + full order information`);
  console.log(`${indent}  The orchestrator is the ONLY agent with the full picture.`);
  console.log(`${indent}  Pricing: target $${oi.pricing.targetPrice}, max $${oi.pricing.maximumAcceptablePrice}`);
  if (oi.escalation?.additionalTriggers?.length) {
    console.log(`${indent}  Custom Triggers: ${oi.escalation.additionalTriggers.join("; ")}`);
  }
  console.log();

  for (let i = 0; i < trace.iterations.length; i++) {
    const iter = trace.iterations[i];
    const d = iter.decision;
    const isLast = i === trace.iterations.length - 1 && d.readyToAct;

    console.log(`${indent}--- Iteration ${i + 1} ${isLast ? "(FINAL)" : ""} ---`);
    console.log(`${indent}  Ready to act: ${d.readyToAct}`);
    console.log(`${indent}  Action:       ${d.action ?? "(undecided)"}`);
    console.log(`${indent}  Reasoning:    ${d.reasoning}`);

    if (d.counterTerms) {
      const ct = d.counterTerms;
      const parts: string[] = [];
      if (ct.targetPrice) parts.push(`price: $${ct.targetPrice}`);
      if (ct.targetQuantity) parts.push(`qty: ${ct.targetQuantity}`);
      if (ct.otherTerms) parts.push(ct.otherTerms);
      console.log(`${indent}  Counter:      ${parts.join(", ")}`);
    }

    if (!d.readyToAct && d.nextExpert) {
      console.log(`${indent}  Next expert:  ${d.nextExpert}`);
      console.log(`${indent}  Question:     "${d.questionForExpert}"`);

      if (iter.followUpOpinion) {
        console.log();
        console.log(`${indent}  >> ${iter.reConsultedExpert!.toUpperCase()} EXPERT FOLLOW-UP:`);
        printExpertOpinion(iter.followUpOpinion, `${indent}     `);
      }
    }

    if (i < trace.iterations.length - 1) console.log();
  }
}

// ─── Response & Totals ───────────────────────────────────────────────────────

export function printResponse(result: AgentProcessResponse, indent = "  "): void {
  if (result.responseGeneration) {
    console.log(`${indent}Provider:    ${result.responseGeneration.provider} (${result.responseGeneration.model})`);
    console.log(`${indent}Latency:     ${result.responseGeneration.latencyMs}ms`);
    console.log(`${indent}Tokens:      ${result.responseGeneration.inputTokens} in / ${result.responseGeneration.outputTokens} out`);
  } else {
    console.log(`${indent}LLM Call:    none (deterministic)`);
  }

  if (result.proposedApproval) {
    console.log();
    console.log(`${indent}+-- APPROVAL PROPOSAL --------------------+`);
    console.log(`${indent}|  Quantity: ${result.proposedApproval.quantity}`);
    console.log(`${indent}|  Price:    $${result.proposedApproval.price}`);
    console.log(`${indent}|  Total:    $${result.proposedApproval.total}`);
    console.log(`${indent}|  Summary:  ${result.proposedApproval.summary.substring(0, 80)}`);
    console.log(`${indent}+-------------------------------------------+`);
  }
  if (result.counterOffer) {
    console.log();
    console.log(`${indent}+-- COUNTER-OFFER EMAIL ---------------------+`);
    result.counterOffer.draftEmail.split("\n").forEach((line) => {
      console.log(`${indent}|  ${line}`);
    });
    console.log(`${indent}|`);
    console.log(`${indent}|  Terms: ${result.counterOffer.proposedTerms}`);
    console.log(`${indent}+----------------------------------------------+`);
  }
  if (result.clarificationEmail) {
    console.log();
    console.log(`${indent}+-- CLARIFICATION EMAIL ----------------------+`);
    result.clarificationEmail.split("\n").forEach((line) => {
      console.log(`${indent}|  ${line}`);
    });
    console.log(`${indent}+----------------------------------------------+`);
  }
  if (result.escalationReason) {
    console.log();
    console.log(`${indent}+-- ESCALATION --------------------------------+`);
    console.log(`${indent}|  ${result.escalationReason}`);
    console.log(`${indent}+----------------------------------------------+`);
  }
}

export function printTotals(result: AgentProcessResponse, indent = "  "): void {
  console.log(`${indent}LLM Calls:   ${result.totalLLMCalls ?? "N/A"}`);
  console.log(`${indent}Tokens:      ${result.totalInputTokens ?? 0} in / ${result.totalOutputTokens ?? 0} out (${(result.totalInputTokens ?? 0) + (result.totalOutputTokens ?? 0)} total)`);
  console.log(`${indent}Latency:     ${result.totalLatencyMs ?? 0}ms`);
}
