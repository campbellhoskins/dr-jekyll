import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";
import { LLMService } from "../lib/llm/service";
import { ClaudeProvider } from "../lib/llm/providers/claude";
import { OpenAIProvider } from "../lib/llm/providers/openai";
import { Extractor } from "../lib/agent/extractor";
import type { ExtractionResult } from "../lib/agent/types";
import type { LLMProvider } from "../lib/llm/types";

// Load .env.local
config({ path: path.resolve(process.cwd(), ".env.local") });

// ─── CLI argument parsing ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const allFixtures = args.includes("--all-fixtures");
const fileIndex = args.indexOf("--file");
const filePath = fileIndex !== -1 ? args[fileIndex + 1] : null;
const providerFlag = args.indexOf("--provider");
const providerName = providerFlag !== -1 ? args[providerFlag + 1] : null;
const modelFlag = args.indexOf("--model");
const modelName = modelFlag !== -1 ? args[modelFlag + 1] : null;

// ─── Build LLM Service ───────────────────────────────────────────────────────
function buildLLMService(): LLMService {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const primaryModel =
    modelName ?? process.env.LLM_PRIMARY_MODEL ?? "claude-3-haiku-20240307";
  const fallbackModel = process.env.LLM_FALLBACK_MODEL ?? "gpt-4o";
  const maxRetries = parseInt(process.env.LLM_MAX_RETRIES ?? "3", 10);

  let primaryProvider: LLMProvider;
  let fallbackProvider: LLMProvider | undefined;

  if (providerName === "openai") {
    if (!openaiKey) {
      console.error("Error: OPENAI_API_KEY not set in .env.local");
      process.exit(1);
    }
    primaryProvider = new OpenAIProvider(openaiKey, modelName ?? fallbackModel);
  } else {
    if (!anthropicKey) {
      console.error("Error: ANTHROPIC_API_KEY not set in .env.local");
      process.exit(1);
    }
    primaryProvider = new ClaudeProvider(anthropicKey, primaryModel);
    if (openaiKey) {
      fallbackProvider = new OpenAIProvider(openaiKey, fallbackModel);
    }
  }

  return new LLMService({
    primaryProvider,
    fallbackProvider,
    maxRetriesPerProvider: maxRetries,
    retryDelayMs: 1000,
  });
}

// ─── Output formatting ───────────────────────────────────────────────────────
function printResult(result: ExtractionResult, source: string): void {
  if (!result.success) {
    console.log(`\n  ERROR: ${result.error}`);
    console.log(`  Provider: ${result.provider} | Model: ${result.model}`);
    return;
  }

  const d = result.data!;
  console.log(`\nExtracted Quote:`);
  console.log(
    `  Quoted Price:      ${d.quotedPrice !== null ? `${d.quotedPrice} ${d.quotedPriceCurrency}` : "—"}`
  );
  console.log(
    `  Price (USD):       ${d.quotedPriceUsd !== null ? `$${d.quotedPriceUsd}` : "—"}`
  );
  console.log(
    `  Available Qty:     ${d.availableQuantity !== null ? d.availableQuantity : "—"}`
  );
  console.log(`  MOQ:               ${d.moq !== null ? d.moq : "—"}`);
  console.log(
    `  Lead Time:         ${d.leadTimeMinDays !== null ? (d.leadTimeMaxDays !== null && d.leadTimeMaxDays !== d.leadTimeMinDays ? `${d.leadTimeMinDays}-${d.leadTimeMaxDays} days` : `${d.leadTimeMinDays} days`) : "—"}`
  );
  console.log(
    `  Payment Terms:     ${d.paymentTerms ?? "—"}`
  );
  console.log(
    `  Validity Period:   ${d.validityPeriod ?? "—"}`
  );
  console.log(`  Confidence:        ${result.confidence}`);
  console.log(
    `  Notes:             ${result.notes.length > 0 ? JSON.stringify(result.notes) : "[]"}`
  );
  console.log(
    `  Provider:          ${result.provider} (${result.model})`
  );
  console.log(`  Latency:           ${result.latencyMs}ms`);
  if (result.retryCount > 0) {
    console.log(`  Retries:           ${result.retryCount}`);
  }
}

function printVerboseResult(
  emailText: string,
  result: ExtractionResult,
  source: string
): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`═══ STEP 1: Input ═══`);
  console.log(`Source: ${source}`);
  console.log(`Email text (${emailText.length} chars):`);
  console.log(
    emailText
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")
  );

  console.log(`\n═══ STEP 2: Prompt Construction ═══`);
  console.log(`  System prompt and user message sent to LLM.`);
  console.log(`  All spec fields requested: quotedPrice, quotedPriceCurrency,`);
  console.log(
    `  availableQuantity, moq, leadTimeDays, paymentTerms, validityPeriod`
  );

  console.log(`\n═══ STEP 3: LLM Call ═══`);
  console.log(`  Provider: ${result.provider} (${result.model})`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log(`  Retries: ${result.retryCount}`);

  if (result.success && result.data) {
    console.log(`\n═══ STEP 4: Parse & Validate ═══`);
    console.log(`  JSON extracted: yes`);
    console.log(`  Zod validation: passed`);
    console.log(
      `  USD conversion: quotedPriceUsd = ${result.data.quotedPriceUsd}`
    );

    console.log(`\n═══ STEP 5: Result ═══`);
    printResult(result, source);
    console.log(
      `  rawExtractionJson: ${JSON.stringify(result.data.rawExtractionJson)}`
    );
  } else {
    console.log(`\n═══ STEP 4: Parse & Validate ═══`);
    console.log(`  FAILED: ${result.error}`);
  }
  console.log(`${"═".repeat(60)}`);
}

// ─── Read email text ─────────────────────────────────────────────────────────
function readFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    console.log(
      "Paste supplier email text, then press Ctrl+D (Unix) or Ctrl+Z+Enter (Windows):"
    );
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const service = buildLLMService();
  const extractor = new Extractor(service);

  if (allFixtures) {
    const fixturesDir = path.resolve(
      process.cwd(),
      "tests/fixtures/supplier-emails"
    );
    const files = fs
      .readdirSync(fixturesDir)
      .filter((f) => f.endsWith(".txt"))
      .sort();

    console.log(`Running ${files.length} fixtures...\n`);

    for (const file of files) {
      const fullPath = path.join(fixturesDir, file);
      const emailText = fs.readFileSync(fullPath, "utf8").trim();
      console.log(`\n--- ${file} ---`);

      const result = await extractor.extract(emailText);

      if (verbose) {
        printVerboseResult(emailText, result, file);
      } else {
        printResult(result, file);
      }
    }
    return;
  }

  let emailText: string;
  let source: string;

  if (filePath) {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    emailText = fs.readFileSync(resolvedPath, "utf8").trim();
    source = filePath;
  } else {
    emailText = await readFromStdin();
    source = "stdin";
  }

  const result = await extractor.extract(emailText);

  if (verbose) {
    printVerboseResult(emailText, result, source);
  } else {
    printResult(result, source);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
