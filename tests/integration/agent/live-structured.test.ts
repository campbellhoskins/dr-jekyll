import * as path from "path";
import { LLMService } from "@/lib/llm/service";
import { ClaudeProvider } from "@/lib/llm/providers/claude";
import { Extractor } from "@/lib/agent/extractor";
import { PolicyEvaluator } from "@/lib/agent/policy-evaluator";
import { ResponseGenerator } from "@/lib/agent/response-generator";
import { AgentPipeline } from "@/lib/agent/pipeline";
import type { ExtractedQuoteData, OrderContext } from "@/lib/agent/types";

const apiKey = process.env.ANTHROPIC_API_KEY;
const describeOrSkip = apiKey ? describe : describe.skip;

describeOrSkip("Live structured output (tool_use) tests", () => {
  let service: LLMService;
  let extractor: Extractor;
  let policyEvaluator: PolicyEvaluator;
  let responseGenerator: ResponseGenerator;
  let pipeline: AgentPipeline;

  const sampleData: ExtractedQuoteData = {
    quotedPrice: 4.8,
    quotedPriceCurrency: "USD",
    quotedPriceUsd: 4.8,
    availableQuantity: 500,
    moq: 500,
    leadTimeMinDays: 30,
    leadTimeMaxDays: 30,
    paymentTerms: "30% deposit",
    validityPeriod: null,
    rawExtractionJson: {},
  };

  const sampleContext: OrderContext = {
    skuName: "LED Desk Lamp",
    supplierSku: "LDL-200",
    quantityRequested: "500",
    lastKnownPrice: 3.8,
  };

  beforeAll(() => {
    const provider = new ClaudeProvider(
      apiKey!,
      process.env.LLM_PRIMARY_MODEL ?? "claude-3-haiku-20240307"
    );
    service = new LLMService({
      primaryProvider: provider,
      maxRetriesPerProvider: 3,
      retryDelayMs: 1000,
    });
    extractor = new Extractor(service);
    policyEvaluator = new PolicyEvaluator(service);
    responseGenerator = new ResponseGenerator(service);
    pipeline = new AgentPipeline(service);
  });

  it("extraction returns valid ExtractedQuoteData via structured output", async () => {
    const result = await extractor.extract(
      "Hi, our price is $4.50 per unit, MOQ 500, lead time 25-30 days. 30% deposit. FOB Shenzhen."
    );

    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();
    expect(typeof result.data!.quotedPrice).toBe("number");
    expect(typeof result.data!.quotedPriceCurrency).toBe("string");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.error).toBeNull();
  });

  it("policy evaluation returns valid PolicyDecisionOutput via structured output", async () => {
    const result = await policyEvaluator.evaluate(
      sampleData,
      "Accept if price below $5.00. Lead time under 45 days.",
      "Escalate if MOQ exceeds 1000.",
      sampleContext
    );

    expect(["compliant", "non_compliant", "partial"]).toContain(result.complianceStatus);
    expect(["accept", "counter", "escalate", "clarify"]).toContain(result.recommendedAction);
    expect(result.reasoning.length).toBeGreaterThan(0);
    expect(typeof result.escalationTriggered).toBe("boolean");
  });

  it("counter-offer generation returns valid emailText via structured output", async () => {
    const result = await responseGenerator.generate(
      "counter",
      sampleData,
      {
        rulesMatched: ["price range"],
        complianceStatus: "non_compliant",
        recommendedAction: "counter",
        reasoning: "Price too high",
        escalationTriggered: false,
        counterTerms: { targetPrice: 4.0 },
        provider: "claude",
        model: "m",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      sampleContext,
      "Price $4.80 exceeds target"
    );

    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail.length).toBeGreaterThan(10);
    expect(typeof result.counterOffer!.proposedTerms).toBe("string");
    // No escalation fallback — structured output should work
    expect(result.escalationReason).toBeUndefined();
  });

  it("clarification generation returns valid emailText via structured output", async () => {
    const nullData: ExtractedQuoteData = {
      ...sampleData,
      quotedPrice: null,
      quotedPriceUsd: null,
      paymentTerms: null,
    };

    const result = await responseGenerator.generate(
      "clarify",
      nullData,
      null,
      sampleContext,
      "Need pricing information"
    );

    expect(result.clarificationEmail).toBeDefined();
    expect(result.clarificationEmail!.length).toBeGreaterThan(10);
    expect(result.escalationReason).toBeUndefined();
  });

  it("initial email generation returns valid emailText + subjectLine", async () => {
    const result = await pipeline.generateInitialEmail({
      ...sampleContext,
      negotiationStyle: "ask_for_quote",
    });

    expect(result.emailText.length).toBeGreaterThan(10);
    expect(result.subjectLine.length).toBeGreaterThan(0);
    expect(result.provider).toBe("claude");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });
});
