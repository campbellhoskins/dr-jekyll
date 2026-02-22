import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { OpenAIProvider } from "../lib/llm/providers/openai";
import { AgentPipeline } from "../lib/agent/pipeline";
import { ConversationContext } from "../lib/agent/conversation-context";
import type { AgentProcessRequest, AgentProcessResponse, OrderContext } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";
import { printExpertOpinion, printOrchestratorTrace, printResponse, printTotals } from "./display";

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
  merchantInstructions: string;
  negotiationRules: string;
  escalationTriggers: string;
  orderContext: OrderContext;
}

function loadScenarioConfig(filePath: string): SessionConfig {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    merchantInstructions: data.merchantInstructions ?? "",
    negotiationRules: data.negotiationRules ?? "",
    escalationTriggers: data.escalationTriggers ?? "",
    orderContext: data.orderContext,
  };
}

function promptForConfig(rl: readline.Interface): Promise<SessionConfig> {
  return new Promise((resolve) => {
    const ask = (question: string): Promise<string> =>
      new Promise((res) => rl.question(question, res));

    (async () => {
      console.log("\n-- Session Setup --\n");

      const skuName = await ask("  SKU name: ");
      const supplierSku = await ask("  Supplier SKU: ");
      const qty = await ask("  Quantity requested: ");
      const lastPrice = await ask("  Last known price ($): ");

      console.log("");
      const styleInput = await ask("  Negotiation style (1=ask for quote, 2=state price upfront) [1]: ");
      console.log("");
      console.log("  Provide any instructions, preferences, rules, or limits.");
      console.log("  Examples: 'I want blue shoes at $40. Don't go above $50.'");
      const merchantInstructions = await ask("  Instructions:\n  > ");

      resolve({
        merchantInstructions,
        negotiationRules: "",
        escalationTriggers: "",
        orderContext: {
          skuName,
          supplierSku,
          quantityRequested: qty,
          lastKnownPrice: parseFloat(lastPrice) || 0,
          negotiationStyle: styleInput === "2" ? "state_price_upfront" : "ask_for_quote",
        },
      });
    })();
  });
}

function printResult(result: AgentProcessResponse, turn: number): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  TURN ${turn} -- PIPELINE RESULT`);
  console.log(`${"=".repeat(60)}`);

  // Initial expert opinions (parallel fan-out)
  if (result.expertOpinions) {
    console.log(`\n-- PARALLEL EXPERT FAN-OUT --`);
    for (const opinion of result.expertOpinions.slice(0, 2)) {
      console.log(`\n  [${opinion.expertName.toUpperCase()}]`);
      printExpertOpinion(opinion, "    ");
    }
  }

  // Orchestrator trace — full reasoning chain
  if (result.orchestratorTrace) {
    console.log(`\n-- ORCHESTRATOR DECISION LOOP --`);
    printOrchestratorTrace(result.orchestratorTrace, "  ");
  }

  // Response
  console.log(`\n-- RESPONSE CRAFTER --`);
  printResponse(result);

  // Totals
  console.log(`\n-- Totals --`);
  printTotals(result);
  console.log(`${"=".repeat(60)}\n`);
}

async function main(): Promise<void> {
  const service = buildLLMService();
  const pipeline = new AgentPipeline(service);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("+==========================================+");
  console.log("|   PO Pro -- Interactive Pipeline Chat     |");
  console.log("|   You are the SUPPLIER. Type replies.     |");
  console.log("|   Type 'quit' to exit.                    |");
  console.log("+==========================================+");

  let sessionConfig: SessionConfig;
  if (scenarioPath) {
    const resolved = path.resolve(process.cwd(), scenarioPath);
    sessionConfig = loadScenarioConfig(resolved);
    console.log(`\nLoaded scenario from: ${scenarioPath}`);
  } else {
    sessionConfig = await promptForConfig(rl);
  }

  console.log(`\n  Order:        ${sessionConfig.orderContext.skuName} (${sessionConfig.orderContext.supplierSku})`);
  console.log(`  Qty:          ${sessionConfig.orderContext.quantityRequested}`);
  console.log(`  Style:        ${sessionConfig.orderContext.negotiationStyle ?? "ask_for_quote"}`);
  if (sessionConfig.merchantInstructions) {
    console.log(`  Instructions: ${sessionConfig.merchantInstructions.substring(0, 80)}${sessionConfig.merchantInstructions.length > 80 ? "..." : ""}`);
  }

  const context = new ConversationContext();

  console.log(`\n  Generating initial email to supplier...`);
  try {
    const initialEmail = await pipeline.generateInitialEmail(sessionConfig.orderContext);
    context.addAgentMessage(initialEmail.emailText);
    console.log(`\n  +-- INITIAL EMAIL TO SUPPLIER ----------------+`);
    console.log(`  |  Subject: ${initialEmail.subjectLine}`);
    console.log(`  |`);
    initialEmail.emailText.split("\n").forEach((line) => {
      console.log(`  |  ${line}`);
    });
    console.log(`  |`);
    console.log(`  |  Provider: ${initialEmail.provider} (${initialEmail.model})`);
    console.log(`  |  Latency:  ${initialEmail.latencyMs}ms`);
    console.log(`  |  Tokens:   ${initialEmail.inputTokens} in / ${initialEmail.outputTokens} out`);
    console.log(`  +----------------------------------------------+`);
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
      context.addSupplierMessage(trimmed);
      console.log(`\nProcessing... (${context.getMessageCount()} messages in context)`);

      const request: AgentProcessRequest = {
        supplierMessage: trimmed,
        negotiationRules: sessionConfig.negotiationRules,
        escalationTriggers: sessionConfig.escalationTriggers,
        orderContext: sessionConfig.orderContext,
        conversationHistory: context.formatForPrompt(),
        priorExtractedData: context.getMergedData(),
        merchantInstructions: sessionConfig.merchantInstructions || undefined,
      };

      try {
        const result = await pipeline.process(request);

        if (result.extractedData) {
          context.mergeExtraction(result.extractedData);
        }

        if (result.counterOffer) {
          context.addAgentMessage(result.counterOffer.draftEmail);
        } else if (result.clarificationEmail) {
          context.addAgentMessage(result.clarificationEmail);
        }

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
