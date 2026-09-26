import type { LlmProvider, MockLlmHandler, StructuredRequest, StructuredResult } from './types.js';
import { LlmError, NO_USAGE } from './types.js';

/**
 * Deterministic LLM for tests and the CI stack (brief 8, 13.1). The calling service supplies
 * the answers per `task`; the answer is validated against the request's schema like a real one,
 * so a wrong mock fails loudly instead of hiding a schema mismatch.
 */
export function createMockLlmProvider(model: string, handler: MockLlmHandler): LlmProvider {
  return {
    name: 'mock',
    model,
    generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const result = request.schema.safeParse(handler(request));
      if (!result.success) {
        return Promise.reject(
          new LlmError('invalid_output', `${request.task}: mock answer does not match the schema`),
        );
      }
      return Promise.resolve({ value: result.data, usage: NO_USAGE, model, provider: 'mock' });
    },
  };
}
