import { AgentPipeline } from "@/lib/agent/pipeline";
import type { LLMService, LLMServiceResult } from "@/lib/llm/service";
import type { LLMRequest } from "@/lib/llm/types";
import type { AgentProcessRequest } from "@/lib/agent/types";
import { buildTestOrderInformation } from "../../helpers/order-information";

/**
 * Creates a mock LLM service that returns different responses based on call order.
 * Call 1 = rules generation, Call 2 = agent prompt.
 */
function createSequentialMockLLMService(responses: (string | Error)[]): LLMService {
  let callIndex = 0;
  return {
    call: jest.fn(async (_req: LLMRequest): Promise<LLMServiceResult> => {
      const resp = responses[callIndex++];
      if (resp instanceof Error) throw resp;
      return {
        response: {
          content: resp,
          provider: "claude",
          model: "claude-3-haiku-20240307",
          inputTokens: 200,
          outputTokens: 100,
          latencyMs: 200,
        },
        attempts: [{ provider: "claude", model: "claude-3-haiku-20240307", latencyMs: 200, success: true }],
      };
    }),
  } as unknown as LLMService;
}

// ─── Mock LLM responses ─────────────────────────────────────────────────────

const RULES_RESPONSE = `<order_context>
MERCHANT
- Merchant Name: Test Merchant

PRODUCT
- Product: Bamboo Cutting Board (BCB-001)
- Target Quantity: 500

PRICING REFERENCE
- Target Price: $4.00 USD
</order_context>

<merchant_rules>
## PRICING RULES
- If supplier price is at or below $4.00 → ACCEPTABLE
- If supplier price is above $4.00 but at or below $5.00 → counter toward $4.00
- If supplier price exceeds $5.00 → ESCALATE immediately

## QUANTITY RULES
- Target quantity: 500
- If MOQ exceeds 1000 → ESCALATE

## ESCALATION RULES
- ESCALATE if: MOQ exceeds 1000 units
</merchant_rules>`;

const ACCEPT_AGENT_RESPONSE = `<systematic_evaluation>
**1. Relevant Rules:**
PRICING: Target $4.00, max $5.00
The supplier quoted $3.80 which is below the target price.

**7. Overall Action:**
All terms acceptable. Price $3.80 is below target $4.00.
Overall Action: ACCEPT
</systematic_evaluation>

<decision>
- Price: ACCEPTABLE - $3.80 is below target $4.00
- Quantity: ACCEPTABLE - 500 units matches target
Overall Action: ACCEPT
</decision>

<response>
Thank you for your competitive quote of $3.80 per unit. We are pleased to accept these terms for 500 units of the Bamboo Cutting Board (BCB-001).
</response>`;

const COUNTER_AGENT_RESPONSE = `<systematic_evaluation>
**1. Relevant Rules:**
PRICING: Target $4.00, max $5.00
The supplier quoted $4.50 which is above target but within acceptable range.

**7. Overall Action:**
Price needs counter. $4.50 > $4.00 target but < $5.00 max.
Overall Action: COUNTER
</systematic_evaluation>

<decision>
- Price: NEEDS COUNTER - $4.50 is above target $4.00
- Quantity: ACCEPTABLE - 500 units
Overall Action: COUNTER
</decision>

<response>
Thank you for your quote. We were hoping for a price closer to $4.00 per unit for the Bamboo Cutting Board. Could you review your pricing?
</response>`;

const ESCALATE_AGENT_RESPONSE = `<systematic_evaluation>
**1. Relevant Rules:**
ESCALATION: MOQ exceeds 1000 units

**5. Escalation Trigger Check:**
Trigger: "ESCALATE if MOQ exceeds 1000 units"
Status: APPLIES - Supplier requires MOQ of 2000 units.

**7. Overall Action:**
Escalation trigger fired.
Overall Action: ESCALATE
</systematic_evaluation>

<decision>
- Quantity: ESCALATE - MOQ 2000 exceeds 1000 threshold
Overall Action: ESCALATE
</decision>

<response>
ESCALATION NOTICE: The supplier requires a minimum order quantity of 2000 units, which exceeds our maximum acceptable quantity of 1000 units. Merchant review required.
</response>`;

const baseRequest: AgentProcessRequest = {
  supplierMessage: "Price is $4.50 per unit, MOQ 500, lead time 25-30 days.",
  orderInformation: buildTestOrderInformation({
    product: { productName: "Bamboo Cutting Board", supplierProductCode: "BCB-001", merchantSKU: "BCB-001" },
    pricing: { targetPrice: 4.00, maximumAcceptablePrice: 5.00, lastKnownPrice: 4.25 },
    quantity: { targetQuantity: 500 },
    escalation: { additionalTriggers: ["Escalate if MOQ exceeds 1000 units"] },
  }),
};

describe("AgentPipeline", () => {
  it("acceptable quote -> action=accept with response text", async () => {
    const service = createSequentialMockLLMService([RULES_RESPONSE, ACCEPT_AGENT_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("accept");
    expect(result.responseText).toContain("$3.80");
    expect(result.reasoning).toContain("Relevant Rules");
    expect(result.decision).toContain("ACCEPT");
  });

  it("price too high -> action=counter with response text", async () => {
    const service = createSequentialMockLLMService([RULES_RESPONSE, COUNTER_AGENT_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("counter");
    expect(result.responseText).toContain("$4.00");
    expect(result.decision).toContain("COUNTER");
  });

  it("escalation trigger -> action=escalate", async () => {
    const service = createSequentialMockLLMService([RULES_RESPONSE, ESCALATE_AGENT_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
    expect(result.responseText).toContain("ESCALATION");
    expect(result.reasoning).toContain("MOQ");
  });

  it("skips rules generation when cached rules are provided", async () => {
    // Only one LLM call (agent prompt), no rules generation
    const service = createSequentialMockLLMService([ACCEPT_AGENT_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process({
      ...baseRequest,
      cachedOrderContext: "cached context",
      cachedMerchantRules: "cached rules",
    });

    expect(result.action).toBe("accept");
    expect(result.orderContext).toBe("cached context");
    expect(result.merchantRules).toBe("cached rules");
    expect(service.call).toHaveBeenCalledTimes(1);
  });

  it("makes 2 LLM calls when rules are not cached", async () => {
    const service = createSequentialMockLLMService([RULES_RESPONSE, ACCEPT_AGENT_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    await pipeline.process(baseRequest);

    expect(service.call).toHaveBeenCalledTimes(2);
  });

  it("returns orderContext and merchantRules for caching", async () => {
    const service = createSequentialMockLLMService([RULES_RESPONSE, ACCEPT_AGENT_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.orderContext).toContain("Bamboo Cutting Board");
    expect(result.merchantRules).toContain("PRICING RULES");
  });

  it("returns provider and model info", async () => {
    const service = createSequentialMockLLMService([RULES_RESPONSE, ACCEPT_AGENT_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-3-haiku-20240307");
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it("defaults to escalate when agent output has no valid decision", async () => {
    const badResponse = "Some malformed output without XML tags";
    const service = createSequentialMockLLMService([RULES_RESPONSE, badResponse]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.process(baseRequest);

    expect(result.action).toBe("escalate");
  });

  it("LLM failure during agent call propagates error", async () => {
    const service = createSequentialMockLLMService([
      RULES_RESPONSE,
      new Error("All LLM providers failed"),
    ]);
    const pipeline = new AgentPipeline(service);

    await expect(pipeline.process(baseRequest)).rejects.toThrow("All LLM providers failed");
  });

  it("generateRules returns parsed order context and merchant rules", async () => {
    const service = createSequentialMockLLMService([RULES_RESPONSE]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.generateRules(baseRequest.orderInformation);

    expect(result.orderContext).toContain("Bamboo Cutting Board");
    expect(result.merchantRules).toContain("PRICING RULES");
    expect(result.provider).toBe("claude");
  });

  it("generateInitialEmail returns email text and subject line", async () => {
    const emailResponse = JSON.stringify({
      emailText: "We are interested in ordering Bamboo Cutting Boards.",
      subjectLine: "Quote Request - BCB-001",
    });
    const service = createSequentialMockLLMService([emailResponse]);
    const pipeline = new AgentPipeline(service);

    const result = await pipeline.generateInitialEmail(baseRequest.orderInformation);

    expect(result.emailText).toContain("Bamboo Cutting Boards");
    expect(result.subjectLine).toContain("BCB-001");
    expect(result.provider).toBe("claude");
  });
});
