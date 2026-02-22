/**
 * Shared display helpers for CLI tools.
 * Prints expert opinions, orchestrator trace, and response details.
 */

import type { AgentProcessResponse } from "../lib/agent/types";
import type {
  ExpertOpinion,
  ExtractionAnalysis,
  EscalationAnalysis,
  NeedsAnalysis,
  OrchestratorTrace,
} from "../lib/agent/experts/types";

export function printExpertOpinion(opinion: ExpertOpinion, indent = "  "): void {
  console.log(`${indent}Provider:    ${opinion.provider} (${opinion.model})`);
  console.log(`${indent}Latency:     ${opinion.latencyMs}ms`);
  console.log(`${indent}Tokens:      ${opinion.inputTokens} in / ${opinion.outputTokens} out`);

  if (opinion.analysis.type === "extraction") {
    const a = opinion.analysis as ExtractionAnalysis;
    console.log(`${indent}Success:     ${a.success}`);
    console.log(`${indent}Confidence:  ${a.confidence}`);
    if (a.extractedData) {
      const d = a.extractedData;
      console.log(`${indent}Price:       ${d.quotedPrice !== null ? `${d.quotedPrice} ${d.quotedPriceCurrency} ($${d.quotedPriceUsd} USD)` : "---"}`);
      console.log(`${indent}Qty:         ${d.availableQuantity ?? "---"}`);
      console.log(`${indent}MOQ:         ${d.moq ?? "---"}`);
      console.log(`${indent}Lead Time:   ${d.leadTimeMinDays !== null ? (d.leadTimeMaxDays !== null && d.leadTimeMaxDays !== d.leadTimeMinDays ? `${d.leadTimeMinDays}-${d.leadTimeMaxDays} days` : `${d.leadTimeMinDays} days`) : "---"}`);
      console.log(`${indent}Payment:     ${d.paymentTerms ?? "---"}`);
      console.log(`${indent}Validity:    ${d.validityPeriod ?? "---"}`);
    }
    if (a.notes.length > 0) console.log(`${indent}Notes:       ${JSON.stringify(a.notes)}`);
    if (a.error) console.log(`${indent}Error:       ${a.error}`);
  } else if (opinion.analysis.type === "escalation") {
    const a = opinion.analysis as EscalationAnalysis;
    console.log(`${indent}Escalate:    ${a.shouldEscalate}`);
    console.log(`${indent}Severity:    ${a.severity}`);
    console.log(`${indent}Triggers evaluated: ${JSON.stringify(a.triggersEvaluated)}`);
    if (a.triggeredTriggers.length > 0) {
      console.log(`${indent}Triggered:   ${JSON.stringify(a.triggeredTriggers)}`);
    }
    console.log(`${indent}Reasoning:   ${a.reasoning}`);
  } else if (opinion.analysis.type === "needs") {
    const a = opinion.analysis as NeedsAnalysis;
    console.log(`${indent}Missing:     ${a.missingFields.length > 0 ? a.missingFields.join(", ") : "(none)"}`);
    if (a.prioritizedQuestions.length > 0) {
      console.log(`${indent}Questions:`);
      a.prioritizedQuestions.forEach((q, i) => {
        console.log(`${indent}  ${i + 1}. ${q}`);
      });
    }
    console.log(`${indent}Reasoning:   ${a.reasoning}`);
  } else {
    console.log(`${indent}Analysis:    ${JSON.stringify(opinion.analysis, null, 2)}`);
  }
}

export function printOrchestratorTrace(trace: OrchestratorTrace, indent = "  "): void {
  console.log(`${indent}Total iterations: ${trace.totalIterations}`);
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
