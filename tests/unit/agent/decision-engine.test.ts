import {
  checkPrePolicyEscalation,
  makeDecision,
} from "@/lib/agent/decision-engine";
import type {
  ExtractionResult,
  ExtractedQuoteData,
  PolicyEvaluationResult,
} from "@/lib/agent/types";

function buildExtraction(
  overrides: Partial<ExtractionResult> = {}
): ExtractionResult {
  return {
    success: true,
    data: {
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
    },
    confidence: 0.9,
    notes: [],
    error: null,
    provider: "claude",
    model: "claude-3-haiku-20240307",
    latencyMs: 200,
    retryCount: 0,
    ...overrides,
  };
}

function buildPolicyEval(
  overrides: Partial<PolicyEvaluationResult> = {}
): PolicyEvaluationResult {
  return {
    rulesMatched: ["price within range"],
    complianceStatus: "compliant",
    recommendedAction: "accept",
    reasoning: "All rules satisfied",
    escalationTriggered: false,
    provider: "claude",
    model: "claude-3-haiku-20240307",
    latencyMs: 300,
    ...overrides,
  };
}

describe("checkPrePolicyEscalation", () => {
  it("returns escalation when extraction.success is false", () => {
    const extraction = buildExtraction({
      success: false,
      data: null,
      error: "LLM failed",
    });

    const result = checkPrePolicyEscalation(extraction);

    expect(result).not.toBeNull();
    expect(result!.action).toBe("escalate");
    expect(result!.reasoning).toContain("Extraction failed");
  });

  it("returns escalation when confidence < 0.3", () => {
    const extraction = buildExtraction({ confidence: 0.15 });

    const result = checkPrePolicyEscalation(extraction);

    expect(result).not.toBeNull();
    expect(result!.action).toBe("escalate");
    expect(result!.reasoning).toContain("confidence");
  });

  it("returns escalation when notes contain 'discontinued'", () => {
    const extraction = buildExtraction({
      notes: ["Supplier mentioned product discontinuation"],
    });

    const result = checkPrePolicyEscalation(extraction);

    expect(result).not.toBeNull();
    expect(result!.action).toBe("escalate");
    expect(result!.reasoning).toContain("discontinu");
  });

  it("returns escalation when notes contain 'no longer'", () => {
    const extraction = buildExtraction({
      notes: ["Product no longer available"],
    });

    const result = checkPrePolicyEscalation(extraction);

    expect(result).not.toBeNull();
    expect(result!.action).toBe("escalate");
  });

  it("returns null when extraction is healthy", () => {
    const extraction = buildExtraction();

    const result = checkPrePolicyEscalation(extraction);

    expect(result).toBeNull();
  });

  it("returns null for moderate confidence (0.4)", () => {
    const extraction = buildExtraction({ confidence: 0.4 });

    const result = checkPrePolicyEscalation(extraction);

    expect(result).toBeNull();
  });

  it("handles multiple alarming notes", () => {
    const extraction = buildExtraction({
      notes: ["Product discontinued", "No longer manufactured"],
    });

    const result = checkPrePolicyEscalation(extraction);

    expect(result).not.toBeNull();
    expect(result!.action).toBe("escalate");
  });
});

describe("makeDecision", () => {
  it("returns accept when policy says compliant + accept", () => {
    const result = makeDecision({
      extraction: buildExtraction(),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "compliant",
        recommendedAction: "accept",
      }),
    });

    expect(result.action).toBe("accept");
  });

  it("returns counter when policy says non_compliant + counter", () => {
    const result = makeDecision({
      extraction: buildExtraction(),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "non_compliant",
        recommendedAction: "counter",
        reasoning: "Price too high",
      }),
    });

    expect(result.action).toBe("counter");
  });

  it("returns escalate when escalationTriggered is true even if recommendedAction is accept", () => {
    const result = makeDecision({
      extraction: buildExtraction(),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "compliant",
        recommendedAction: "accept",
        escalationTriggered: true,
        escalationReason: "MOQ exceeds limit",
      }),
    });

    expect(result.action).toBe("escalate");
    expect(result.reasoning).toContain("MOQ exceeds limit");
  });

  it("returns escalate when policyEvaluation is null (pre-policy escalation)", () => {
    const result = makeDecision({
      extraction: buildExtraction({ success: false }),
      policyEvaluation: null,
    });

    expect(result.action).toBe("escalate");
  });

  it("returns clarify when policy recommends clarify", () => {
    const result = makeDecision({
      extraction: buildExtraction(),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "partial",
        recommendedAction: "clarify",
        reasoning: "Need more details on payment terms",
      }),
    });

    expect(result.action).toBe("clarify");
  });

  it("returns escalate for partial compliance with escalation trigger", () => {
    const result = makeDecision({
      extraction: buildExtraction(),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "partial",
        recommendedAction: "counter",
        escalationTriggered: true,
        escalationReason: "Lead time exceeds 45 days",
      }),
    });

    expect(result.action).toBe("escalate");
  });

  it("handles empty rulesMatched array", () => {
    const result = makeDecision({
      extraction: buildExtraction(),
      policyEvaluation: buildPolicyEval({
        rulesMatched: [],
        complianceStatus: "compliant",
        recommendedAction: "accept",
      }),
    });

    expect(result.action).toBe("accept");
  });

  it("includes reasoning from policy evaluation", () => {
    const result = makeDecision({
      extraction: buildExtraction(),
      policyEvaluation: buildPolicyEval({
        reasoning: "Price is within acceptable range at $4.50",
      }),
    });

    expect(result.reasoning).toContain("Price is within acceptable range");
  });
});
