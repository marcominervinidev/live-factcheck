import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { RawAnswer } from './repair.js';
import { withOneRepair } from './repair.js';
import type { LlmProvider, StructuredRequest, StructuredResult } from './types.js';
import { LlmError } from './types.js';

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Only for tests (local fake server); production uses the SDK default. */
  readonly baseURL?: string;
}

const DEFAULT_MAX_TOKENS = 2_048;

/**
 * Claude via the official SDK (brief 8). Structured output with `zodOutputFormat` passed to
 * `messages.create`, so the schema constrains generation and our own validation (including
 * refinements the JSON schema cannot express) decides, with one repair attempt.
 */
export function createAnthropicProvider(options: AnthropicOptions): LlmProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: options.maxRetries,
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
  });

  return {
    name: 'anthropic',
    model: options.model,
    async generateStructured<T>(
      request: StructuredRequest<T>,
      callOptions?: { readonly signal?: AbortSignal },
    ): Promise<StructuredResult<T>> {
      const ask = async (repairNote: string | undefined): Promise<RawAnswer> => {
        let message: Anthropic.Message;
        try {
          message = await client.messages.create(
            {
              model: options.model,
              max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
              system: request.system,
              messages: [
                {
                  role: 'user',
                  content:
                    repairNote === undefined ? request.user : `${request.user}\n\n${repairNote}`,
                },
              ],
              output_config: { format: zodOutputFormat(request.schema) },
            },
            callOptions?.signal === undefined ? {} : { signal: callOptions.signal },
          );
        } catch (error) {
          throw new LlmError(
            'provider_error',
            `${request.task}: anthropic request failed`,
            undefined,
            {
              cause: error,
            },
          );
        }
        const usage = {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        };
        if (message.stop_reason === 'refusal') {
          throw new LlmError('refused', `${request.task}: the model refused`, usage);
        }
        // max_tokens means the JSON is cut off; treat like invalid output (one repair attempt).
        const text =
          message.stop_reason === 'max_tokens'
            ? null
            : message.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('');
        return { text: text === '' ? null : text, usage };
      };

      const { value, usage } = await withOneRepair(request, ask);
      return { value, usage, model: options.model, provider: 'anthropic' };
    },
  };
}
