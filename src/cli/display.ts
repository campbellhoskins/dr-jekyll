/**
 * Shared display helpers for CLI tools.
 * Prints the agent's systematic evaluation, decision, and response.
 */

import type { AgentProcessRequest, AgentProcessResponse } from "../lib/agent/types";

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

// ─── Agent Evaluation ───────────────────────────────────────────────────────

export function printEvaluation(result: AgentProcessResponse, indent = "  "): void {
  if (result.reasoning) {
    console.log(`${indent}--- Systematic Evaluation ---`);
    result.reasoning.split("\n").forEach((line) => {
      console.log(`${indent}  ${line}`);
    });
  }
}

// ─── Decision ────────────────────────────────────────────────────────────────

export function printDecision(result: AgentProcessResponse, indent = "  "): void {
  if (result.decision) {
    console.log(`${indent}--- Decision ---`);
    result.decision.split("\n").forEach((line) => {
      console.log(`${indent}  ${line}`);
    });
  }
}

// ─── Response ────────────────────────────────────────────────────────────────

export function printResponse(result: AgentProcessResponse, indent = "  "): void {
  if (result.responseText) {
    console.log(`${indent}--- Response ---`);
    result.responseText.split("\n").forEach((line) => {
      console.log(`${indent}  ${line}`);
    });
  }
}

// ─── Cost Calculation ────────────────────────────────────────────────────────

// Per-million-token pricing: [inputCostPerMillion, outputCostPerMillion]
const MODEL_PRICING: Record<string, [number, number]> = {
  "claude-3-haiku-20240307":    [0.25,  1.25],
  "claude-3-5-haiku-20241022":  [0.80,  4.00],
  "claude-haiku-4-5-20251001":  [1.00,  5.00],
  "claude-3-5-sonnet-20241022": [3.00, 15.00],
  "claude-sonnet-4-20250514":   [3.00, 15.00],
  "claude-opus-4-20250514":     [5.00, 25.00],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  const [inputRate, outputRate] = pricing;
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

// ─── Totals ──────────────────────────────────────────────────────────────────

export function printTotals(result: AgentProcessResponse, indent = "  "): void {
  console.log(`${indent}Provider:    ${result.provider} (${result.model})`);
  console.log(`${indent}Tokens:      ${result.inputTokens} in / ${result.outputTokens} out (${result.inputTokens + result.outputTokens} total)`);
  console.log(`${indent}Latency:     ${result.latencyMs}ms`);

  const cost = estimateCost(result.model, result.inputTokens, result.outputTokens);
  if (cost !== null) {
    console.log(`${indent}Est. Cost:   ${formatCost(cost)}`);
  }
}
