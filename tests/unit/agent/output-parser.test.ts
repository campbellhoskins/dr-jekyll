import { parseExtractionOutput } from "@/lib/agent/output-parser";

describe("parseExtractionOutput", () => {
  it("parses clean JSON response", () => {
    const input = JSON.stringify({
      quotedPrice: 4.5,
      quotedPriceCurrency: "USD",
      availableQuantity: null,
      moq: 500,
      leadTimeDays: 25,
      paymentTerms: "30% deposit",
      validityPeriod: null,
      confidence: 0.95,
      notes: [],
    });

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBe(4.5);
    expect(result.data!.quotedPriceCurrency).toBe("USD");
    expect(result.data!.moq).toBe(500);
    expect(result.confidence).toBe(0.95);
  });

  it("parses JSON wrapped in markdown code block", () => {
    const input = '```json\n{"quotedPrice": 8.5, "quotedPriceCurrency": "CNY", "confidence": 0.8, "notes": []}\n```';

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBe(8.5);
    expect(result.data!.quotedPriceCurrency).toBe("CNY");
  });

  it("parses JSON with leading/trailing text", () => {
    const input =
      'Here is the extraction:\n{"quotedPrice": 12.80, "quotedPriceCurrency": "USD", "confidence": 0.7, "notes": ["partial info"]}\nLet me know if you need more.';

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBe(12.8);
    expect(result.notes).toEqual(["partial info"]);
  });

  it("handles null fields correctly", () => {
    const input = JSON.stringify({
      quotedPrice: null,
      quotedPriceCurrency: "USD",
      availableQuantity: null,
      moq: null,
      leadTimeDays: null,
      paymentTerms: null,
      validityPeriod: null,
      confidence: 0.2,
      notes: ["no data found"],
    });

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBeNull();
    expect(result.data!.availableQuantity).toBeNull();
    expect(result.data!.moq).toBeNull();
    expect(result.data!.leadTimeDays).toBeNull();
    expect(result.data!.paymentTerms).toBeNull();
    expect(result.data!.validityPeriod).toBeNull();
  });

  it("validates required fields via Zod — defaults quotedPriceCurrency to USD", () => {
    // Missing quotedPriceCurrency should default to "USD"
    const input = JSON.stringify({
      quotedPrice: 5.0,
      confidence: 0.9,
      notes: [],
    });

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPriceCurrency).toBe("USD");
  });

  it("rejects completely invalid JSON", () => {
    const input = "Sorry, I cannot extract any structured data from this email.";

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.data).toBeNull();
  });

  it("handles numeric strings", () => {
    const input = JSON.stringify({
      quotedPrice: "4.50",
      quotedPriceCurrency: "USD",
      moq: "500",
      confidence: "0.9",
      notes: [],
    });

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBe(4.5);
    expect(result.data!.moq).toBe(500);
    expect(result.confidence).toBe(0.9);
  });

  it("normalizes currency codes", () => {
    const input = JSON.stringify({
      quotedPrice: 8.5,
      quotedPriceCurrency: "RMB",
      confidence: 0.8,
      notes: [],
    });

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPriceCurrency).toBe("CNY");
  });

  it("clamps confidence to 0-1 range", () => {
    const input = JSON.stringify({
      quotedPrice: 10,
      quotedPriceCurrency: "USD",
      confidence: 1.5,
      notes: [],
    });

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.confidence).toBe(1.0);

    // Also test below zero
    const input2 = JSON.stringify({
      quotedPrice: 10,
      quotedPriceCurrency: "USD",
      confidence: -0.5,
      notes: [],
    });

    const result2 = parseExtractionOutput(input2);

    expect(result2.success).toBe(true);
    expect(result2.confidence).toBe(0);
  });

  it("populates rawExtractionJson", () => {
    const raw = {
      quotedPrice: 4.5,
      quotedPriceCurrency: "USD",
      moq: 500,
      confidence: 0.95,
      notes: [],
      someExtraField: "preserved",
    };
    const input = JSON.stringify(raw);

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.rawExtractionJson).toBeDefined();
    expect(result.data!.rawExtractionJson.quotedPrice).toBe(4.5);
    expect(result.data!.rawExtractionJson.someExtraField).toBe("preserved");
  });

  it("defaults quotedPriceCurrency to USD when not provided", () => {
    const input = JSON.stringify({
      quotedPrice: 3.2,
      confidence: 0.7,
      notes: [],
    });

    const result = parseExtractionOutput(input);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPriceCurrency).toBe("USD");
  });
});
