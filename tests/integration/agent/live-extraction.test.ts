import * as fs from "fs";
import * as path from "path";
import { LLMService } from "@/lib/llm/service";
import { ClaudeProvider } from "@/lib/llm/providers/claude";
import { Extractor } from "@/lib/agent/extractor";

const FIXTURES_DIR = path.resolve(
  __dirname,
  "../../fixtures/supplier-emails"
);

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8").trim();
}

// Skip all tests if no API key
const apiKey = process.env.ANTHROPIC_API_KEY;
const describeOrSkip = apiKey ? describe : describe.skip;

describeOrSkip("Live extraction tests", () => {
  let extractor: Extractor;

  beforeAll(() => {
    const provider = new ClaudeProvider(
      apiKey!,
      process.env.LLM_PRIMARY_MODEL ?? "claude-3-haiku-20240307"
    );
    const service = new LLMService({
      primaryProvider: provider,
      maxRetriesPerProvider: 3,
      retryDelayMs: 1000,
    });
    extractor = new Extractor(service);
  });

  it("extracts simple quote accurately", async () => {
    const email = loadFixture("simple-quote.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBeCloseTo(4.5, 1);
    expect(result.data!.quotedPriceCurrency).toBe("USD");
    expect(result.data!.quotedPriceUsd).toBeCloseTo(4.5, 1);
    expect(result.data!.moq).toBe(500);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("handles multi-currency (CNY)", async () => {
    const email = loadFixture("multi-currency.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPriceCurrency).toBe("CNY");
    expect(result.data!.quotedPrice).toBeCloseTo(8.5, 1);
    expect(result.data!.quotedPriceUsd).not.toBeNull();
    expect(result.data!.quotedPriceUsd!).toBeGreaterThan(0);
    expect(result.data!.moq).toBe(1000);
  });

  it("recognizes ambiguous response", async () => {
    const email = loadFixture("ambiguous-response.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBeNull();
    expect(result.confidence).toBeLessThan(0.4);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("extracts partial information", async () => {
    const email = loadFixture("partial-info.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBeCloseTo(12.8, 1);
    expect(result.data!.quotedPriceCurrency).toBe("USD");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it("extracts counter-offer data", async () => {
    const email = loadFixture("counter-offer.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBeCloseTo(4.2, 1);
    expect(result.data!.availableQuantity).toBe(300);
    expect(result.data!.leadTimeMinDays).toBe(45);
    expect(result.data!.leadTimeMaxDays).toBe(45);
  });

  it("recognizes rejection/discontinuation", async () => {
    const email = loadFixture("rejection.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBeNull();
    // Notes should mention discontinuation
    const notesText = result.notes.join(" ").toLowerCase();
    expect(notesText).toMatch(/discontinu|no longer|stopped/);
  });

  it("handles tiered pricing", async () => {
    const email = loadFixture("moq-constraint.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    // Should extract at least one price tier
    expect(result.data!.quotedPrice).not.toBeNull();
    // Notes should mention tiered pricing
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("handles no-data conversational email", async () => {
    const email = loadFixture("conversational-no-numbers.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    expect(result.data!.quotedPrice).toBeNull();
    expect(result.confidence).toBeLessThan(0.4);
  });

  it("handles multi-item quote", async () => {
    const email = loadFixture("multi-item-quote.txt");
    const result = await extractor.extract(email);

    expect(result.success).toBe(true);
    // Should extract at least the first item's price
    expect(result.data).not.toBeNull();
    expect(result.data!.quotedPrice).not.toBeNull();
  });
});
