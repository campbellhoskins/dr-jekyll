import type { LLMService } from "../../llm/service";
import type { ExtractedQuoteData } from "../types";
import { Extractor } from "../extractor";
import type {
  ExpertOpinion,
  ExtractionAnalysis,
  ExtractionExpertInput,
} from "./types";

/**
 * Extraction Expert — wraps the existing Extractor in the Expert interface.
 * Receives ONLY raw data (supplier message, conversation history, prior data).
 * Does NOT see merchant rules, triggers, or pricing targets.
 */
export class ExtractionExpert {
  readonly name = "extraction" as const;
  private extractor: Extractor;

  constructor(llmService: LLMService) {
    this.extractor = new Extractor(llmService);
  }

  async analyze(input: ExtractionExpertInput): Promise<ExpertOpinion> {
    const priorDataStr = input.priorExtractedData
      ? formatPriorDataForPrompt(input.priorExtractedData)
      : undefined;

    const extraction = await this.extractor.extract(
      input.supplierMessage,
      input.conversationHistory,
      priorDataStr
    );

    const analysis: ExtractionAnalysis = {
      type: "extraction",
      extractedData: extraction.data,
      confidence: extraction.confidence,
      notes: extraction.notes,
      success: extraction.success,
      error: extraction.error,
    };

    return {
      expertName: this.name,
      analysis,
      provider: extraction.provider,
      model: extraction.model,
      latencyMs: extraction.latencyMs,
      inputTokens: extraction.inputTokens,
      outputTokens: extraction.outputTokens,
    };
  }
}

function formatPriorDataForPrompt(data: Partial<ExtractedQuoteData>): string {
  const lines: string[] = [];
  if (data.quotedPrice !== undefined && data.quotedPrice !== null)
    lines.push(`Price: ${data.quotedPrice} ${data.quotedPriceCurrency ?? "USD"}`);
  if (data.availableQuantity !== undefined && data.availableQuantity !== null)
    lines.push(`Quantity: ${data.availableQuantity}`);
  if (data.moq !== undefined && data.moq !== null)
    lines.push(`MOQ: ${data.moq}`);
  if (data.leadTimeMinDays !== undefined && data.leadTimeMinDays !== null) {
    const lt =
      data.leadTimeMaxDays && data.leadTimeMaxDays !== data.leadTimeMinDays
        ? `${data.leadTimeMinDays}-${data.leadTimeMaxDays} days`
        : `${data.leadTimeMinDays} days`;
    lines.push(`Lead Time: ${lt}`);
  }
  if (data.paymentTerms) lines.push(`Payment: ${data.paymentTerms}`);
  if (data.validityPeriod) lines.push(`Validity: ${data.validityPeriod}`);
  return lines.length > 0 ? lines.join("\n") : "No prior data.";
}
