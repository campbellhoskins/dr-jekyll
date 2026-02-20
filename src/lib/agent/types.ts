import { z } from "zod/v4";

// ─── Currency normalization ───────────────────────────────────────────────────
// Maps common aliases to ISO 4217 codes
const CURRENCY_ALIASES: Record<string, string> = {
  RMB: "CNY",
  YUAN: "CNY",
  "¥": "CNY",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
};

export function normalizeCurrency(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return CURRENCY_ALIASES[upper] ?? upper;
}

// ─── Zod schema for LLM extraction output ─────────────────────────────────────
// This is what we ask the LLM to return. It may include extra fields like
// confidence and notes that live in ExtractionResult, not ExtractedQuoteData.
export const LLMExtractionOutputSchema = z.object({
  quotedPrice: z.union([z.number(), z.null()]).optional().default(null),
  quotedPriceCurrency: z.union([z.string(), z.null()]).optional().default("USD"),
  availableQuantity: z.union([z.number().int(), z.null()]).optional().default(null),
  moq: z.union([z.number().int(), z.null()]).optional().default(null),
  leadTimeMinDays: z.union([z.number().int(), z.null()]).optional().default(null),
  leadTimeMaxDays: z.union([z.number().int(), z.null()]).optional().default(null),
  paymentTerms: z.union([z.string(), z.null()]).optional().default(null),
  validityPeriod: z.union([z.string(), z.null()]).optional().default(null),
  confidence: z.number().optional().default(0.5),
  notes: z.array(z.string()).optional().default([]),
});

export type LLMExtractionOutput = z.infer<typeof LLMExtractionOutputSchema>;

// ─── ExtractedQuoteData — mirrors PRODUCT_SPEC Section 3.11 ───────────────────
// Field names match the spec exactly. DB-only fields (id, messageId, orderId,
// createdAt) are omitted — they're added when persistence comes in B3.
export interface ExtractedQuoteData {
  quotedPrice: number | null;
  quotedPriceCurrency: string;
  quotedPriceUsd: number | null;
  availableQuantity: number | null;
  moq: number | null;
  leadTimeMinDays: number | null;
  leadTimeMaxDays: number | null;
  paymentTerms: string | null;
  validityPeriod: string | null;
  rawExtractionJson: Record<string, unknown>;
}

// ─── ExtractionResult — wrapper with metadata ─────────────────────────────────
export interface ExtractionResult {
  success: boolean;
  data: ExtractedQuoteData | null;
  confidence: number;
  notes: string[];
  error: string | null;
  provider: string;
  model: string;
  latencyMs: number;
  retryCount: number;
}
