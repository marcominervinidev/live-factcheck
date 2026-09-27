import { TypeSafeClient, TypeSafeError } from '@typesafe-ai/sdk';
import type { Question as JevQuestion, Questions as JevQuestions } from '@typesafe-ai/sdk';

import { answersFor } from './answers.js';
import type { RawAnswer } from './answers.js';
import type {
  Answers,
  ClassifierProvider,
  ClassifierResult,
  ClassifierState,
  Question,
  Questions,
} from './types.js';
import { ClassifierError } from './types.js';

export interface TypeSafeOptions {
  readonly apiKey: string;
  /** A pinned version such as `jev-1.13.0`, never the moving alias (ADR 0007). */
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Only for tests (local fake server). */
  readonly baseURL?: string;
}

// Jev budgets (docs.typesafe.ai/models): 32k tokens for state + longest question, 64k in total.
// Estimated at ~4 characters per token; the caller must send less instead of us truncating.
const STATE_BUDGET_TOKENS = 32_000;
const TOTAL_BUDGET_TOKENS = 64_000;
const estimateTokens = (value: unknown) =>
  Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 4);

function toJev(question: Question): JevQuestion {
  switch (question.type) {
    case 'choice':
      return { type: 'choice', instructions: question.instructions, criteria: question.options };
    case 'score':
      return { type: 'score', instructions: question.instructions, criteria: question.levels };
    case 'bool':
      return question.criteria === undefined
        ? { type: 'noul', instructions: question.instructions }
        : { type: 'noul', instructions: question.instructions, criteria: question.criteria };
  }
}

/**
 * Jev by TypeSafe via the official SDK (brief 8.1, ADR 0007). Speaker names never reach this
 * adapter: callers send only the claim and snippets (brief 15.6). SDK logging is off because
 * its debug level logs request bodies.
 */
export function createTypeSafeClassifier(options: TypeSafeOptions): ClassifierProvider {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.model,
    timeout: options.timeoutMs,
    retry: { maxRetries: options.maxRetries },
    logLevel: 'off',
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
  });

  return {
    name: 'typesafe',
    model: options.model,
    async ask<Q extends Questions>(
      state: ClassifierState,
      questions: Q,
      callOptions?: { readonly signal?: AbortSignal },
    ): Promise<ClassifierResult<Q>> {
      const jevQuestions: JevQuestions = Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [id, toJev(question)]),
      );
      const stateTokens = estimateTokens(state);
      const questionTokens = Object.values(jevQuestions).map(estimateTokens);
      if (
        stateTokens + Math.max(0, ...questionTokens) > STATE_BUDGET_TOKENS ||
        stateTokens + questionTokens.reduce((sum, t) => sum + t, 0) > TOTAL_BUDGET_TOKENS
      ) {
        throw new ClassifierError('state_too_large', 'state and questions exceed the Jev budget');
      }

      let result;
      try {
        result = await client.systemOne(
          // The SDK's JSON types are mutable; ours are readonly views of the same shapes.
          {
            state: state as Parameters<typeof client.systemOne>[0]['state'],
            questions: jevQuestions,
            model: options.model,
          },
          callOptions?.signal === undefined ? {} : { signal: callOptions.signal },
        );
      } catch (error) {
        if (error instanceof TypeSafeError) {
          throw new ClassifierError('provider_error', 'typesafe request failed', undefined, {
            cause: error,
          });
        }
        throw error;
      }

      const usage = {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      };
      const raw: Record<string, RawAnswer> = {};
      for (const [id, answer] of Object.entries(result.answers)) {
        raw[id] = answer.type === 'noul' ? answer.noul : { ...answer.probabilities };
      }
      // Confidence is recomputed from Jev's probabilities with the shared formula (ADR 0007),
      // so every provider is compared on one definition.
      let answers: Answers<Q>;
      try {
        answers = answersFor(questions, raw);
      } catch (error) {
        throw new ClassifierError(
          'invalid_output',
          'typesafe answers do not fit the questions',
          usage,
          {
            cause: error,
          },
        );
      }
      return { answers, usage, model: result.model, provider: 'typesafe' };
    },
  };
}
