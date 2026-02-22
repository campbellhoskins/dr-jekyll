import {
  checkPrePolicyEscalation,
  checkDeterministicTriggers,
  checkPriceCompliance,
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

  it("deterministic MOQ trigger catches what LLM missed", () => {
    const result = makeDecision({
      extraction: buildExtraction({
        data: { ...buildExtraction().data!, moq: 2000 },
      }),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "compliant",
        recommendedAction: "accept",
        escalationTriggered: false,
      }),
      escalationTriggers: "Escalate if MOQ exceeds 1000 units.",
    });

    expect(result.action).toBe("escalate");
    expect(result.reasoning).toContain("MOQ 2000 exceeds");
  });

  it("deterministic price trigger catches what LLM missed", () => {
    const result = makeDecision({
      extraction: buildExtraction({
        data: { ...buildExtraction().data!, quotedPriceUsd: 6.0 },
      }),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "compliant",
        recommendedAction: "accept",
        escalationTriggered: false,
      }),
      escalationTriggers: "Escalate if price exceeds $5.50 per unit.",
    });

    expect(result.action).toBe("escalate");
    expect(result.reasoning).toContain("Price $6 exceeds");
  });

  it("deterministic price compliance overrides LLM accept to counter", () => {
    const result = makeDecision({
      extraction: buildExtraction({
        data: { ...buildExtraction().data!, quotedPriceUsd: 4.8 },
      }),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "compliant",
        recommendedAction: "accept",
        escalationTriggered: false,
      }),
      negotiationRules: "Acceptable range is $3.50 - $4.20 per unit.",
    });

    expect(result.action).toBe("counter");
    expect(result.reasoning).toContain("exceeds acceptable range");
  });

  it("does not override when price is within range", () => {
    const result = makeDecision({
      extraction: buildExtraction({
        data: { ...buildExtraction().data!, quotedPriceUsd: 4.0 },
      }),
      policyEvaluation: buildPolicyEval({
        complianceStatus: "compliant",
        recommendedAction: "accept",
        escalationTriggered: false,
      }),
      negotiationRules: "Acceptable range is $3.50 - $4.20 per unit.",
    });

    expect(result.action).toBe("accept");
  });
});

describe("checkDeterministicTriggers", () => {
  const baseData = buildExtraction().data!;

  it("detects MOQ exceeding threshold", () => {
    const result = checkDeterministicTriggers(
      { ...baseData, moq: 2000 },
      "Escalate if MOQ exceeds 1000 units"
    );
    expect(result?.triggered).toBe(true);
  });

  it("does not trigger when MOQ is within threshold", () => {
    const result = checkDeterministicTriggers(
      { ...baseData, moq: 500 },
      "Escalate if MOQ exceeds 1000 units"
    );
    expect(result).toBeNull();
  });

  it("detects price exceeding threshold", () => {
    const result = checkDeterministicTriggers(
      { ...baseData, quotedPriceUsd: 6.0 },
      "Escalate if price exceeds $5.50"
    );
    expect(result?.triggered).toBe(true);
  });

  it("detects lead time exceeding threshold", () => {
    const result = checkDeterministicTriggers(
      { ...baseData, leadTimeMaxDays: 50 },
      "Escalate if lead time exceeds 45 days"
    );
    expect(result?.triggered).toBe(true);
  });

  it("returns null when no triggers match", () => {
    const result = checkDeterministicTriggers(
      baseData,
      "Escalate if supplier mentions discontinuation"
    );
    expect(result).toBeNull();
  });

  it("returns null for empty trigger text", () => {
    const result = checkDeterministicTriggers(baseData, "");
    expect(result).toBeNull();
  });
});

describe("checkPriceCompliance", () => {
  const baseData = buildExtraction().data!;

  it("detects price above acceptable range", () => {
    const result = checkPriceCompliance(
      { ...baseData, quotedPriceUsd: 4.8 },
      "Acceptable range is $3.50 - $4.20"
    );
    expect(result?.shouldCounter).toBe(true);
  });

  it("returns null when price is within range", () => {
    const result = checkPriceCompliance(
      { ...baseData, quotedPriceUsd: 4.0 },
      "Acceptable range is $3.50 - $4.20"
    );
    expect(result).toBeNull();
  });

  it("returns null when no range specified in rules", () => {
    const result = checkPriceCompliance(
      { ...baseData, quotedPriceUsd: 10 },
      "Accept if price is reasonable"
    );
    expect(result).toBeNull();
  });
});
