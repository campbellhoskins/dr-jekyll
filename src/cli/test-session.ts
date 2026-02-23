/**
 * Automated test session runner.
 * Runs a scripted conversation (agent + supplier turns) and prints
 * the full pipeline trace for each turn.
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
import type { AgentProcessRequest, AgentProcessResponse, OrderInformation } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";
import { printInputContext, printEvaluation, printDecision, printResponse, printTotals } from "./display";

config({ path: path.resolve(process.cwd(), ".env.local") });

interface SessionFile {
  name: string;
  description: string;
  orderInformation: OrderInformation;
  supplierTurns: string[];
  expectations?: {
    turn: number;
    action?: string;
  }[];
}

function buildLLMService(): LLMService {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY not set"); process.exit(1); }
  const model = process.env.LLM_CLI_MODEL ?? "claude-3-haiku-20240307";
  const provider: LLMProvider = new ClaudeProvider(apiKey, model);
  return new LLMService({ primaryProvider: provider, maxRetriesPerProvider: 3, retryDelayMs: 1000 });
}

function printTurn(turn: number, result: AgentProcessResponse, request: AgentProcessRequest, verbose: boolean): void {
  console.log(`\n${"---".repeat(20)}`);
  console.log(`TURN ${turn}`);
  console.log(`${"---".repeat(20)}`);

  console.log(`\n  -- INPUT CONTEXT --`);
  printInputContext(request, "  ");

  console.log(`\n  -- SYSTEMATIC EVALUATION --`);
  printEvaluation(result, "  ");

  console.log(`\n  -- DECISION --`);
  printDecision(result, "  ");

  console.log(`\n  -- RESPONSE --`);
  printResponse(result, "  ");

  if (verbose) {
    console.log(`\n  -- Totals --`);
    printTotals(result, "  ");
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

  const oi = session.orderInformation;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`SESSION: ${session.name}`);
  console.log(`${session.description}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nOrder: ${oi.product.productName} (${oi.product.supplierProductCode})`);
  console.log(`Qty: ${oi.quantity.targetQuantity}`);
  console.log(`Pricing: target $${oi.pricing.targetPrice}, max $${oi.pricing.maximumAcceptablePrice}`);
  if (oi.escalation?.additionalTriggers?.length) {
    console.log(`Triggers: ${oi.escalation.additionalTriggers.join("; ")}`);
  }

  const service = buildLLMService();
  const pipeline = new AgentPipeline(service);
  const context = new ConversationContext();

  // Cache rules across turns
  let cachedOrderContext: string | undefined;
  let cachedMerchantRules: string | undefined;

  // Generate initial email
  console.log(`\nGenerating initial email...`);
  try {
    const initial = await pipeline.generateInitialEmail(oi);
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
      orderInformation: oi,
      conversationHistory: context.formatForPrompt(),
      cachedOrderContext,
      cachedMerchantRules,
    };

    const result = await pipeline.process(request);

    // Cache rules for subsequent turns
    if (!cachedOrderContext) cachedOrderContext = result.orderContext;
    if (!cachedMerchantRules) cachedMerchantRules = result.merchantRules;

    // Add agent response to conversation
    if (result.action !== "escalate") {
      context.addAgentMessage(result.responseText);
    }

    printTurn(i + 1, result, request, verbose);

    // Check expectations
    const check = checkExpectation(i + 1, result, session.expectations);
    if (check) {
      const icon = check.pass ? "[PASS]" : "[FAIL]";
      console.log(`\n  ${icon} Expectation: ${check.message}`);
      if (!check.pass) allPassed = false;
    }
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Total messages in context: ${context.getMessageCount()}`);
  if (session.expectations) {
    console.log(`\nExpectations: ${allPassed ? "ALL PASSED" : "SOME FAILED"}`);
  }
  console.log(`${"=".repeat(60)}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
