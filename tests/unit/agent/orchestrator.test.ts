import { Orchestrator } from "@/lib/agent/orchestrator";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { LLMRequest } from "@/lib/llm/types";
import { buildTestOrderInformation } from "../../helpers/order-information";

/**
 * Routing mock: inspects outputSchema.name to return the correct response.
 * This supports parallel expert calls (extraction + escalation run via Promise.all).
 */
function createRoutingMockLLMService(
  responses: Record<string, string | Error>
): LLMService {
  return {
    call: jest.fn(async (req: LLMRequest): Promise<LLMServiceResult> => {
      const schemaName = req.outputSchema?.name ?? "unknown";
      const resp = responses[schemaName];
      if (!resp) throw new Error(`No mock response for schema: ${schemaName}`);
      if (resp instanceof Error) throw resp;
      return {
        response: {
          content: resp,
          provider: "claude",
          model: "claude-3-haiku-20240307",
          inputTokens: 200,
          outputTokens: 100,
          latencyMs: 150,
        },
        attempts: [{ provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 150, success: true }],
      };
    }),
  } as unknown as LLMService;
}

const orderInformation = buildTestOrderInformation({
  product: { productName: "Bamboo Cutting Board", supplierProductCode: "BCB-001", merchantSKU: "BCB-001" },
  pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00, lastKnownPrice: 4.25 },
  quantity: { targetQuantity: 500 },
  escalation: { additionalTriggers: ["Escalate if MOQ exceeds 1000 units"] },
});

// ─── Mock responses ──────────────────────────────────────────────────────────

const GOOD_EXTRACTION = JSON.stringify({
  quotedPrice: 4.5,
  quotedPriceCurrency: "USD",
  moq: 500,
  leadTimeMinDays: 25,
  leadTimeMaxDays: 30,
  paymentTerms: "30% deposit",
  confidence: 0.95,
  notes: [],
});

const NO_ESCALATION = JSON.stringify({
  shouldEscalate: false,
  reasoning: "MOQ 500 is within threshold.",
  triggersEvaluated: ["MOQ exceeds 1000"],
  triggeredTriggers: [],
  severity: "low",
});

const ESCALATION_TRIGGERED = JSON.stringify({
  shouldEscalate: true,
  reasoning: "MOQ 2000 exceeds threshold of 1000.",
  triggersEvaluated: ["MOQ exceeds 1000"],
  triggeredTriggers: ["MOQ exceeds 1000"],
  severity: "high",
});

const ACCEPT_DECISION = JSON.stringify({
  readyToAct: true,
  action: "accept",
  reasoning: "All rules satisfied — price $4.50 is below $5, lead time 25-30 days is under 45.",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const COUNTER_DECISION = JSON.stringify({
  readyToAct: true,
  action: "counter",
  reasoning: "Price $6.00 exceeds $5 max from rules.",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: { targetPrice: 4.5 },
});

const ESCALATE_DECISION = JSON.stringify({
  readyToAct: true,
  action: "escalate",
  reasoning: "Escalation trigger fired: MOQ exceeds 1000.",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const CLARIFY_DECISION = JSON.stringify({
  readyToAct: true,
  action: "clarify",
  reasoning: "Missing lead time data needed to evaluate rules.",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

const NEEDS_RECONSULT_DECISION = JSON.stringify({
  readyToAct: false,
  action: null,
  reasoning: "Need to check what information gaps exist.",
  nextExpert: "needs",
  questionForExpert: "What fields are missing to evaluate the negotiation rules?",
  counterTerms: null,
});

const NEEDS_RESPONSE = JSON.stringify({
  missingFields: ["leadTime"],
  prioritizedQuestions: ["What is the estimated lead time for 500 units?"],
  reasoning: "Lead time required by negotiation rules.",
});

const CLARIFY_AFTER_NEEDS = JSON.stringify({
  readyToAct: true,
  action: "clarify",
  reasoning: "Missing lead time — asking supplier.",
  nextExpert: null,
  questionForExpert: null,
  counterTerms: null,
});

describe("Orchestrator", () => {
  it("acceptable quote -> accept (extraction + escalation + orchestrator)", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const orchestrator = new Orchestrator(service);

    const result = await orchestrator.run(
      "Price is $4.50 per unit, MOQ 500, lead time 25-30 days.",
      orderInformation
    );

    expect(result.decision.action).toBe("accept");
    expect(result.decision.readyToAct).toBe(true);
    expect(result.extractedData).not.toBeNull();
    expect(result.extractedData!.quotedPrice).toBe(4.5);
    expect(result.trace.totalIterations).toBe(1);
    expect(result.expertOpinions.length).toBe(2); // extraction + escalation
  });

  it("price too high -> counter with counterTerms", async () => {
    const highPriceExtraction = JSON.stringify({
      quotedPrice: 6.0,
      quotedPriceCurrency: "USD",
      moq: 500,
      confidence: 0.95,
      notes: [],
    });

    const service = createRoutingMockLLMService({
      extract_quote: highPriceExtraction,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: COUNTER_DECISION,
    });
    const orchestrator = new Orchestrator(service);

    const result = await orchestrator.run(
      "Price is $6.00 per unit.",
      orderInformation
    );

    expect(result.decision.action).toBe("counter");
    expect(result.decision.counterTerms).toBeDefined();
    expect(result.decision.counterTerms!.targetPrice).toBe(4.5);
  });

  it("escalation trigger fires -> escalate", async () => {
    const highMoqExtraction = JSON.stringify({
      quotedPrice: 4.5,
      quotedPriceCurrency: "USD",
      moq: 2000,
      confidence: 0.95,
      notes: [],
    });

    const service = createRoutingMockLLMService({
      extract_quote: highMoqExtraction,
      evaluate_escalation: ESCALATION_TRIGGERED,
      orchestrate_decision: ESCALATE_DECISION,
    });
    const orchestrator = new Orchestrator(service);

    const result = await orchestrator.run(
      "Price is $4.50, MOQ 2000 units.",
      orderInformation
    );

    expect(result.decision.action).toBe("escalate");
    expect(result.decision.reasoning).toContain("MOQ");
  });

  it("orchestrator re-consults needs expert then clarifies", async () => {
    let orchestratorCallCount = 0;
    const service = {
      call: jest.fn(async (req: LLMRequest): Promise<LLMServiceResult> => {
        const schemaName = req.outputSchema?.name ?? "unknown";
        let content: string;

        switch (schemaName) {
          case "extract_quote":
            content = JSON.stringify({
              quotedPrice: 4.5,
              quotedPriceCurrency: "USD",
              moq: null,
              leadTimeMinDays: null,
              leadTimeMaxDays: null,
              confidence: 0.5,
              notes: ["Incomplete quote"],
            });
            break;
          case "evaluate_escalation":
            content = NO_ESCALATION;
            break;
          case "orchestrate_decision":
            orchestratorCallCount++;
            content = orchestratorCallCount === 1
              ? NEEDS_RECONSULT_DECISION
              : CLARIFY_AFTER_NEEDS;
            break;
          case "analyze_needs":
            content = NEEDS_RESPONSE;
            break;
          default:
            throw new Error(`Unexpected schema: ${schemaName}`);
        }

        return {
          response: {
            content,
            provider: "claude",
            model: "claude-3-haiku-20240307",
            inputTokens: 200,
            outputTokens: 100,
            latencyMs: 150,
          },
          attempts: [{ provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 150, success: true }],
        };
      }),
    } as unknown as LLMService;

    const orchestrator = new Orchestrator(service);

    const result = await orchestrator.run(
      "I can do $4.50 per unit.",
      orderInformation
    );

    expect(result.decision.action).toBe("clarify");
    expect(result.trace.totalIterations).toBe(2);
    expect(result.expertOpinions.length).toBe(3); // extraction + escalation + needs
    expect(result.needsAnalysis).toBeDefined();
    expect(result.needsAnalysis!.missingFields).toContain("leadTime");
  });

  it("extraction + escalation run in parallel (Promise.all)", async () => {
    const callOrder: string[] = [];
    const service = {
      call: jest.fn(async (req: LLMRequest): Promise<LLMServiceResult> => {
        const schemaName = req.outputSchema?.name ?? "unknown";
        callOrder.push(schemaName);

        let content: string;
        switch (schemaName) {
          case "extract_quote": content = GOOD_EXTRACTION; break;
          case "evaluate_escalation": content = NO_ESCALATION; break;
          case "orchestrate_decision": content = ACCEPT_DECISION; break;
          default: throw new Error(`Unexpected: ${schemaName}`);
        }

        return {
          response: {
            content,
            provider: "claude",
            model: "claude-3-haiku-20240307",
            inputTokens: 200,
            outputTokens: 100,
            latencyMs: 150,
          },
          attempts: [{ provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 150, success: true }],
        };
      }),
    } as unknown as LLMService;

    const orchestrator = new Orchestrator(service);
    await orchestrator.run("Price is $4.50.", orderInformation);

    // First two calls should be extraction and escalation (parallel)
    // Third should be orchestrator
    expect(callOrder.length).toBe(3);
    expect(callOrder.slice(0, 2).sort()).toEqual(["evaluate_escalation", "extract_quote"]);
    expect(callOrder[2]).toBe("orchestrate_decision");
  });

  it("extraction failure still runs through orchestrator", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: new Error("LLM failed"),
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ESCALATE_DECISION,
    });
    const orchestrator = new Orchestrator(service);

    const result = await orchestrator.run(
      "Some message",
      orderInformation
    );

    // Extraction failed but pipeline still works — orchestrator sees the failure
    expect(result.decision.action).toBe("escalate");
    expect(result.extractedData).toBeNull();
  });

  it("orchestrator LLM failure -> escalation safety valve", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: new Error("Orchestrator LLM failed"),
    });
    const orchestrator = new Orchestrator(service);

    const result = await orchestrator.run(
      "Price is $4.50.",
      orderInformation
    );

    expect(result.decision.action).toBe("escalate");
    expect(result.decision.reasoning).toContain("Orchestrator LLM failure");
  });

  it("no escalation triggers -> escalation expert skips LLM call", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const orchestrator = new Orchestrator(service);

    const noTriggersOI = buildTestOrderInformation({
      product: { productName: "Bamboo Cutting Board", supplierProductCode: "BCB-001", merchantSKU: "BCB-001" },
      pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00, lastKnownPrice: 4.25 },
      quantity: { targetQuantity: 500 },
    });
    // Remove escalation triggers entirely
    delete noTriggersOI.escalation;

    const result = await orchestrator.run(
      "Price is $4.50.",
      noTriggersOI
    );

    expect(result.decision.action).toBe("accept");
  });

  it("trace captures all iterations", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const orchestrator = new Orchestrator(service);

    const result = await orchestrator.run(
      "Price is $4.50.",
      orderInformation
    );

    expect(result.trace.iterations.length).toBe(1);
    expect(result.trace.finalDecision.action).toBe("accept");
    expect(result.trace.totalIterations).toBe(1);
  });

  it("passes conversation history to experts", async () => {
    const service = createRoutingMockLLMService({
      extract_quote: GOOD_EXTRACTION,
      evaluate_escalation: NO_ESCALATION,
      orchestrate_decision: ACCEPT_DECISION,
    });
    const orchestrator = new Orchestrator(service);

    await orchestrator.run(
      "New price $4.50.",
      orderInformation,
      "[AGENT] Can you do better?\n[SUPPLIER] Let me check."
    );

    const calls = (service.call as jest.Mock).mock.calls;
    // Extraction call should include conversation history
    const extractionCall = calls.find((c: [LLMRequest]) => c[0].outputSchema?.name === "extract_quote");
    expect(extractionCall[0].userMessage).toContain("Prior Conversation");
  });
});
