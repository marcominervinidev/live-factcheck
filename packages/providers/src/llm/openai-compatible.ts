import OpenAI from 'openai';
import { z } from 'zod';

import type { RawAnswer } from './repair.js';
import { withOneRepair } from './repair.js';
import type { LlmProvider, StructuredRequest, StructuredResult } from './types.js';
import { LlmError } from './types.js';

export interface OpenAiCompatibleOptions {
  /** e.g. `http://host.docker.internal:1234/v1` (LM Studio) or `…:11434/v1` (Ollama). */
  readonly baseURL: string;
  /** LM Studio and Ollama need none; a placeholder is sent then (not a secret). */
  readonly apiKey?: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

const DEFAULT_MAX_TOKENS = 2_048;
const NO_KEY_PLACEHOLDER = 'not-needed';

/**
 * OpenAI-compatible servers (LM Studio, Ollama, vLLM; brief 8). Asks for JSON via
 * `response_format: json_schema` (supported by LM Studio and Ollama), always validates with
 * zod, and makes one repair attempt.
 */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const client = new OpenAI({
    baseURL: options.baseURL,
    apiKey: options.apiKey ?? NO_KEY_PLACEHOLDER,
    timeout: options.timeoutMs,
    maxRetries: options.maxRetries,
  });

  return {
    name: 'openai-compatible',
    model: options.model,
    async generateStructured<T>(
      request: StructuredRequest<T>,
      callOptions?: { readonly signal?: AbortSignal },
    ): Promise<StructuredResult<T>> {
      const jsonSchema = z.toJSONSchema(request.schema, { unrepresentable: 'any' });
      const ask = async (repairNote: string | undefined): Promise<RawAnswer> => {
        let completion: OpenAI.ChatCompletion;
        try {
          completion = await client.chat.completions.create(
            {
              model: options.model,
              max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
              messages: [
                { role: 'system', content: request.system },
                {
                  role: 'user',
                  content:
                    repairNote === undefined ? request.user : `${request.user}\n\n${repairNote}`,
                },
              ],
              response_format: {
                type: 'json_schema',
                json_schema: { name: request.task, schema: jsonSchema },
              },
            },
            callOptions?.signal === undefined ? {} : { signal: callOptions.signal },
          );
        } catch (error) {
          throw new LlmError(
            'provider_error',
            `${request.task}: openai-compatible request failed`,
            undefined,
            { cause: error },
          );
        }
        const usage = {
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
        };
        const choice = completion.choices[0];
        const text =
          choice === undefined || choice.finish_reason === 'length'
            ? null
            : (choice.message.content ?? null);
        return { text: text === '' ? null : text, usage };
      };

      const { value, usage } = await withOneRepair(request, ask);
      return { value, usage, model: options.model, provider: 'openai-compatible' };
    },
  };
}
