import * as path from "path";
import { LLMService } from "@/lib/llm/service";
import { ClaudeProvider } from "@/lib/llm/providers/claude";
import { Extractor } from "@/lib/agent/extractor";
import { EscalationExpert } from "@/lib/agent/experts/escalation";
import { ResponseCrafter } from "@/lib/agent/experts/response-crafter";
import { AgentPipeline } from "@/lib/agent/pipeline";
import type { ExtractedQuoteData, OrderContext } from "@/lib/agent/types";

const apiKey = process.env.ANTHROPIC_API_KEY;
const describeOrSkip = apiKey ? describe : describe.skip;

describeOrSkip("Live structured output (tool_use) tests", () => {
  let service: LLMService;
  let extractor: Extractor;
  let escalationExpert: EscalationExpert;
  let responseCrafter: ResponseCrafter;
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
    escalationExpert = new EscalationExpert(service);
    responseCrafter = new ResponseCrafter(service);
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

  it("escalation evaluation returns valid EscalationAnalysis via structured output", async () => {
    const opinion = await escalationExpert.analyze({
      supplierMessage: "Price is $4.80 per unit, MOQ 500.",
      escalationTriggers: "Escalate if MOQ exceeds 1000.",
      extractedData: sampleData,
      orderContext: { skuName: sampleContext.skuName, supplierSku: sampleContext.supplierSku },
    });

    expect(opinion.expertName).toBe("escalation");
    const analysis = opinion.analysis as { type: string; shouldEscalate: boolean; reasoning: string };
    expect(analysis.type).toBe("escalation");
    expect(typeof analysis.shouldEscalate).toBe("boolean");
    expect(analysis.reasoning.length).toBeGreaterThan(0);
  });

  it("counter-offer generation returns valid emailText via structured output", async () => {
    const result = await responseCrafter.craft({
      action: "counter",
      reasoning: "Price $4.80 exceeds target",
      extractedData: sampleData,
      orderContext: sampleContext,
      counterTerms: { targetPrice: 4.0 },
    });

    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail.length).toBeGreaterThan(10);
    expect(typeof result.counterOffer!.proposedTerms).toBe("string");
    expect(result.escalationReason).toBeUndefined();
  });

  it("clarification generation returns valid emailText via structured output", async () => {
    const nullData: ExtractedQuoteData = {
      ...sampleData,
      quotedPrice: null,
      quotedPriceUsd: null,
      paymentTerms: null,
    };

    const result = await responseCrafter.craft({
      action: "clarify",
      reasoning: "Need pricing information",
      extractedData: nullData,
      orderContext: sampleContext,
    });

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
