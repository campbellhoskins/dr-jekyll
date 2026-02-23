import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { OpenAIProvider } from "../lib/llm/providers/openai";
import { AgentPipeline } from "../lib/agent/pipeline";
import type { AgentProcessRequest, AgentProcessResponse, OrderInformation } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";
import { printInputContext, printExpertOpinionWithContext, printOrchestratorTrace, printResponse, printTotals } from "./display";

config({ path: path.resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const allScenarios = args.includes("--all-scenarios");
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

interface ScenarioFile {
  name: string;
  description: string;
  supplierMessage: string;
  orderInformation: OrderInformation;
  expectedAction: string;
  expectedComplianceStatus: string;
}

function printResult(result: AgentProcessResponse, scenario: ScenarioFile): void {
  const actionMatch = result.action === scenario.expectedAction ? "MATCH" : "MISMATCH";

  console.log(`\n  Action:            ${result.action} [expected: ${scenario.expectedAction}] ${actionMatch}`);
  console.log(`  Compliance:        ${result.policyEvaluation.complianceStatus}`);
  console.log(`  Reasoning:         ${result.reasoning.substring(0, 120)}${result.reasoning.length > 120 ? "..." : ""}`);

  if (result.extractedData) {
    const d = result.extractedData;
    console.log(`  Quoted Price:      ${d.quotedPrice !== null ? `${d.quotedPrice} ${d.quotedPriceCurrency}` : "---"}`);
  }

  if (result.proposedApproval) {
    const a = result.proposedApproval;
    console.log(`  Approval:          ${a.quantity} units @ $${a.price} = $${a.total}`);
  }

  if (result.counterOffer) {
    console.log(`  Counter Email:     ${result.counterOffer.draftEmail.substring(0, 100)}...`);
    console.log(`  Counter Terms:     ${result.counterOffer.proposedTerms}`);
  }

  if (result.clarificationEmail) {
    console.log(`  Clarify Email:     ${result.clarificationEmail.substring(0, 100)}...`);
  }

  if (result.escalationReason) {
    console.log(`  Escalation:        ${result.escalationReason}`);
  }
}

function printVerboseResult(result: AgentProcessResponse, request: AgentProcessRequest, scenario: ScenarioFile): void {
  console.log(`\n${"=".repeat(60)}`);

  // 1. Full input context
  console.log(`\n=== INPUT CONTEXT ===`);
  printInputContext(request);

  // 2. Parallel expert fan-out with context
  if (result.expertOpinions) {
    console.log(`\n=== PARALLEL EXPERT FAN-OUT ===`);
    for (const opinion of result.expertOpinions.slice(0, 2)) {
      console.log(`\n-- ${opinion.expertName.toUpperCase()} EXPERT --`);
      printExpertOpinionWithContext(opinion, request);
    }
  }

  // 3. Orchestrator trace — full reasoning chain with context
  if (result.orchestratorTrace) {
    console.log(`\n=== ORCHESTRATOR DECISION LOOP ===`);
    printOrchestratorTrace(result.orchestratorTrace, request);
  }

  // 4. Response crafting
  console.log(`\n=== RESPONSE CRAFTER ===`);
  printResponse(result);

  // 5. Totals
  console.log(`\n=== TOTALS ===`);
  printTotals(result);

  console.log(`\n=== FINAL RESULT ===`);
  printResult(result, scenario);
  console.log(`${"=".repeat(60)}`);
}

async function main(): Promise<void> {
  const service = buildLLMService();
  const pipeline = new AgentPipeline(service);

  const scenariosDir = path.resolve(process.cwd(), "tests/fixtures/scenarios");

  let scenarioFiles: string[];
  if (allScenarios) {
    scenarioFiles = fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".json")).sort();
  } else if (scenarioPath) {
    scenarioFiles = [path.basename(scenarioPath)];
  } else {
    console.error("Usage: npm run pipeline -- --scenario <path> | --all-scenarios [--verbose]");
    process.exit(1);
  }

  console.log(`Running ${scenarioFiles.length} scenario(s)...\n`);

  let passed = 0;
  for (const file of scenarioFiles) {
    const fullPath = allScenarios ? path.join(scenariosDir, file) : path.resolve(process.cwd(), scenarioPath!);
    const scenario: ScenarioFile = JSON.parse(fs.readFileSync(fullPath, "utf8"));

    console.log(`\n--- ${scenario.name} ---`);
    console.log(`  ${scenario.description}`);

    const request: AgentProcessRequest = {
      supplierMessage: scenario.supplierMessage,
      orderInformation: scenario.orderInformation,
    };

    const result = await pipeline.process(request);

    if (verbose) {
      printVerboseResult(result, request, scenario);
    } else {
      printResult(result, scenario);
    }

    if (result.action === scenario.expectedAction) passed++;
  }

  console.log(`\n\nResults: ${passed}/${scenarioFiles.length} scenarios matched expected action.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
