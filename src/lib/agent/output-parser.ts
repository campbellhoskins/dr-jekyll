import {
  LLMExtractionOutputSchema,
  LLMPolicyDecisionOutputSchema,
  LLMResponseGenerationOutputSchema,
  normalizeCurrency,
  type ExtractedQuoteData,
  type LLMPolicyDecisionOutput,
  type LLMResponseGenerationOutput,
} from "./types";

export interface ParseResult {
  success: boolean;
  data: ExtractedQuoteData | null;
  confidence: number;
  notes: string[];
  error: string | null;
}

/**
 * Parses raw LLM text output into structured ExtractedQuoteData.
 * Handles: clean JSON, markdown code blocks, leading/trailing text,
 * numeric strings, currency aliases, and missing fields.
 */
export function parseExtractionOutput(raw: string): ParseResult {
  // Step 1: Extract JSON from the raw text
  const jsonString = extractJson(raw);
  if (!jsonString) {
    return {
      success: false,
      data: null,
      confidence: 0,
      notes: [],
      error: "Could not find valid JSON in LLM output",
    };
  }

  // Step 2: Parse the JSON (sanitize unescaped newlines inside strings first)
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sanitizeJsonNewlines(jsonString));
  } catch {
    return {
      success: false,
      data: null,
      confidence: 0,
      notes: [],
      error: `Invalid JSON: ${jsonString.substring(0, 100)}...`,
    };
  }

  // Step 3: Coerce numeric strings before Zod validation
  const coerced = coerceNumericStrings(parsed);

  // Step 4: Validate with Zod schema
  const validation = LLMExtractionOutputSchema.safeParse(coerced);
  if (!validation.success) {
    return {
      success: false,
      data: null,
      confidence: 0,
      notes: [],
      error: `Validation failed: ${JSON.stringify(validation.error.issues)}`,
    };
  }

  const output = validation.data;

  // Step 5: Normalize currency and clamp confidence
  const normalizedCurrency = normalizeCurrency(output.quotedPriceCurrency ?? "USD");
  const clampedConfidence = Math.max(0, Math.min(1, output.confidence));

  // Step 6: Build ExtractedQuoteData (quotedPriceUsd is set later by extractor)
  const data: ExtractedQuoteData = {
    quotedPrice: output.quotedPrice,
    quotedPriceCurrency: normalizedCurrency,
    quotedPriceUsd: null, // Computed by extractor after parsing
    availableQuantity: output.availableQuantity,
    moq: output.moq,
    leadTimeMinDays: output.leadTimeMinDays,
    leadTimeMaxDays: output.leadTimeMaxDays,
    paymentTerms: output.paymentTerms,
    validityPeriod: output.validityPeriod,
    rawExtractionJson: parsed, // Preserve original parsed JSON including extra fields
  };

  return {
    success: true,
    data,
    confidence: clampedConfidence,
    notes: output.notes,
    error: null,
  };
}

/**
 * Extracts JSON from raw LLM output. Handles:
 * - Clean JSON (starts with {)
 * - Markdown code blocks (```json ... ```)
 * - JSON embedded in prose text
 */
export function extractJson(raw: string): string | null {
  const trimmed = raw.trim();

  // Try 1: It's already clean JSON
  if (trimmed.startsWith("{")) {
    // Find the matching closing brace
    const end = findClosingBrace(trimmed, 0);
    if (end !== -1) return trimmed.substring(0, end + 1);
  }

  // Try 2: Markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  // Try 3: Find first { and last matching }
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace !== -1) {
    const end = findClosingBrace(trimmed, firstBrace);
    if (end !== -1) return trimmed.substring(firstBrace, end + 1);
  }

  return null;
}

/**
 * Finds the matching closing brace for an opening brace at position `start`.
 */
function findClosingBrace(str: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Sanitizes unescaped newlines inside JSON string values.
 * LLMs (especially Haiku) sometimes output literal newlines inside
 * JSON strings instead of \n escapes, which breaks JSON.parse.
 */
function sanitizeJsonNewlines(json: string): string {
  // Replace literal newlines that appear inside JSON string values with \n
  // Strategy: walk through the string, track whether we're inside a quoted string,
  // and replace raw newlines inside strings with \n
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escape) {
      result += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && (char === "\n" || char === "\r")) {
      result += "\\n";
      // Skip \r\n as a pair
      if (char === "\r" && i + 1 < json.length && json[i + 1] === "\n") {
        i++;
      }
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Coerces string values that look like numbers into actual numbers,
 * and rounds integer fields since LLMs sometimes return floats.
 */
function coerceNumericStrings(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const numericFields = [
    "quotedPrice",
    "moq",
    "leadTimeMinDays",
    "leadTimeMaxDays",
    "availableQuantity",
    "confidence",
  ];
  const integerFields = ["moq", "leadTimeMinDays", "leadTimeMaxDays", "availableQuantity"];
  const result = { ...obj };

  for (const field of numericFields) {
    if (typeof result[field] === "string") {
      const str = (result[field] as string).trim();
      if (str === "" || str.toLowerCase() === "null" || str.toLowerCase() === "n/a") {
        result[field] = null;
      } else {
        const parsed = Number(str);
        if (!isNaN(parsed)) {
          result[field] = parsed;
        } else {
          // Non-numeric string for a numeric field → null
          result[field] = null;
        }
      }
    }
    if (integerFields.includes(field) && typeof result[field] === "number") {
      result[field] = Math.round(result[field] as number);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1.5: Policy Decision Output Parser
// ═══════════════════════════════════════════════════════════════════════════════

export interface PolicyDecisionParseResult {
  success: boolean;
  data: LLMPolicyDecisionOutput | null;
  error: string | null;
}

export function parsePolicyDecisionOutput(
  raw: string
): PolicyDecisionParseResult {
  const jsonString = extractJson(raw);
  if (!jsonString) {
    return { success: false, data: null, error: "Could not find valid JSON in LLM output" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sanitizeJsonNewlines(jsonString));
  } catch {
    return { success: false, data: null, error: `Invalid JSON: ${jsonString.substring(0, 100)}...` };
  }

  const validation = LLMPolicyDecisionOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      success: false,
      data: null,
      error: `Validation failed: ${JSON.stringify(validation.error.issues)}`,
    };
  }

  return { success: true, data: validation.data, error: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1.5: Response Generation Output Parser
// ═══════════════════════════════════════════════════════════════════════════════

export interface ResponseGenerationParseResult {
  success: boolean;
  data: LLMResponseGenerationOutput | null;
  error: string | null;
}

export function parseResponseGenerationOutput(
  raw: string
): ResponseGenerationParseResult {
  const jsonString = extractJson(raw);
  if (!jsonString) {
    return { success: false, data: null, error: "Could not find valid JSON in LLM output" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sanitizeJsonNewlines(jsonString));
  } catch {
    return { success: false, data: null, error: `Invalid JSON: ${jsonString.substring(0, 100)}...` };
  }

  const validation = LLMResponseGenerationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      success: false,
      data: null,
      error: `Validation failed: ${JSON.stringify(validation.error.issues)}`,
    };
  }

  return { success: true, data: validation.data, error: null };
}
