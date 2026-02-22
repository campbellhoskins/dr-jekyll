import type {
  AgentAction,
  ExtractedQuoteData,
  ExtractionResult,
  PolicyEvaluationResult,
} from "./types";

export interface PrePolicyEscalation {
  action: "escalate";
  reasoning: string;
}

export interface DecisionInput {
  extraction: ExtractionResult;
  policyEvaluation: PolicyEvaluationResult | null;
  escalationTriggers?: string;
  negotiationRules?: string;
}

export interface DecisionOutput {
  action: AgentAction;
  reasoning: string;
}

// Keywords in extraction notes that signal immediate escalation
const ESCALATION_KEYWORDS = [
  "discontinu",
  "no longer",
  "out of stock",
  "stopped",
  "unavailable",
  "ceased production",
];

/**
 * Deterministic pre-policy checks. Returns an escalation if the extraction
 * itself signals a problem — before we spend an LLM call on policy evaluation.
 */
export function checkPrePolicyEscalation(
  extraction: ExtractionResult
): PrePolicyEscalation | null {
  // Extraction failed entirely
  if (!extraction.success) {
    return {
      action: "escalate",
      reasoning: `Extraction failed: ${extraction.error ?? "unknown error"}`,
    };
  }

  // Confidence too low to evaluate
  if (extraction.confidence < 0.3) {
    return {
      action: "escalate",
      reasoning: `Extraction confidence too low (${extraction.confidence}) to evaluate against policy`,
    };
  }

  // Notes contain alarming keywords
  const notesText = extraction.notes.join(" ").toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (notesText.includes(keyword)) {
      const matchingNote = extraction.notes.find((n) =>
        n.toLowerCase().includes(keyword)
      );
      return {
        action: "escalate",
        reasoning: `Supplier indicated: ${matchingNote ?? keyword}`,
      };
    }
  }

  return null;
}

/**
 * Deterministic escalation trigger checker.
 * Parses common numeric threshold patterns from trigger text and checks
 * extracted data against them. This catches cases the LLM misses.
 */
export function checkDeterministicTriggers(
  data: ExtractedQuoteData,
  triggerText: string
): { triggered: boolean; reason: string } | null {
  if (!triggerText || triggerText.trim() === "") return null;

  const lower = triggerText.toLowerCase();

  // MOQ trigger: "MOQ exceeds N", "MOQ higher than N", "MOQ over N", "MOQ above N"
  const moqMatch = lower.match(
    /moq\s+(?:exceeds?|higher\s+than|over|above|greater\s+than|>)\s*(\d[\d,]*)/
  );
  if (moqMatch && data.moq !== null) {
    const threshold = parseInt(moqMatch[1].replace(/,/g, ""), 10);
    if (data.moq > threshold) {
      return {
        triggered: true,
        reason: `MOQ ${data.moq} exceeds trigger threshold of ${threshold}`,
      };
    }
  }

  // Price trigger: "price exceeds $N", "price higher than $N", "price over $N", "price above $N"
  const priceMatch = lower.match(
    /price\s+(?:exceeds?|higher\s+than|over|above|greater\s+than|>)\s*\$?([\d,.]+)/
  );
  if (priceMatch && data.quotedPriceUsd !== null) {
    const threshold = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (data.quotedPriceUsd > threshold) {
      return {
        triggered: true,
        reason: `Price $${data.quotedPriceUsd} exceeds trigger threshold of $${threshold}`,
      };
    }
  }

  // Lead time trigger: "lead time exceeds N days", "lead time over N"
  const leadTimeMatch = lower.match(
    /lead\s*time\s+(?:exceeds?|higher\s+than|over|above|greater\s+than|>)\s*(\d+)/
  );
  if (leadTimeMatch && data.leadTimeMaxDays !== null) {
    const threshold = parseInt(leadTimeMatch[1], 10);
    if (data.leadTimeMaxDays > threshold) {
      return {
        triggered: true,
        reason: `Lead time ${data.leadTimeMaxDays} days exceeds trigger threshold of ${threshold} days`,
      };
    }
  }

  return null;
}

/**
 * Deterministic negotiation rule checker for price compliance.
 * If the price is outside the acceptable range specified in rules,
 * and the LLM recommended accept, override to counter.
 */
export function checkPriceCompliance(
  data: ExtractedQuoteData,
  rulesText: string
): { shouldCounter: boolean; reason: string } | null {
  if (!rulesText || rulesText.trim() === "" || data.quotedPriceUsd === null) return null;

  const lower = rulesText.toLowerCase();

  // "acceptable range is $X - $Y" or "acceptable range $X-$Y"
  const rangeMatch = lower.match(
    /acceptable\s+(?:range|prices?)\s+(?:is\s+)?\$?([\d,.]+)\s*[-–—to]+\s*\$?([\d,.]+)/
  );
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1].replace(/,/g, ""));
    const max = parseFloat(rangeMatch[2].replace(/,/g, ""));
    if (data.quotedPriceUsd > max) {
      return {
        shouldCounter: true,
        reason: `Price $${data.quotedPriceUsd} exceeds acceptable range max of $${max}`,
      };
    }
  }

  return null;
}

/**
 * Final decision logic after policy evaluation. Applies guardrails:
 * 1. LLM escalation trigger → always escalate
 * 2. Deterministic escalation trigger check → escalate if LLM missed it
 * 3. Deterministic price compliance → counter if LLM wrongly accepted
 * 4. Otherwise trust the LLM
 */
export function makeDecision(input: DecisionInput): DecisionOutput {
  const { extraction, policyEvaluation, escalationTriggers, negotiationRules } = input;

  // No policy evaluation = pre-policy escalation
  if (!policyEvaluation) {
    return {
      action: "escalate",
      reasoning: "Escalated before policy evaluation could run",
    };
  }

  // Guardrail 0: System failures always escalate (LLM errors, unparseable output)
  const isSystemFailure = policyEvaluation.reasoning.includes("failed") ||
    policyEvaluation.reasoning.includes("unparseable");
  if (policyEvaluation.escalationTriggered && isSystemFailure) {
    return {
      action: "escalate",
      reasoning: policyEvaluation.escalationReason
        ? `System failure: ${policyEvaluation.escalationReason}`
        : `System failure: ${policyEvaluation.reasoning}`,
    };
  }

  // Guardrail 1: Deterministic escalation trigger check — authoritative.
  // If we can parse numeric thresholds from the trigger text, those are the
  // source of truth. The LLM's escalationTriggered flag is only trusted
  // when we can't parse the triggers deterministically.
  if (extraction.data && escalationTriggers) {
    const triggerCheck = checkDeterministicTriggers(extraction.data, escalationTriggers);
    if (triggerCheck?.triggered) {
      return {
        action: "escalate",
        reasoning: `Deterministic trigger check: ${triggerCheck.reason}`,
      };
    }
    // Deterministic check ran and found no triggers — trust it over LLM.
  } else if (policyEvaluation.escalationTriggered) {
    // No deterministic triggers parseable — fall back to LLM's judgment
    return {
      action: "escalate",
      reasoning: policyEvaluation.escalationReason
        ? `Escalation trigger: ${policyEvaluation.escalationReason}`
        : `Escalation trigger fired during policy evaluation: ${policyEvaluation.reasoning}`,
    };
  }

  // Guardrail 2: If LLM says escalate but deterministic check found no triggers,
  // downgrade to counter (the LLM is being overly cautious)
  if (
    policyEvaluation.recommendedAction === "escalate" &&
    extraction.data &&
    escalationTriggers
  ) {
    const triggerCheck = checkDeterministicTriggers(extraction.data, escalationTriggers);
    if (!triggerCheck?.triggered) {
      // No deterministic trigger fired — LLM's escalation is a false alarm.
      // Check if price is outside rules → counter, otherwise trust other LLM reasoning
      if (negotiationRules) {
        const priceCheck = checkPriceCompliance(extraction.data, negotiationRules);
        if (priceCheck?.shouldCounter) {
          return {
            action: "counter",
            reasoning: `Deterministic override: no escalation triggers fired. ${priceCheck.reason}`,
          };
        }
      }
      // No price issue either — downgrade escalation to counter as default
      // since the LLM thought something was wrong but no triggers actually fired
      return {
        action: "counter",
        reasoning: `Deterministic override: LLM recommended escalate but no escalation triggers fired. Original reasoning: ${policyEvaluation.reasoning}`,
      };
    }
  }

  // Guardrail 3: If LLM says accept but price is outside rules, override to counter
  if (
    policyEvaluation.recommendedAction === "accept" &&
    extraction.data &&
    negotiationRules
  ) {
    const priceCheck = checkPriceCompliance(extraction.data, negotiationRules);
    if (priceCheck?.shouldCounter) {
      return {
        action: "counter",
        reasoning: `Deterministic price check override: ${priceCheck.reason}`,
      };
    }
  }

  // Otherwise, trust the LLM's recommended action
  return {
    action: policyEvaluation.recommendedAction,
    reasoning: policyEvaluation.reasoning,
  };
}
