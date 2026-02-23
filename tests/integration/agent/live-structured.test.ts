import { LLMService } from "@/lib/llm/service";
import { ClaudeProvider } from "@/lib/llm/providers/claude";
import { AgentPipeline } from "@/lib/agent/pipeline";
import { buildTestOrderInformation } from "../../helpers/order-information";

const apiKey = process.env.ANTHROPIC_API_KEY;
const describeOrSkip = apiKey ? describe : describe.skip;

describeOrSkip("Live structured output tests", () => {
  let pipeline: AgentPipeline;

  const sampleOrderInformation = buildTestOrderInformation({
    product: { productName: "LED Desk Lamp", supplierProductCode: "LDL-200", merchantSKU: "LDL-200" },
    pricing: { targetPrice: 3.80, maximumAcceptablePrice: 4.20, lastKnownPrice: 3.80 },
    quantity: { targetQuantity: 500 },
  });

  beforeAll(() => {
    const provider = new ClaudeProvider(
      apiKey!,
      process.env.LLM_TEST_MODEL ?? "claude-3-haiku-20240307"
    );
    const service = new LLMService({
      primaryProvider: provider,
      maxRetriesPerProvider: 3,
      retryDelayMs: 1000,
    });
    pipeline = new AgentPipeline(service);
  });

  it("agent produces valid action and response for a counter scenario", async () => {
    const result = await pipeline.process({
      supplierMessage: "Hi, our price is $4.50 per unit, MOQ 500, lead time 25-30 days. 30% deposit. FOB Shenzhen.",
      orderInformation: sampleOrderInformation,
    });

    expect(["accept", "counter", "escalate"]).toContain(result.action);
    expect(result.reasoning.length).toBeGreaterThan(0);
    expect(result.decision.length).toBeGreaterThan(0);
    expect(result.responseText.length).toBeGreaterThan(10);
    expect(result.provider).toBe("claude");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it("initial email generation returns valid emailText + subjectLine", async () => {
    const result = await pipeline.generateInitialEmail(sampleOrderInformation);

    expect(result.emailText.length).toBeGreaterThan(10);
    expect(result.subjectLine.length).toBeGreaterThan(0);
    expect(result.provider).toBe("claude");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it("rules generation returns order context and merchant rules", async () => {
    const result = await pipeline.generateRules(sampleOrderInformation);

    expect(result.orderContext.length).toBeGreaterThan(50);
    expect(result.merchantRules.length).toBeGreaterThan(100);
    expect(result.orderContext).toContain("LED Desk Lamp");
    expect(result.provider).toBe("claude");
  });
});
