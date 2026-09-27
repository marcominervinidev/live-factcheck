import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { loadPromptTemplate, renderPrompt } from '../llm/prompt.js';
import type { LlmProvider } from '../llm/types.js';
import { LlmError } from '../llm/types.js';
import type { RawAnswer } from './answers.js';
import { answersFor } from './answers.js';
import type {
  ClassifierProvider,
  ClassifierResult,
  ClassifierState,
  Question,
  Questions,
} from './types.js';
import { ClassifierError } from './types.js';

const TEMPLATE = loadPromptTemplate(new URL('../../prompts/classifier.md', import.meta.url));

// LLM probabilities are not calibrated and rarely sum exactly to 1; within this band they are
// normalised, outside it the answer is invalid and gets the one repair attempt (brief 8).
const MIN_SUM = 0.9;
const MAX_SUM = 1.1;

const Probability = z.number().min(0).max(1);

const distribution = (keys: readonly string[]) =>
  z.strictObject(Object.fromEntries(keys.map((key) => [key, Probability]))).refine(
    (values) => {
      const sum = Object.values(values).reduce((total, p) => total + p, 0);
      return sum >= MIN_SUM && sum <= MAX_SUM;
    },
    { message: `probabilities must sum to 1 (accepted ${String(MIN_SUM)}–${String(MAX_SUM)})` },
  );

function schemaFor(question: Question): z.ZodType<RawAnswer> {
  switch (question.type) {
    case 'choice':
      return distribution(Object.keys(question.options));
    case 'score':
      return distribution(question.levels.map((_, i) => String(i)));
    case 'bool':
      return Probability;
  }
}

/** How the questions are shown to the model; ids are neutral so they carry no hint. */
function describeQuestions(questions: Questions): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(questions).map(([id, question]) => {
        switch (question.type) {
          case 'choice':
            return [
              id,
              { type: 'choice', instructions: question.instructions, options: question.options },
            ];
          case 'score':
            return [
              id,
              {
                type: 'score',
                instructions: question.instructions,
                levels: Object.fromEntries(question.levels.map((level, i) => [String(i), level])),
              },
            ];
          case 'bool':
            return [
              id,
              {
                type: 'bool',
                instructions: question.instructions,
                criteria: question.criteria ?? null,
              },
            ];
        }
      }),
    ),
    null,
    2,
  );
}

/**
 * The three question types via an `LlmProvider` (ADR 0007): the default and the fully local
 * path. All questions go into one structured request.
 */
export function createLlmClassifier(llm: LlmProvider): ClassifierProvider {
  return {
    name: 'llm',
    model: llm.model,
    async ask<Q extends Questions>(
      state: ClassifierState,
      questions: Q,
      options?: { readonly signal?: AbortSignal },
    ): Promise<ClassifierResult<Q>> {
      const schema = z.strictObject(
        Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, schemaFor(q)])),
      ) as z.ZodType<Record<string, RawAnswer>>;
      // A fresh random suffix per request: page text cannot close the state block, because it
      // cannot know the tag (security review of TP2/TP3, finding 2).
      const user = renderPrompt(TEMPLATE.user, {
        nonce: randomBytes(8).toString('hex'),
        state: typeof state === 'string' ? state : JSON.stringify(state, null, 2),
        questions: describeQuestions(questions),
      });
      try {
        const result = await llm.generateStructured(
          { task: 'classifier', system: TEMPLATE.system, user, schema },
          options,
        );
        return {
          answers: answersFor(questions, result.value),
          usage: result.usage,
          model: result.model,
          provider: 'llm',
        };
      } catch (error) {
        if (error instanceof LlmError) {
          throw new ClassifierError(error.kind, error.message, error.usage, { cause: error });
        }
        throw error;
      }
    },
  };
}
