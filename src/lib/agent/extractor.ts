import type { LLMService } from "../llm/service";
import type { ExtractionResult } from "./types";
import { parseExtractionOutput } from "./output-parser";
import { buildExtractionPrompt } from "./prompts";

// Hardcoded exchange rates for B1 (real API integration in B4)
const USD_RATES: Record<string, number> = {
  USD: 1,
  CNY: 0.14,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  KRW: 0.00074,
  INR: 0.012,
  THB: 0.028,
  VND: 0.000041,
  TWD: 0.031,
};

function convertToUsd(
  price: number | null,
  currency: string
): number | null {
  if (price === null) return null;
  const rate = USD_RATES[currency];
  if (rate === undefined) return null;
  return Math.round(price * rate * 100) / 100; // Round to 2 decimal places
}

export class Extractor {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async extract(emailText: string): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(emailText);

    let llmContent: string;
    let provider: string;
    let model: string;
    let latencyMs: number;
    let inputTokens: number;
    let outputTokens: number;
    let retryCount: number;

    try {
      const llmResult = await this.llmService.call(prompt);
      llmContent = llmResult.response.content;
      provider = llmResult.response.provider;
      model = llmResult.response.model;
      latencyMs = llmResult.response.latencyMs;
      inputTokens = llmResult.response.inputTokens;
      outputTokens = llmResult.response.outputTokens;
      retryCount = llmResult.attempts.length - 1;
    } catch (error) {
      return {
        success: false,
        data: null,
        confidence: 0,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
        provider: "unknown",
        model: "unknown",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        retryCount: 0,
      };
    }

    // Parse the LLM output
    const parsed = parseExtractionOutput(llmContent);

    if (!parsed.success || !parsed.data) {
      return {
        success: false,
        data: null,
        confidence: parsed.confidence,
        notes: parsed.notes,
        error: parsed.error,
        provider,
        model,
        latencyMs,
        inputTokens,
        outputTokens,
        retryCount,
      };
    }

    // Compute USD conversion
    parsed.data.quotedPriceUsd = convertToUsd(
      parsed.data.quotedPrice,
      parsed.data.quotedPriceCurrency
    );

    return {
      success: true,
      data: parsed.data,
      confidence: parsed.confidence,
      notes: parsed.notes,
      error: null,
      provider,
      model,
      latencyMs,
      inputTokens,
      outputTokens,
      retryCount,
    };
  }
}
