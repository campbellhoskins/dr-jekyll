import * as fs from "fs";
import * as path from "path";
import { LLMService } from "@/lib/llm/service";
import { ClaudeProvider } from "@/lib/llm/providers/claude";
import { AgentPipeline } from "@/lib/agent/pipeline";
import type { AgentProcessRequest, OrderInformation } from "@/lib/agent/types";

const SCENARIOS_DIR = path.resolve(__dirname, "../../fixtures/scenarios");

interface ScenarioFile {
  name: string;
  supplierMessage: string;
  orderInformation: OrderInformation;
  expectedAction: string;
}

function loadScenario(name: string): ScenarioFile {
  return JSON.parse(
    fs.readFileSync(path.join(SCENARIOS_DIR, name), "utf8")
  );
}

const apiKey = process.env.ANTHROPIC_API_KEY;
const describeOrSkip = apiKey ? describe : describe.skip;

describeOrSkip("Live pipeline tests", () => {
  let pipeline: AgentPipeline;

  beforeAll(() => {
    const provider = new ClaudeProvider(
      apiKey!,
      process.env.LLM_TEST_MODEL ?? "claude-3-haiku-20240307"
    );
    const service = new LLMService({
      primaryProvider: provider,
      maxRetriesPerProvider: 3,
      retryDelayMs: 1000,
    });
    pipeline = new AgentPipeline(service);
  });

  function buildRequest(scenario: ScenarioFile): AgentProcessRequest {
    return {
      supplierMessage: scenario.supplierMessage,
      orderInformation: scenario.orderInformation,
    };
  }

  it("simple acceptable quote -> accept", async () => {
    const scenario = loadScenario("simple-acceptable.json");
    const result = await pipeline.process(buildRequest(scenario));

    expect(result.action).toBe("accept");
    expect(result.proposedApproval).toBeDefined();
    expect(result.proposedApproval!.price).toBeGreaterThan(0);
    expect(result.policyEvaluation.complianceStatus).toBe("compliant");
  });

  it("price above target -> counter", async () => {
    const scenario = loadScenario("counter-price-high.json");
    const result = await pipeline.process(buildRequest(scenario));

    expect(result.action).toBe("counter");
    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail.length).toBeGreaterThan(0);
  });

  it("MOQ exceeds trigger -> escalate", async () => {
    const scenario = loadScenario("escalation-moq.json");
    const result = await pipeline.process(buildRequest(scenario));

    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toBeTruthy();
  });

  it("product discontinued -> escalate", async () => {
    const scenario = loadScenario("escalation-discontinued.json");
    const result = await pipeline.process(buildRequest(scenario));

    expect(result.action).toBe("escalate");
  });

  it("ambiguous response -> clarify", async () => {
    const scenario = loadScenario("clarification-needed.json");
    const result = await pipeline.process(buildRequest(scenario));

    expect(result.action).toBe("clarify");
    expect(result.clarificationEmail).toBeTruthy();
  });

  it("low confidence email -> escalate", async () => {
    const scenario = loadScenario("low-confidence.json");
    const result = await pipeline.process(buildRequest(scenario));

    expect(result.action).toBe("escalate");
  });

  it("partial compliance -> counter", async () => {
    const scenario = loadScenario("partial-compliance.json");
    const result = await pipeline.process(buildRequest(scenario));

    expect(result.action).toBe("counter");
    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer!.draftEmail.length).toBeGreaterThan(0);
  });
});
