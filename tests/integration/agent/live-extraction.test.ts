import { LLMService } from "@/lib/llm/service";
import { ClaudeProvider } from "@/lib/llm/providers/claude";
import { AgentPipeline } from "@/lib/agent/pipeline";
import { buildTestOrderInformation } from "../../helpers/order-information";

// Skip all tests if no API key
const apiKey = process.env.ANTHROPIC_API_KEY;
const describeOrSkip = apiKey ? describe : describe.skip;

describeOrSkip("Live rules generation tests", () => {
  let pipeline: AgentPipeline;

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

  it("generates order context with product and pricing info", async () => {
    const oi = buildTestOrderInformation({
      product: { productName: "Bamboo Cutting Board", supplierProductCode: "BCB-001", merchantSKU: "BCB-001" },
      pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00 },
      quantity: { targetQuantity: 500 },
    });

    const result = await pipeline.generateRules(oi);

    expect(result.orderContext).toContain("Bamboo Cutting Board");
    expect(result.orderContext.length).toBeGreaterThan(50);
    expect(result.provider).toBe("claude");
  });

  it("generates merchant rules with pricing thresholds", async () => {
    const oi = buildTestOrderInformation({
      pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00 },
      escalation: { additionalTriggers: ["Escalate if MOQ exceeds 1000 units"] },
    });

    const result = await pipeline.generateRules(oi);

    expect(result.merchantRules.length).toBeGreaterThan(100);
    // Should contain pricing rules with actual values
    expect(result.merchantRules).toMatch(/4/);
    expect(result.merchantRules).toMatch(/5/);
    // Should contain escalation triggers
    expect(result.merchantRules).toMatch(/MOQ|1000/i);
  });

  it("generates rules with lead time and payment terms", async () => {
    const oi = buildTestOrderInformation({
      leadTime: { maximumLeadTimeDays: 45, preferredLeadTimeDays: 30 },
      paymentTerms: { requiredTerms: "Net 30" },
    });

    const result = await pipeline.generateRules(oi);

    expect(result.merchantRules).toMatch(/lead time/i);
    expect(result.merchantRules).toMatch(/45/);
    expect(result.merchantRules).toMatch(/Net 30|payment/i);
  });
});
