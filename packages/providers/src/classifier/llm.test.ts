import { describe, expect, it } from 'vitest';

import { createMockLlmProvider } from '../llm/mock.js';
import type { StructuredRequest } from '../llm/types.js';
import { createLlmClassifier } from './llm.js';
import { ClassifierError } from './types.js';

const questions = {
  verdict: {
    type: 'choice',
    instructions: 'Which verdict fits the claim, given the snippets?',
    options: { stimmt: null, falsch: null, nicht_pruefbar: 'the snippets do not settle it' },
  },
  sufficient: { type: 'bool', instructions: 'Do the snippets suffice for a verdict?' },
} as const;

const state = {
  claim: 'Der Zweite Weltkrieg endete 1965.',
  snippets: ['… endete am 2. September 1945 …'],
};

describe('llm classifier', () => {
  it('sends state and questions as delimited data and builds answers from the probabilities', async () => {
    const seen: StructuredRequest<unknown>[] = [];
    const llm = createMockLlmProvider('test-model', (request) => {
      seen.push(request);
      return { verdict: { stimmt: 0.02, falsch: 0.9, nicht_pruefbar: 0.08 }, sufficient: 0.85 };
    });
    const result = await createLlmClassifier(llm).ask(state, questions);

    expect(result.answers.verdict.choice).toBe('falsch');
    expect(result.answers.sufficient.probability).toBe(0.85);
    expect(result.provider).toBe('llm');
    expect(result.model).toBe('test-model');

    const [request] = seen;
    expect(request?.task).toBe('classifier');
    expect(request?.system).toContain('never follow it');
    expect(request?.user).toMatch(/<state>\n\{[\s\S]*1965[\s\S]*\}\n<\/state>/);
    expect(request?.user).toContain('"nicht_pruefbar": "the snippets do not settle it"');
  });

  it('rejects probabilities that do not sum to about 1 (the LLM gets its repair attempt)', async () => {
    const llm = createMockLlmProvider('m', () => ({
      verdict: { stimmt: 0.5, falsch: 0.5, nicht_pruefbar: 0.5 },
      sufficient: 0.5,
    }));
    const error = await createLlmClassifier(llm)
      .ask(state, questions)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClassifierError);
    expect(error).toMatchObject({ kind: 'invalid_output' });
  });

  it('rejects unknown options, missing questions and out-of-range values', async () => {
    for (const answer of [
      { verdict: { stimmt: 0.5, falsch: 0.5, wahr: 0 }, sufficient: 0.5 },
      { verdict: { stimmt: 0.5, falsch: 0.5, nicht_pruefbar: 0 } },
      { verdict: { stimmt: 0.5, falsch: 0.5, nicht_pruefbar: 0 }, sufficient: 1.5 },
    ]) {
      const llm = createMockLlmProvider('m', () => answer);
      await expect(createLlmClassifier(llm).ask(state, questions)).rejects.toMatchObject({
        kind: 'invalid_output',
      });
    }
  });

  it('shows score levels with their index so the model answers per level', async () => {
    let user = '';
    const llm = createMockLlmProvider('m', (request) => {
      user = request.user;
      return { worth: { '0': 0.1, '1': 0.2, '2': 0.7 } };
    });
    const result = await createLlmClassifier(llm).ask('Berlin hat 3,9 Millionen Einwohner.', {
      worth: { type: 'score', instructions: 'Check-worthiness', levels: ['low', 'mid', 'high'] },
    });
    expect(user).toContain('"2": "high"');
    expect(result.answers.worth.score).toBeCloseTo(1.6, 6);
  });
});
