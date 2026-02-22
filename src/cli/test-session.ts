/**
 * Automated test session runner.
 * Runs a scripted conversation (agent + supplier turns) and prints
 * the full pipeline trace for each turn. Used for debugging and
 * iterating on prompt quality without manual interaction.
 *
 * Usage:
 *   npx tsx src/cli/test-session.ts --session tests/sessions/example.json
 *   npx tsx src/cli/test-session.ts --session tests/sessions/example.json --verbose
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { AgentPipeline } from "../lib/agent/pipeline";
import { ConversationContext } from "../lib/agent/conversation-context";
import type { AgentProcessRequest, AgentProcessResponse, OrderContext } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";

config({ path: path.resolve(process.cwd(), ".env.local") });

interface SessionFile {
  name: string;
  description: string;
  orderContext: OrderContext;
  negotiationRules: string;
  escalationTriggers: string;
  supplierTurns: string[];
  expectations?: {
    turn: number;
    action?: string;
    priceExtracted?: number;
    quantityExtracted?: number;
  }[];
}

function buildLLMService(): LLMService {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY not set"); process.exit(1); }
  const model = process.env.LLM_PRIMARY_MODEL ?? "claude-3-haiku-20240307";
  const provider: LLMProvider = new ClaudeProvider(apiKey, model);
  return new LLMService({ primaryProvider: provider, maxRetriesPerProvider: 3, retryDelayMs: 1000 });
}

function printTurn(turn: number, supplierMsg: string, result: AgentProcessResponse, verbose: boolean): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`TURN ${turn}`);
  console.log(`${"─".repeat(60)}`);
  console.log(`\nSupplier said: "${supplierMsg}"`);

  // Extraction
  console.log(`\n  Extraction:`);
  if (result.extractedData) {
    const d = result.extractedData;
    console.log(`    Price:       ${d.quotedPrice !== null ? `$${d.quotedPrice} ${d.quotedPriceCurrency}` : "—"}`);
    console.log(`    Qty:         ${d.availableQuantity ?? "—"}`);
    console.log(`    MOQ:         ${d.moq ?? "—"}`);
    console.log(`    Lead Time:   ${d.leadTimeMinDays !== null ? (d.leadTimeMaxDays && d.leadTimeMaxDays !== d.leadTimeMinDays ? `${d.leadTimeMinDays}-${d.leadTimeMaxDays} days` : `${d.leadTimeMinDays} days`) : "—"}`);
    console.log(`    Payment:     ${d.paymentTerms ?? "—"}`);
  }
  console.log(`    Confidence:  ${result.extraction.confidence}`);
  if (result.extraction.notes.length > 0) {
    console.log(`    Notes:       ${JSON.stringify(result.extraction.notes)}`);
  }
  console.log(`    Tokens:      ${result.extraction.inputTokens} in / ${result.extraction.outputTokens} out`);

  // Policy
  console.log(`\n  Policy Evaluation:`);
  console.log(`    Compliance:  ${result.policyEvaluation.complianceStatus}`);
  console.log(`    Details:     ${result.policyEvaluation.details.substring(0, 200)}`);
  if (result.policyEvaluation.provider) {
    console.log(`    Tokens:      ${result.policyEvaluation.inputTokens} in / ${result.policyEvaluation.outputTokens} out`);
  }

  // Decision
  console.log(`\n  Decision: ${result.action.toUpperCase()}`);
  console.log(`    Reasoning:   ${result.reasoning.substring(0, 200)}`);

  // Response
  if (result.proposedApproval) {
    console.log(`\n  → ACCEPT: ${result.proposedApproval.quantity} units @ $${result.proposedApproval.price} = $${result.proposedApproval.total}`);
  }
  if (result.counterOffer) {
    console.log(`\n  → COUNTER EMAIL:`);
    console.log(`    ${result.counterOffer.draftEmail.split("\n").join("\n    ")}`);
    console.log(`    Terms: ${result.counterOffer.proposedTerms}`);
  }
  if (result.clarificationEmail) {
    console.log(`\n  → CLARIFICATION EMAIL:`);
    console.log(`    ${result.clarificationEmail.split("\n").join("\n    ")}`);
  }
  if (result.escalationReason) {
    console.log(`\n  → ESCALATED: ${result.escalationReason}`);
  }

  if (verbose && result.responseGeneration) {
    console.log(`\n  Response Gen Tokens: ${result.responseGeneration.inputTokens} in / ${result.responseGeneration.outputTokens} out`);
  }
}

function checkExpectation(
  turn: number,
  result: AgentProcessResponse,
  expectations?: SessionFile["expectations"]
): { pass: boolean; message: string } | null {
  if (!expectations) return null;
  const exp = expectations.find(e => e.turn === turn);
  if (!exp) return null;

  const failures: string[] = [];
  if (exp.action && result.action !== exp.action) {
    failures.push(`action: expected "${exp.action}", got "${result.action}"`);
  }
  if (exp.priceExtracted !== undefined && result.extractedData?.quotedPrice !== exp.priceExtracted) {
    failures.push(`price: expected ${exp.priceExtracted}, got ${result.extractedData?.quotedPrice}`);
  }
  if (exp.quantityExtracted !== undefined && result.extractedData?.availableQuantity !== exp.quantityExtracted) {
    failures.push(`quantity: expected ${exp.quantityExtracted}, got ${result.extractedData?.availableQuantity}`);
  }

  if (failures.length === 0) {
    return { pass: true, message: "All expectations met" };
  }
  return { pass: false, message: failures.join("; ") };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const sessionIndex = args.indexOf("--session");
  const sessionPath = sessionIndex !== -1 ? args[sessionIndex + 1] : null;

  if (!sessionPath) {
    console.error("Usage: npx tsx src/cli/test-session.ts --session <path.json> [--verbose]");
    process.exit(1);
  }

  const session: SessionFile = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), sessionPath), "utf8")
  );

  console.log(`\n${"═".repeat(60)}`);
  console.log(`SESSION: ${session.name}`);
  console.log(`${session.description}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`\nOrder: ${session.orderContext.skuName} (${session.orderContext.supplierSku})`);
  console.log(`Qty: ${session.orderContext.quantityRequested}`);
  console.log(`Rules: ${session.negotiationRules || "(none)"}`);
  console.log(`Triggers: ${session.escalationTriggers || "(none)"}`);
  if (session.orderContext.specialInstructions) {
    console.log(`Instructions: ${session.orderContext.specialInstructions}`);
  }

  const service = buildLLMService();
  const pipeline = new AgentPipeline(service);
  const context = new ConversationContext();

  // Generate initial email
  console.log(`\nGenerating initial email...`);
  try {
    const initial = await pipeline.generateInitialEmail(session.orderContext);
    context.addAgentMessage(initial.emailText);
    console.log(`\nAgent sent: "${initial.emailText.substring(0, 150)}..."`);
    console.log(`(${initial.inputTokens} in / ${initial.outputTokens} out, ${initial.latencyMs}ms)`);
  } catch (e) {
    console.error(`Initial email failed: ${e}`);
  }

  // Run each supplier turn
  let allPassed = true;
  for (let i = 0; i < session.supplierTurns.length; i++) {
    const supplierMsg = session.supplierTurns[i];
    context.addSupplierMessage(supplierMsg);

    const request: AgentProcessRequest = {
      supplierMessage: supplierMsg,
      negotiationRules: session.negotiationRules,
      escalationTriggers: session.escalationTriggers,
      orderContext: session.orderContext,
      conversationHistory: context.formatForPrompt(),
      priorExtractedData: context.getMergedData(),
    };

    const result = await pipeline.process(request);

    if (result.extractedData) {
      context.mergeExtraction(result.extractedData);
    }
    if (result.counterOffer) {
      context.addAgentMessage(result.counterOffer.draftEmail);
    } else if (result.clarificationEmail) {
      context.addAgentMessage(result.clarificationEmail);
    }

    printTurn(i + 1, supplierMsg, result, verbose);

    // Check expectations
    const check = checkExpectation(i + 1, result, session.expectations);
    if (check) {
      const icon = check.pass ? "✓" : "✗";
      console.log(`\n  ${icon} Expectation: ${check.message}`);
      if (!check.pass) allPassed = false;
    }
  }

  // Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log(`MERGED DATA AFTER ALL TURNS:`);
  console.log(context.formatMergedDataForPrompt());
  console.log(`\nTotal messages in context: ${context.getMessageCount()}`);
  if (session.expectations) {
    console.log(`\nExpectations: ${allPassed ? "ALL PASSED ✓" : "SOME FAILED ✗"}`);
  }
  console.log(`${"═".repeat(60)}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
