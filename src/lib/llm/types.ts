export interface OutputSchema {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  outputSchema?: OutputSchema;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LLMProvider {
  name: string;
  call(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMServiceConfig {
  primaryProvider: LLMProvider;
  fallbackProvider?: LLMProvider;
  maxRetriesPerProvider: number;
  retryDelayMs: number;
}

export interface LLMAttemptLog {
  provider: string;
  model: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}
