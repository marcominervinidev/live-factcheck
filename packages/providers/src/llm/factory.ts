import { createAnthropicProvider } from './anthropic.js';
import type { LlmConfig, LlmTask } from './config.js';
import { resolveLlmConfig } from './config.js';
import { createMockLlmProvider } from './mock.js';
import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import type { LlmProvider, MockLlmHandler } from './types.js';

export interface CreateLlmOptions {
  /** Answers for `provider=mock`; required only then, so services keep mocks next to their prompts. */
  readonly mock?: MockLlmHandler;
}

/** Builds the configured `LlmProvider` of a task (brief 8). Config was validated at startup. */
export function createLlmProvider<T extends LlmTask>(
  task: T,
  config: LlmConfig<T>,
  options: CreateLlmOptions = {},
): LlmProvider {
  const resolved = resolveLlmConfig(task, config);
  switch (resolved.provider) {
    case 'anthropic': {
      if (resolved.apiKey === undefined) {
        // Unreachable after checkLlmConfig; kept as a guard instead of a non-null assertion.
        throw new Error(`${task}_LLM_API_KEY is required for anthropic`);
      }
      return createAnthropicProvider({
        apiKey: resolved.apiKey,
        model: resolved.model,
        timeoutMs: resolved.timeoutMs,
        maxRetries: resolved.maxRetries,
      });
    }
    case 'openai-compatible': {
      if (resolved.baseUrl === undefined) {
        throw new Error(`${task}_LLM_BASE_URL is required for openai-compatible`);
      }
      return createOpenAiCompatibleProvider({
        baseURL: resolved.baseUrl,
        ...(resolved.apiKey === undefined ? {} : { apiKey: resolved.apiKey }),
        model: resolved.model,
        timeoutMs: resolved.timeoutMs,
        maxRetries: resolved.maxRetries,
      });
    }
    case 'mock': {
      if (options.mock === undefined) {
        throw new Error(`${task}_LLM_PROVIDER=mock needs mock answers from the service`);
      }
      return createMockLlmProvider(resolved.model, options.mock);
    }
  }
}
