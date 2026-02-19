import { buildExtractionPrompt } from "@/lib/agent/prompts";

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
    expect(sys).toContain("leadTimeDays");
    expect(sys).toContain("paymentTerms");
    expect(sys).toContain("validityPeriod");
  });

  it("system prompt includes confidence guidance", () => {
    const prompt = buildExtractionPrompt(emailText);
    const sys = prompt.systemPrompt;

    expect(sys).toMatch(/confidence/i);
    // Should explain when confidence should be high vs low
    expect(sys).toMatch(/high|low|0|1/i);
  });
});
