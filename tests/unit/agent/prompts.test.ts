import {
  buildExtractionPrompt,
  buildPolicyDecisionPrompt,
  buildCounterOfferPrompt,
  buildClarificationPrompt,
} from "@/lib/agent/prompts";
import type { ExtractedQuoteData, OrderContext } from "@/lib/agent/types";

describe("buildExtractionPrompt", () => {
  const emailText = "Hi, our price is $4.50 per unit for 500 pieces.";

  it("includes email text in user message", () => {
    const prompt = buildExtractionPrompt(emailText);

    expect(prompt.userMessage).toContain(emailText);
  });

  it("system prompt requests JSON output", () => {
    const prompt = buildExtractionPrompt(emailText);

    expect(prompt.systemPrompt).toMatch(/json/i);
  });

  it("system prompt defines all expected fields", () => {
    const prompt = buildExtractionPrompt(emailText);
    const sys = prompt.systemPrompt;

    expect(sys).toContain("quotedPrice");
    expect(sys).toContain("quotedPriceCurrency");
    expect(sys).toContain("availableQuantity");
    expect(sys).toContain("moq");
    expect(sys).toContain("leadTimeMinDays");
    expect(sys).toContain("leadTimeMaxDays");
    expect(sys).toContain("paymentTerms");
    expect(sys).toContain("validityPeriod");
  });

  it("system prompt includes confidence guidance", () => {
    const prompt = buildExtractionPrompt(emailText);
    const sys = prompt.systemPrompt;

    expect(sys).toMatch(/confidence/i);
    expect(sys).toMatch(/high|low|0|1/i);
  });
});

const sampleExtractedData: ExtractedQuoteData = {
  quotedPrice: 4.5,
  quotedPriceCurrency: "USD",
  quotedPriceUsd: 4.5,
  availableQuantity: null,
  moq: 500,
  leadTimeMinDays: 25,
  leadTimeMaxDays: 30,
  paymentTerms: "30% deposit",
  validityPeriod: null,
  rawExtractionJson: {},
};

const sampleOrderContext: OrderContext = {
  skuName: "Bamboo Cutting Board",
  supplierSku: "BCB-001",
  quantityRequested: "500",
  lastKnownPrice: 4.25,
};

describe("buildPolicyDecisionPrompt", () => {
  it("includes extracted data in user message", () => {
    const prompt = buildPolicyDecisionPrompt(
      sampleExtractedData,
      "Accept below $5",
      "Escalate if MOQ > 1000",
      sampleOrderContext
    );
    expect(prompt.userMessage).toContain("4.5");
    expect(prompt.userMessage).toContain("USD");
  });

  it("includes negotiation rules in user message", () => {
    const prompt = buildPolicyDecisionPrompt(
      sampleExtractedData,
      "Accept below $5 per unit",
      "Escalate if MOQ > 1000",
      sampleOrderContext
    );
    expect(prompt.userMessage).toContain("Accept below $5 per unit");
  });

  it("includes escalation triggers in user message", () => {
    const prompt = buildPolicyDecisionPrompt(
      sampleExtractedData,
      "Accept below $5",
      "Escalate if MOQ exceeds 1000",
      sampleOrderContext
    );
    expect(prompt.userMessage).toContain("Escalate if MOQ exceeds 1000");
  });
});

describe("buildCounterOfferPrompt", () => {
  it("includes counter terms and order context", () => {
    const prompt = buildCounterOfferPrompt(
      sampleExtractedData,
      "Price too high, target is $3.80",
      { targetPrice: 3.8 },
      sampleOrderContext
    );
    expect(prompt.userMessage).toContain("3.8");
    expect(prompt.userMessage).toContain("Bamboo Cutting Board");
  });
});

describe("buildClarificationPrompt", () => {
  it("includes extraction notes and order context", () => {
    const prompt = buildClarificationPrompt(
      sampleExtractedData,
      ["Supplier asked for specifications"],
      sampleOrderContext
    );
    expect(prompt.userMessage).toContain("specifications");
    expect(prompt.userMessage).toContain("Bamboo Cutting Board");
  });
});

describe("all new prompts", () => {
  it("set temperature=0 and maxTokens=1024", () => {
    const p1 = buildPolicyDecisionPrompt(sampleExtractedData, "rules", "triggers", sampleOrderContext);
    const p2 = buildCounterOfferPrompt(sampleExtractedData, "reason", {}, sampleOrderContext);
    const p3 = buildClarificationPrompt(sampleExtractedData, [], sampleOrderContext);

    for (const p of [p1, p2, p3]) {
      expect(p.temperature).toBe(0);
      expect(p.maxTokens).toBeGreaterThanOrEqual(1024);
    }
  });
});
