import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { OpenAIProvider } from "../lib/llm/providers/openai";
import { AgentPipeline } from "../lib/agent/pipeline";
import type { AgentProcessRequest, AgentProcessResponse, OrderContext } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";

config({ path: path.resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const scenarioIndex = args.indexOf("--scenario");
const scenarioPath = scenarioIndex !== -1 ? args[scenarioIndex + 1] : null;

function buildLLMService(): LLMService {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const primaryModel = process.env.LLM_PRIMARY_MODEL ?? "claude-3-haiku-20240307";
  const fallbackModel = process.env.LLM_FALLBACK_MODEL ?? "gpt-4o";
  const maxRetries = parseInt(process.env.LLM_MAX_RETRIES ?? "3", 10);

  if (!anthropicKey) {
    console.error("Error: ANTHROPIC_API_KEY not set in .env.local");
    process.exit(1);
  }

  const primary: LLMProvider = new ClaudeProvider(anthropicKey, primaryModel);
  let fallback: LLMProvider | undefined;
  if (openaiKey) fallback = new OpenAIProvider(openaiKey, fallbackModel);

  return new LLMService({ primaryProvider: primary, fallbackProvider: fallback, maxRetriesPerProvider: maxRetries, retryDelayMs: 1000 });
}

interface SessionConfig {
  negotiationRules: string;
  escalationTriggers: string;
  orderContext: OrderContext;
}

function loadScenarioConfig(filePath: string): SessionConfig {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    negotiationRules: data.negotiationRules,
    escalationTriggers: data.escalationTriggers,
    orderContext: data.orderContext,
  };
}

function promptForConfig(rl: readline.Interface): Promise<SessionConfig> {
  return new Promise((resolve) => {
    const ask = (question: string): Promise<string> =>
      new Promise((res) => rl.question(question, res));

    (async () => {
      console.log("\n── Session Setup ──\n");

      const skuName = await ask("  SKU name: ");
      const supplierSku = await ask("  Supplier SKU: ");
      const qty = await ask("  Quantity requested: ");
      const lastPrice = await ask("  Last known price ($): ");
      const instructions = await ask("  Special instructions (or empty): ");

      console.log("");
      const styleInput = await ask("  Negotiation style (1=ask for quote, 2=state price upfront) [1]: ");
      const rules = await ask("  Negotiation rules (plain English):\n  > ");
      const triggers = await ask("  Escalation triggers (plain English):\n  > ");

      resolve({
        negotiationRules: rules,
        escalationTriggers: triggers,
        orderContext: {
          skuName,
          supplierSku,
          quantityRequested: qty,
          lastKnownPrice: parseFloat(lastPrice) || 0,
          negotiationStyle: styleInput === "2" ? "state_price_upfront" : "ask_for_quote",
          specialInstructions: instructions || undefined,
        },
      });
    })();
  });
}

function printResult(result: AgentProcessResponse, turn: number): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  TURN ${turn} — PIPELINE RESULT`);
  console.log(`${"═".repeat(60)}`);

  // Stage 1: Extraction
  console.log(`\n── Stage 1: Extraction ──`);
  console.log(`  Success:     ${result.extraction.success}`);
  console.log(`  Confidence:  ${result.extraction.confidence}`);
  console.log(`  Provider:    ${result.extraction.provider} (${result.extraction.model})`);
  console.log(`  Latency:     ${result.extraction.latencyMs}ms`);
  console.log(`  Tokens:      ${result.extraction.inputTokens} in / ${result.extraction.outputTokens} out`);
  if (result.extractedData) {
    const d = result.extractedData;
    console.log(`  Price:       ${d.quotedPrice !== null ? `${d.quotedPrice} ${d.quotedPriceCurrency} ($${d.quotedPriceUsd} USD)` : "—"}`);
    console.log(`  Qty:         ${d.availableQuantity ?? "—"}`);
    console.log(`  MOQ:         ${d.moq ?? "—"}`);
    console.log(`  Lead Time:   ${d.leadTimeMinDays !== null ? (d.leadTimeMaxDays !== null && d.leadTimeMaxDays !== d.leadTimeMinDays ? `${d.leadTimeMinDays}-${d.leadTimeMaxDays} days` : `${d.leadTimeMinDays} days`) : "—"}`);
    console.log(`  Payment:     ${d.paymentTerms ?? "—"}`);
    console.log(`  Validity:    ${d.validityPeriod ?? "—"}`);
  }
  if (result.extraction.notes.length > 0) {
    console.log(`  Notes:       ${JSON.stringify(result.extraction.notes)}`);
  }

  // Stage 2: Pre-policy
  console.log(`\n── Stage 2: Pre-Policy Checks ──`);
  if (result.action === "escalate" && result.policyEvaluation.details === "Escalated before policy evaluation") {
    console.log(`  Result:      ESCALATED (skipped policy eval)`);
    console.log(`  Reason:      ${result.escalationReason}`);
  } else {
    console.log(`  Result:      PASSED`);
  }

  // Stage 3: Policy
  console.log(`\n── Stage 3: Policy Evaluation ──`);
  if (result.policyEvaluation.provider) {
    console.log(`  Provider:    ${result.policyEvaluation.provider} (${result.policyEvaluation.model})`);
    console.log(`  Latency:     ${result.policyEvaluation.latencyMs}ms`);
    console.log(`  Tokens:      ${result.policyEvaluation.inputTokens} in / ${result.policyEvaluation.outputTokens} out`);
  }
  console.log(`  Rules:       ${JSON.stringify(result.policyEvaluation.rulesMatched)}`);
  console.log(`  Compliance:  ${result.policyEvaluation.complianceStatus}`);
  console.log(`  Details:     ${result.policyEvaluation.details}`);

  // Stage 4: Decision
  console.log(`\n── Stage 4: Decision ──`);
  console.log(`  Action:      ${result.action}`);
  console.log(`  Reasoning:   ${result.reasoning}`);

  // Stage 5: Response
  console.log(`\n── Stage 5: Response Generation ──`);
  if (result.responseGeneration) {
    console.log(`  Provider:    ${result.responseGeneration.provider} (${result.responseGeneration.model})`);
    console.log(`  Latency:     ${result.responseGeneration.latencyMs}ms`);
    console.log(`  Tokens:      ${result.responseGeneration.inputTokens} in / ${result.responseGeneration.outputTokens} out`);
  } else {
    console.log(`  LLM Call:    none (deterministic)`);
  }

  if (result.proposedApproval) {
    console.log(`\n  ┌─ APPROVAL PROPOSAL ─────────────────────┐`);
    console.log(`  │  Quantity: ${result.proposedApproval.quantity}`);
    console.log(`  │  Price:    $${result.proposedApproval.price}`);
    console.log(`  │  Total:    $${result.proposedApproval.total}`);
    console.log(`  │  Summary:  ${result.proposedApproval.summary.substring(0, 80)}`);
    console.log(`  └──────────────────────────────────────────┘`);
  }
  if (result.counterOffer) {
    console.log(`\n  ┌─ COUNTER-OFFER EMAIL ────────────────────┐`);
    result.counterOffer.draftEmail.split("\n").forEach((line) => {
      console.log(`  │  ${line}`);
    });
    console.log(`  │`);
    console.log(`  │  Terms: ${result.counterOffer.proposedTerms}`);
    console.log(`  └──────────────────────────────────────────┘`);
  }
  if (result.clarificationEmail) {
    console.log(`\n  ┌─ CLARIFICATION EMAIL ────────────────────┐`);
    result.clarificationEmail.split("\n").forEach((line) => {
      console.log(`  │  ${line}`);
    });
    console.log(`  └──────────────────────────────────────────┘`);
  }
  if (result.escalationReason) {
    console.log(`\n  ┌─ ESCALATION ──────────────────────────────┐`);
    console.log(`  │  ${result.escalationReason}`);
    console.log(`  └──────────────────────────────────────────┘`);
  }

  // Totals
  const totalIn = result.extraction.inputTokens
    + (result.policyEvaluation.inputTokens ?? 0)
    + (result.responseGeneration?.inputTokens ?? 0);
  const totalOut = result.extraction.outputTokens
    + (result.policyEvaluation.outputTokens ?? 0)
    + (result.responseGeneration?.outputTokens ?? 0);
  const totalMs = result.extraction.latencyMs
    + (result.policyEvaluation.latencyMs ?? 0)
    + (result.responseGeneration?.latencyMs ?? 0);

  console.log(`\n── Totals ──`);
  console.log(`  Tokens:  ${totalIn} in / ${totalOut} out (${totalIn + totalOut} total)`);
  console.log(`  Latency: ${totalMs}ms`);
  console.log(`${"═".repeat(60)}\n`);
}

async function main(): Promise<void> {
  const service = buildLLMService();
  const pipeline = new AgentPipeline(service);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   PO Pro — Interactive Pipeline Chat     ║");
  console.log("║   You are the SUPPLIER. Type replies.    ║");
  console.log("║   Type 'quit' to exit.                   ║");
  console.log("╚══════════════════════════════════════════╝");

  let sessionConfig: SessionConfig;
  if (scenarioPath) {
    const resolved = path.resolve(process.cwd(), scenarioPath);
    sessionConfig = loadScenarioConfig(resolved);
    console.log(`\nLoaded scenario from: ${scenarioPath}`);
  } else {
    sessionConfig = await promptForConfig(rl);
  }

  console.log(`\n  Order: ${sessionConfig.orderContext.skuName} (${sessionConfig.orderContext.supplierSku})`);
  console.log(`  Qty:   ${sessionConfig.orderContext.quantityRequested}`);
  console.log(`  Style: ${sessionConfig.orderContext.negotiationStyle ?? "ask_for_quote"}`);
  console.log(`  Rules: ${sessionConfig.negotiationRules.substring(0, 80)}${sessionConfig.negotiationRules.length > 80 ? "..." : ""}`);

  // Generate and display the initial outbound email
  console.log(`\n  Generating initial email to supplier...`);
  try {
    const initialEmail = await pipeline.generateInitialEmail(sessionConfig.orderContext);
    console.log(`\n  ┌─ INITIAL EMAIL TO SUPPLIER ─────────────────┐`);
    console.log(`  │  Subject: ${initialEmail.subjectLine}`);
    console.log(`  │`);
    initialEmail.emailText.split("\n").forEach((line) => {
      console.log(`  │  ${line}`);
    });
    console.log(`  │`);
    console.log(`  │  Provider: ${initialEmail.provider} (${initialEmail.model})`);
    console.log(`  │  Latency:  ${initialEmail.latencyMs}ms`);
    console.log(`  │  Tokens:   ${initialEmail.inputTokens} in / ${initialEmail.outputTokens} out`);
    console.log(`  └──────────────────────────────────────────────┘`);
  } catch (err) {
    console.log(`\n  Failed to generate initial email: ${err}`);
  }

  console.log(`\n  Now reply as the supplier.\n`);

  let turn = 0;

  const askForMessage = (): void => {
    rl.question(`[Supplier Turn ${turn + 1}] > `, async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "exit") {
        console.log("\nSession ended.");
        rl.close();
        return;
      }

      if (!trimmed) {
        askForMessage();
        return;
      }

      turn++;
      console.log(`\nProcessing...`);

      const request: AgentProcessRequest = {
        supplierMessage: trimmed,
        negotiationRules: sessionConfig.negotiationRules,
        escalationTriggers: sessionConfig.escalationTriggers,
        orderContext: sessionConfig.orderContext,
      };

      try {
        const result = await pipeline.process(request);
        printResult(result, turn);
      } catch (err) {
        console.error(`\nPipeline error: ${err}`);
      }

      askForMessage();
    });
  };

  askForMessage();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
