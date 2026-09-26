import { NO_USAGE } from '../llm/types.js';
import type { RawAnswer } from './answers.js';
import { answersFor } from './answers.js';
import type { ClassifierProvider, ClassifierResult, ClassifierState, Questions } from './types.js';
import { ClassifierError } from './types.js';

/**
 * Deterministic answers supplied by the calling service: raw probabilities per question id
 * (Choice/Score: per option or level, Bool: one number). They go through the same answer
 * building as real providers, so confidence and normalisation are the real code.
 */
export type MockClassifierHandler = (
  state: ClassifierState,
  questions: Questions,
) => Readonly<Record<string, RawAnswer>>;

export function createMockClassifier(
  model: string,
  handler: MockClassifierHandler,
): ClassifierProvider {
  return {
    name: 'mock',
    model,
    ask<Q extends Questions>(state: ClassifierState, questions: Q): Promise<ClassifierResult<Q>> {
      try {
        const answers = answersFor(questions, handler(state, questions));
        return Promise.resolve({ answers, usage: NO_USAGE, model, provider: 'mock' });
      } catch (error) {
        return Promise.reject(
          new ClassifierError(
            'invalid_output',
            'mock answer does not fit the questions',
            NO_USAGE,
            {
              cause: error,
            },
          ),
        );
      }
    },
  };
}
