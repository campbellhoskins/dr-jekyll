import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { OpenAIProvider } from "../lib/llm/providers/openai";
import { AgentPipeline } from "../lib/agent/pipeline";
import type { AgentProcessRequest, AgentProcessResponse } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";

config({ path: path.resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const allScenarios = args.includes("--all-scenarios");
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
  negotiationRules: string;
  escalationTriggers: string;
  orderContext: {
    skuName: string;
    supplierSku: string;
    quantityRequested: string;
    lastKnownPrice: number;
    specialInstructions?: string;
  };
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
    console.log(`  Quoted Price:      ${d.quotedPrice !== null ? `${d.quotedPrice} ${d.quotedPriceCurrency}` : "—"}`);
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

function printVerboseResult(result: AgentProcessResponse, scenario: ScenarioFile): void {
  console.log(`\n${"═".repeat(60)}`);

  console.log(`\n═══ STAGE 1: EXTRACTION ═══`);
  console.log(`  Success:     ${result.extraction.success}`);
  console.log(`  Confidence:  ${result.extraction.confidence}`);
  console.log(`  Provider:    ${result.extraction.provider} (${result.extraction.model})`);
  console.log(`  Latency:     ${result.extraction.latencyMs}ms`);
  console.log(`  Tokens:      ${result.extraction.inputTokens} in / ${result.extraction.outputTokens} out`);
  if (result.extractedData) {
    const d = result.extractedData;
    console.log(`  Price:       ${d.quotedPrice !== null ? `${d.quotedPrice} ${d.quotedPriceCurrency} ($${d.quotedPriceUsd} USD)` : "—"}`);
    console.log(`  MOQ:         ${d.moq ?? "—"}`);
    console.log(`  Lead Time:   ${d.leadTimeMinDays !== null ? `${d.leadTimeMinDays}-${d.leadTimeMaxDays} days` : "—"}`);
    console.log(`  Payment:     ${d.paymentTerms ?? "—"}`);
  }
  if (result.extraction.notes.length > 0) {
    console.log(`  Notes:       ${JSON.stringify(result.extraction.notes)}`);
  }

  console.log(`\n═══ STAGE 2: PRE-POLICY CHECKS ═══`);
  if (result.action === "escalate" && result.policyEvaluation.details === "Escalated before policy evaluation") {
    console.log(`  Result:      ESCALATED (skipped policy evaluation)`);
    console.log(`  Reason:      ${result.escalationReason}`);
  } else {
    console.log(`  Result:      PASSED (proceeding to policy evaluation)`);
  }

  console.log(`\n═══ STAGE 3: POLICY EVALUATION ═══`);
  if (result.policyEvaluation.provider) {
    console.log(`  Provider:       ${result.policyEvaluation.provider} (${result.policyEvaluation.model})`);
    console.log(`  Latency:        ${result.policyEvaluation.latencyMs}ms`);
    console.log(`  Tokens:         ${result.policyEvaluation.inputTokens} in / ${result.policyEvaluation.outputTokens} out`);
  }
  console.log(`  Rules Matched:  ${JSON.stringify(result.policyEvaluation.rulesMatched)}`);
  console.log(`  Compliance:     ${result.policyEvaluation.complianceStatus}`);
  console.log(`  Details:        ${result.policyEvaluation.details}`);

  console.log(`\n═══ STAGE 4: DECISION ═══`);
  console.log(`  Action:      ${result.action}`);
  console.log(`  Reasoning:   ${result.reasoning}`);

  console.log(`\n═══ STAGE 5: RESPONSE GENERATION ═══`);
  if (result.responseGeneration) {
    console.log(`  Provider:    ${result.responseGeneration.provider} (${result.responseGeneration.model})`);
    console.log(`  Latency:     ${result.responseGeneration.latencyMs}ms`);
    console.log(`  Tokens:      ${result.responseGeneration.inputTokens} in / ${result.responseGeneration.outputTokens} out`);
  } else {
    console.log(`  LLM Call:    none (deterministic)`);
  }
  if (result.proposedApproval) {
    console.log(`  Type:        Approval Proposal`);
    console.log(`  Quantity:    ${result.proposedApproval.quantity}`);
    console.log(`  Price:       $${result.proposedApproval.price}`);
    console.log(`  Total:       $${result.proposedApproval.total}`);
  } else if (result.counterOffer) {
    console.log(`  Type:        Counter-Offer Email`);
    console.log(`  Email:       ${result.counterOffer.draftEmail}`);
    console.log(`  Terms:       ${result.counterOffer.proposedTerms}`);
  } else if (result.clarificationEmail) {
    console.log(`  Type:        Clarification Email`);
    console.log(`  Email:       ${result.clarificationEmail}`);
  } else if (result.escalationReason) {
    console.log(`  Type:        Escalation`);
    console.log(`  Reason:      ${result.escalationReason}`);
  }

  console.log(`\n═══ FINAL RESULT ═══`);
  printResult(result, scenario);
  console.log(`${"═".repeat(60)}`);
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
      negotiationRules: scenario.negotiationRules,
      escalationTriggers: scenario.escalationTriggers,
      orderContext: scenario.orderContext,
    };

    const result = await pipeline.process(request);

    if (verbose) {
      printVerboseResult(result, scenario);
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
