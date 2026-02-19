import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMServiceConfig,
  LLMAttemptLog,
} from "./types";

export interface LLMServiceResult {
  response: LLMResponse;
  attempts: LLMAttemptLog[];
}

export class LLMService {
  private config: LLMServiceConfig;

  constructor(config: LLMServiceConfig) {
    this.config = config;
  }

  async call(request: LLMRequest): Promise<LLMServiceResult> {
    const attempts: LLMAttemptLog[] = [];
    const providers: LLMProvider[] = [this.config.primaryProvider];
    if (this.config.fallbackProvider) {
      providers.push(this.config.fallbackProvider);
    }

    for (const provider of providers) {
      for (let attempt = 0; attempt < this.config.maxRetriesPerProvider; attempt++) {
        if (attempts.length > 0 && !attempts[attempts.length - 1].success) {
          await this.delay(this.config.retryDelayMs);
        }

        const start = Date.now();
        try {
          const response = await provider.call(request);
          attempts.push({
            provider: provider.name,
            model: response.model,
            latencyMs: Date.now() - start,
            success: true,
          });
          return { response, attempts };
        } catch (error) {
          attempts.push({
            provider: provider.name,
            model: "unknown",
            latencyMs: Date.now() - start,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const lastError = attempts[attempts.length - 1]?.error ?? "Unknown error";
    throw new Error(`All LLM providers failed. Last error: ${lastError}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
