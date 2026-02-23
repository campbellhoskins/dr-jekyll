import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { OpenAIProvider } from "../lib/llm/providers/openai";
import { AgentPipeline } from "../lib/agent/pipeline";
import { ConversationContext } from "../lib/agent/conversation-context";
import type { AgentProcessRequest, AgentProcessResponse, OrderInformation } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";
import { printInputContext, printEvaluation, printDecision, printResponse, printTotals } from "./display";

config({ path: path.resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const scenarioIndex = args.indexOf("--scenario");
const scenarioPath = scenarioIndex !== -1 ? args[scenarioIndex + 1] : null;

function buildLLMService(): LLMService {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const primaryModel = process.env.LLM_CLI_MODEL ?? "claude-3-haiku-20240307";
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
  orderInformation: OrderInformation;
}

/** Strip currency symbols and whitespace so parseFloat works on inputs like "$35" */
function parseNumber(input: string): number {
  return parseFloat(input.replace(/[^0-9.\-]/g, "")) || 0;
}

function loadScenarioConfig(filePath: string): SessionConfig {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    orderInformation: data.orderInformation,
  };
}

function promptForConfig(rl: readline.Interface): Promise<SessionConfig> {
  return new Promise((resolve) => {
    const ask = (question: string): Promise<string> =>
      new Promise((res) => rl.question(question, res));

    (async () => {
      console.log("\n-- Session Setup --\n");

      const productName = await ask("  Product name: ");
      const supplierSku = await ask("  Supplier SKU: ");
      const qty = await ask("  Target quantity: ");
      const targetPrice = await ask("  Target price (USD, e.g. 35): ");
      const maxPrice = await ask("  Max acceptable price (USD, e.g. 40): ");
      const lastPrice = await ask("  Last known price (USD) [optional]: ");

      console.log("");
      const maxLeadTime = await ask("  Max lead time (days) [optional]: ");
      const paymentTerms = await ask("  Required payment terms [optional]: ");
      const notes = await ask("  Any special notes [optional]: ");

      const orderInformation: OrderInformation = {
        merchant: {
          merchantId: "interactive",
          merchantName: "Interactive User",
          contactName: "User",
          contactEmail: "user@example.com",
        },
        supplier: {
          supplierName: "Supplier",
        },
        product: {
          merchantSKU: supplierSku,
          supplierProductCode: supplierSku,
          productName,
        },
        pricing: {
          currency: "USD",
          targetPrice: parseNumber(targetPrice),
          maximumAcceptablePrice: parseNumber(maxPrice),
          lastKnownPrice: lastPrice ? parseNumber(lastPrice) : undefined,
        },
        quantity: {
          targetQuantity: parseInt(qty, 10) || 0,
        },
      };

      if (maxLeadTime) {
        orderInformation.leadTime = { maximumLeadTimeDays: parseInt(maxLeadTime, 10) };
      }
      if (paymentTerms) {
        orderInformation.paymentTerms = { requiredTerms: paymentTerms };
      }
      if (notes) {
        orderInformation.metadata = { orderNotes: notes };
      }

      resolve({ orderInformation });
    })();
  });
}

function printTurnResult(result: AgentProcessResponse, request: AgentProcessRequest, turn: number): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  TURN ${turn} -- PIPELINE RESULT`);
  console.log(`${"=".repeat(60)}`);

  // Full input context
  console.log(`\n-- INPUT CONTEXT --`);
  printInputContext(request, "  ");

  // Systematic evaluation
  console.log(`\n-- SYSTEMATIC EVALUATION --`);
  printEvaluation(result, "  ");

  // Decision
  console.log(`\n-- DECISION --`);
  printDecision(result, "  ");

  // Response
  console.log(`\n-- RESPONSE --`);
  printResponse(result, "  ");

  // Totals
  console.log(`\n-- Totals --`);
  printTotals(result, "  ");
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

  const oi = sessionConfig.orderInformation;
  console.log(`\n  Order:        ${oi.product.productName} (${oi.product.supplierProductCode})`);
  console.log(`  Qty:          ${oi.quantity.targetQuantity}`);
  console.log(`  Pricing:      target $${oi.pricing.targetPrice}, max $${oi.pricing.maximumAcceptablePrice}`);

  const context = new ConversationContext();

  // Cache rules across turns
  let cachedOrderContext: string | undefined;
  let cachedMerchantRules: string | undefined;

  console.log(`\n  Generating initial email to supplier...`);
  try {
    const initialEmail = await pipeline.generateInitialEmail(oi);
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
        orderInformation: oi,
        conversationHistory: context.formatForPrompt(),
        cachedOrderContext,
        cachedMerchantRules,
      };

      try {
        const result = await pipeline.process(request);

        // Cache rules for subsequent turns
        if (!cachedOrderContext) cachedOrderContext = result.orderContext;
        if (!cachedMerchantRules) cachedMerchantRules = result.merchantRules;

        // Add agent response to conversation
        if (result.action !== "escalate") {
          context.addAgentMessage(result.responseText);
        }

        printTurnResult(result, request, turn);
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
