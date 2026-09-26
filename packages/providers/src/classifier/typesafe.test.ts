import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeServer } from '../testing/fake-server.js';
import { startFakeServer } from '../testing/fake-server.js';
import { createTypeSafeClassifier } from './typesafe.js';

const API_KEY = 'ts-test-key-never-logged';

const questions = {
  verdict: {
    type: 'choice',
    instructions: 'Which verdict?',
    options: { stimmt: null, falsch: null },
  },
  worth: { type: 'score', instructions: 'How check-worthy?', levels: ['low', 'high'] },
  relevant: {
    type: 'bool',
    instructions: 'Is the snippet relevant to the claim?',
    criteria: { true: 'about the same fact', false: 'about something else' },
  },
} as const;

const jevAnswer = {
  body: {
    model: 'jev-1.13.0',
    answers: {
      verdict: {
        type: 'choice',
        choice: 'falsch',
        probabilities: { stimmt: 0.1, falsch: 0.9 },
        confidence: 0.8,
      },
      worth: {
        type: 'score',
        score: 0.9,
        legend: { '0': 'low', '1': 'high' },
        probabilities: { '0': 0.1, '1': 0.9 },
        confidence: 0.8,
      },
      relevant: { type: 'noul', noul: 0.97 },
    },
    usage: { input_tokens: 310, output_tokens: 22 },
  },
};

describe('typesafe classifier (Jev)', () => {
  let server: FakeServer;
  const classifier = () =>
    createTypeSafeClassifier({
      apiKey: API_KEY,
      model: 'jev-1.13.0',
      timeoutMs: 2_000,
      maxRetries: 0,
      baseURL: server.url,
    });

  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('maps our question types to Jev (bool → noul) and pins the model', async () => {
    server.respond(jevAnswer);
    await classifier().ask({ claim: 'Der Krieg endete 1965.' }, questions);

    const [sent] = server.requests;
    expect(sent?.path).toBe('/v1/systemone');
    expect(sent?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(sent?.body).toEqual({
      state: { claim: 'Der Krieg endete 1965.' },
      model: 'jev-1.13.0',
      questions: {
        verdict: {
          type: 'choice',
          instructions: 'Which verdict?',
          criteria: { stimmt: null, falsch: null },
        },
        worth: { type: 'score', instructions: 'How check-worthy?', criteria: ['low', 'high'] },
        relevant: {
          type: 'noul',
          instructions: 'Is the snippet relevant to the claim?',
          criteria: { true: 'about the same fact', false: 'about something else' },
        },
      },
    });
  });

  it('returns typed answers with the shared confidence formula and Jev usage', async () => {
    server.respond(jevAnswer);
    const result = await classifier().ask('Der Krieg endete 1965.', questions);

    expect(result.model).toBe('jev-1.13.0');
    expect(result.usage).toEqual({ inputTokens: 310, outputTokens: 22 });
    expect(result.answers.verdict).toMatchObject({
      choice: 'falsch',
      confidence: expect.closeTo(0.8, 6) as number,
    });
    expect(result.answers.worth.score).toBeCloseTo(0.9, 6);
    expect(result.answers.relevant).toMatchObject({
      probability: 0.97,
      confidence: expect.closeTo(0.94, 6) as number,
    });
  });

  it('refuses a state that exceeds the Jev budget without calling the API', async () => {
    await expect(classifier().ask('x'.repeat(130_000), questions)).rejects.toMatchObject({
      kind: 'state_too_large',
    });
    expect(server.requests).toHaveLength(0);
  });

  it('wraps API errors as provider_error without the key in the message', async () => {
    server.respond({ status: 401, body: { error: 'invalid api key' } });
    const error = await classifier()
      .ask('x', questions)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'provider_error' });
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('rejects answers that do not fit the questions', async () => {
    server.respond({
      body: {
        ...jevAnswer.body,
        answers: {
          ...jevAnswer.body.answers,
          relevant: { type: 'choice', choice: 'a', probabilities: { a: 1 }, confidence: 1 },
        },
      },
    });
    await expect(classifier().ask('x', questions)).rejects.toMatchObject({
      kind: 'invalid_output',
    });
  });
});
