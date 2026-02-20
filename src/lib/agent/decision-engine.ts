import type {
  AgentAction,
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
 * Final decision logic after policy evaluation. Applies guardrails:
 * escalation triggers always override to escalate.
 */
export function makeDecision(input: DecisionInput): DecisionOutput {
  const { policyEvaluation } = input;

  // No policy evaluation = pre-policy escalation
  if (!policyEvaluation) {
    return {
      action: "escalate",
      reasoning: "Escalated before policy evaluation could run",
    };
  }

  // Escalation trigger fires → always escalate, regardless of recommended action
  if (policyEvaluation.escalationTriggered) {
    return {
      action: "escalate",
      reasoning: policyEvaluation.escalationReason
        ? `Escalation trigger: ${policyEvaluation.escalationReason}`
        : `Escalation trigger fired during policy evaluation: ${policyEvaluation.reasoning}`,
    };
  }

  // Otherwise, trust the LLM's recommended action
  return {
    action: policyEvaluation.recommendedAction,
    reasoning: policyEvaluation.reasoning,
  };
}
