/**
 * CLI tool: Generate ORDER_CONTEXT + MERCHANT_RULES from a scenario file.
 * Replaces the old extraction CLI — the agent now evaluates terms inline.
 *
 * Usage:
 *   npm run extract -- --scenario tests/fixtures/scenarios/simple-acceptable.json
 *   npm run extract -- --scenario tests/fixtures/scenarios/simple-acceptable.json --verbose
 */
import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { OpenAIProvider } from "../lib/llm/providers/openai";
import { AgentPipeline } from "../lib/agent/pipeline";
import type { OrderInformation } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";

config({ path: path.resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
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

  const primaryProvider: LLMProvider = new ClaudeProvider(anthropicKey, primaryModel);
  let fallbackProvider: LLMProvider | undefined;
  if (openaiKey) {
    fallbackProvider = new OpenAIProvider(openaiKey, fallbackModel);
  }

  return new LLMService({
    primaryProvider,
    fallbackProvider,
    maxRetriesPerProvider: maxRetries,
    retryDelayMs: 1000,
  });
}

async function main(): Promise<void> {
  if (!scenarioPath) {
    console.error("Usage: npm run extract -- --scenario <path.json> [--verbose]");
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), scenarioPath);
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const orderInformation: OrderInformation = data.orderInformation;

  console.log(`Generating rules from: ${scenarioPath}`);
  console.log(`Product: ${orderInformation.product.productName} (${orderInformation.product.supplierProductCode})`);

  const service = buildLLMService();
  const pipeline = new AgentPipeline(service);

  const result = await pipeline.generateRules(orderInformation);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ORDER CONTEXT:`);
  console.log(`${"=".repeat(60)}`);
  console.log(result.orderContext);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`MERCHANT RULES:`);
  console.log(`${"=".repeat(60)}`);
  console.log(result.merchantRules);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Provider: ${result.provider} (${result.model})`);
  console.log(`Latency:  ${result.latencyMs}ms`);
  console.log(`Tokens:   ${result.inputTokens} in / ${result.outputTokens} out`);

  if (verbose) {
    console.log(`\nOrder Information (input):`);
    console.log(JSON.stringify(orderInformation, null, 2));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
