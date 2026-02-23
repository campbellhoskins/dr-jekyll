import {
  buildInitialEmailPrompt,
  buildRulesGenerationPrompt,
  buildAgentPrompt,
} from "@/lib/agent/prompts";
import { buildTestOrderInformation } from "../../helpers/order-information";

const sampleOrderInformation = buildTestOrderInformation({
  product: { productName: "Bamboo Cutting Board", supplierProductCode: "BCB-001", merchantSKU: "BCB-001" },
  pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00, lastKnownPrice: 4.25 },
  quantity: { targetQuantity: 500 },
  escalation: { additionalTriggers: ["Escalate if MOQ exceeds 1000 units"] },
});

describe("buildInitialEmailPrompt", () => {
  it("includes product and quantity in user message", () => {
    const prompt = buildInitialEmailPrompt(sampleOrderInformation);
    expect(prompt.userMessage).toContain("Bamboo Cutting Board");
    expect(prompt.userMessage).toContain("500");
  });

  it("uses structured output schema", () => {
    const prompt = buildInitialEmailPrompt(sampleOrderInformation);
    expect(prompt.outputSchema).toBeDefined();
    expect(prompt.outputSchema!.name).toBe("generate_initial_email");
  });

  it("sets temperature=0 and maxTokens=1024", () => {
    const prompt = buildInitialEmailPrompt(sampleOrderInformation);
    expect(prompt.temperature).toBe(0);
    expect(prompt.maxTokens).toBe(1024);
  });
});

describe("buildRulesGenerationPrompt", () => {
  it("includes OrderInformation as JSON in user message", () => {
    const prompt = buildRulesGenerationPrompt(sampleOrderInformation);
    expect(prompt.userMessage).toContain("Bamboo Cutting Board");
    expect(prompt.userMessage).toContain("BCB-001");
    expect(prompt.userMessage).toContain("4");
    expect(prompt.userMessage).toContain("500");
  });

  it("system prompt describes ORDER_CONTEXT and MERCHANT_RULES outputs", () => {
    const prompt = buildRulesGenerationPrompt(sampleOrderInformation);
    expect(prompt.systemPrompt).toContain("ORDER_CONTEXT");
    expect(prompt.systemPrompt).toContain("MERCHANT_RULES");
    expect(prompt.systemPrompt).toContain("<order_context>");
    expect(prompt.systemPrompt).toContain("<merchant_rules>");
  });

  it("system prompt includes all rule categories", () => {
    const prompt = buildRulesGenerationPrompt(sampleOrderInformation);
    expect(prompt.systemPrompt).toContain("PRICING RULES");
    expect(prompt.systemPrompt).toContain("QUANTITY RULES");
    expect(prompt.systemPrompt).toContain("LEAD TIME RULES");
    expect(prompt.systemPrompt).toContain("PAYMENT TERMS RULES");
    expect(prompt.systemPrompt).toContain("ESCALATION RULES");
  });

  it("does not use structured output schema (free text)", () => {
    const prompt = buildRulesGenerationPrompt(sampleOrderInformation);
    expect(prompt.outputSchema).toBeUndefined();
  });

  it("sets temperature=0 and maxTokens=4096", () => {
    const prompt = buildRulesGenerationPrompt(sampleOrderInformation);
    expect(prompt.temperature).toBe(0);
    expect(prompt.maxTokens).toBe(4096);
  });
});

describe("buildAgentPrompt", () => {
  const orderContext = "MERCHANT: Test Merchant\nPRODUCT: Bamboo Cutting Board";
  const merchantRules = "PRICING RULES:\n- Target price $4.00";
  const supplierMessage = "Price is $4.50 per unit, MOQ 500.";
  const conversationHistory = "[AGENT] Initial inquiry\n[SUPPLIER] Here is our quote...";

  it("injects all four inputs into the prompt", () => {
    const prompt = buildAgentPrompt(conversationHistory, orderContext, merchantRules, supplierMessage);
    expect(prompt.userMessage).toContain(conversationHistory);
    expect(prompt.userMessage).toContain(orderContext);
    expect(prompt.userMessage).toContain(merchantRules);
    expect(prompt.userMessage).toContain(supplierMessage);
  });

  it("includes systematic evaluation instructions", () => {
    const prompt = buildAgentPrompt(conversationHistory, orderContext, merchantRules, supplierMessage);
    expect(prompt.userMessage).toContain("<systematic_evaluation>");
    expect(prompt.userMessage).toContain("<decision>");
    expect(prompt.userMessage).toContain("<response>");
  });

  it("includes all three possible actions", () => {
    const prompt = buildAgentPrompt(conversationHistory, orderContext, merchantRules, supplierMessage);
    expect(prompt.userMessage).toContain("ACCEPT");
    expect(prompt.userMessage).toContain("COUNTER");
    expect(prompt.userMessage).toContain("ESCALATE");
  });

  it("does not use structured output schema (free text with XML tags)", () => {
    const prompt = buildAgentPrompt(conversationHistory, orderContext, merchantRules, supplierMessage);
    expect(prompt.outputSchema).toBeUndefined();
  });

  it("sets temperature=0 and maxTokens=8192", () => {
    const prompt = buildAgentPrompt(conversationHistory, orderContext, merchantRules, supplierMessage);
    expect(prompt.temperature).toBe(0);
    expect(prompt.maxTokens).toBe(8192);
  });

  it("handles empty conversation history", () => {
    const prompt = buildAgentPrompt("", orderContext, merchantRules, supplierMessage);
    expect(prompt.userMessage).toContain("No prior messages.");
  });
});
