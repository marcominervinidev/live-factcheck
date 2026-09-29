import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDailyBudget, sttBudgetCostUsd } from '../budget.js';
import { estimateSttCostUsd } from '../pricing.js';
import { checkSttConfig, describeSttConfig, sttConfigShape, sttUse } from './config.js';
import { createSttProvider } from './factory.js';
import { MOCK_STT_SCRIPT, MOCK_STT_SECONDS_PER_LINE, createMockSttProvider } from './mock.js';
import type { SttSegment } from './types.js';
import { speakerLabels } from './types.js';

const Schema = z.object(sttConfigShape).superRefine(checkSttConfig);
const issues = (env: Record<string, unknown>) =>
  (Schema.safeParse(env).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('STT configuration (brief 10, 15.6)', () => {
  it.each([
    [
      { STT_PROVIDER: 'deepgram', STT_MODEL: 'nova-3' },
      'DEEPGRAM_API_KEY: required when STT_PROVIDER=deepgram',
    ],
    [
      { STT_PROVIDER: 'assemblyai', STT_MODEL: 'u' },
      'ASSEMBLYAI_API_KEY: required when STT_PROVIDER=assemblyai',
    ],
    [
      { STT_PROVIDER: 'local', STT_MODEL: 'small' },
      'LOCAL_STT_URL: required when STT_PROVIDER=local',
    ],
  ])('requires the provider’s credentials or endpoint', (env, expected) => {
    expect(issues(env)).toContain(expected);
  });

  it('defaults to German and the EU region and rejects non-WebSocket URLs', () => {
    const parsed = Schema.parse({ STT_PROVIDER: 'mock', STT_MODEL: 'mock' });
    expect(parsed).toMatchObject({ STT_LANGUAGE: 'de', STT_REGION: 'eu', STT_ENDPOINTING_MS: 300 });
    expect(
      issues({ STT_PROVIDER: 'local', STT_MODEL: 's', LOCAL_STT_URL: 'http://x/y' }),
    ).not.toHaveLength(0);
    expect(
      issues({ STT_PROVIDER: 'mock', STT_MODEL: 'm', STT_LANGUAGE: 'deutsch' }),
    ).not.toHaveLength(0);
  });

  it.each([
    [{ STT_PROVIDER: 'mock', STT_MODEL: 'm' }, false],
    [{ STT_PROVIDER: 'deepgram', STT_MODEL: 'nova-3', DEEPGRAM_API_KEY: 'k' }, true],
    [{ STT_PROVIDER: 'assemblyai', STT_MODEL: 'u', ASSEMBLYAI_API_KEY: 'k' }, true],
    [
      { STT_PROVIDER: 'local', STT_MODEL: 's', LOCAL_STT_URL: 'ws://stt-local:8000/v1/stream' },
      false,
    ],
    [
      { STT_PROVIDER: 'local', STT_MODEL: 's', LOCAL_STT_URL: 'ws://host.docker.internal:8000/v1' },
      false,
    ],
    [{ STT_PROVIDER: 'local', STT_MODEL: 's', LOCAL_STT_URL: 'wss://stt.example.com/v1' }, true],
  ])('classifies %o as cloud=%s (fails closed for unknown hosts)', (env, cloud) => {
    expect(sttUse(Schema.parse(env))).toMatchObject({ cloud });
  });

  it('describes the provider without keys or paths', () => {
    const cloud = describeSttConfig(
      Schema.parse({
        STT_PROVIDER: 'deepgram',
        STT_MODEL: 'nova-3',
        DEEPGRAM_API_KEY: 'secret-key',
      }),
    );
    expect(cloud).toEqual({ provider: 'deepgram', model: 'nova-3', language: 'de', region: 'eu' });
    const local = describeSttConfig(
      Schema.parse({
        STT_PROVIDER: 'local',
        STT_MODEL: 's',
        LOCAL_STT_URL: 'ws://stt-local:8000/v1/stream',
      }),
    );
    expect(local).toEqual({
      provider: 'local',
      model: 's',
      language: 'de',
      endpoint: 'ws://stt-local:8000',
    });
    expect(JSON.stringify(cloud)).not.toContain('secret');
  });

  it('builds the configured provider', () => {
    const names = [
      { STT_PROVIDER: 'mock', STT_MODEL: 'm' },
      { STT_PROVIDER: 'deepgram', STT_MODEL: 'nova-3', DEEPGRAM_API_KEY: 'k' },
      { STT_PROVIDER: 'assemblyai', STT_MODEL: 'u', ASSEMBLYAI_API_KEY: 'k' },
      { STT_PROVIDER: 'local', STT_MODEL: 's', LOCAL_STT_URL: 'ws://stt-local:8000/v1' },
    ].map((env) => createSttProvider(Schema.parse(env)).name);
    expect(names).toEqual(['mock', 'deepgram', 'assemblyai', 'local']);
    expect(() =>
      createSttProvider(
        z.object(sttConfigShape).parse({ STT_PROVIDER: 'deepgram', STT_MODEL: 'n' }),
      ),
    ).toThrow('DEEPGRAM_API_KEY is required');
  });
});

describe('speaker labels', () => {
  it('assigns A, B, … in order of appearance and A without diarization', () => {
    const label = speakerLabels();
    expect([label(5), label(0), label(5), label(undefined)]).toEqual(['A', 'B', 'A', 'A']);
    const many = speakerLabels();
    const labels = Array.from({ length: 28 }, (_, i) => many(i));
    expect(labels.slice(24)).toEqual(['Y', 'Z', 'A2', 'B2']);
  });
});

describe('mock STT provider', () => {
  it('turns audio into the scripted transcript, interim before final, speakers alternating', async () => {
    const segments: SttSegment[] = [];
    const session = await createMockSttProvider().open(
      { language: 'de', sampleRate: 16_000 },
      { onSegment: (s) => segments.push(s), onError: () => undefined },
    );
    const frame = new Uint8Array(3_200);
    const framesPerLine = (MOCK_STT_SECONDS_PER_LINE * 32_000) / 3_200;
    for (let i = 0; i < framesPerLine * 2; i++) session.send(frame);

    expect(segments.map((s) => [s.isFinal, s.speaker])).toEqual([
      [false, 'A'],
      [true, 'A'],
      [false, 'B'],
      [true, 'B'],
    ]);
    expect(segments[1]).toEqual({
      text: MOCK_STT_SCRIPT[0],
      isFinal: true,
      startMs: 0,
      endMs: 2_000,
      speaker: 'A',
    });
    expect(segments[3]?.startMs).toBe(2_000);
    await session.finish();
    session.send(frame);
    expect(segments).toHaveLength(4);
  });
});

describe('STT cost and budget (brief 15.5)', () => {
  it('prices known models per audio minute and unknown ones conservatively', () => {
    expect(estimateSttCostUsd('deepgram', 'nova-3', 60_000)).toBeCloseTo(0.0077, 10);
    expect(estimateSttCostUsd('deepgram', 'nova-9', 60_000)).toBeNull();
    expect(sttBudgetCostUsd('deepgram', 'nova-9', 60_000)).toBeCloseTo(0.05, 10);
    expect(sttBudgetCostUsd('assemblyai', 'universal-streaming-multilingual', 120_000)).toBeCloseTo(
      0.005,
      10,
    );
  });

  it('books a priced amount on the shared daily counter', async () => {
    const values = new Map<string, number>();
    const budget = createDailyBudget(
      {
        incrbyfloat: (key, inc) => {
          values.set(key, (values.get(key) ?? 0) + inc);
          return Promise.resolve(String(values.get(key)));
        },
        expire: () => Promise.resolve(1),
        get: (key) => Promise.resolve(values.has(key) ? String(values.get(key)) : null),
      },
      0.01,
      () => new Date('2026-09-29T10:00:00Z'),
    );
    await budget.recordUsd(0);
    await budget.recordUsd(Number.NaN);
    expect(values.size).toBe(0);
    await budget.recordUsd(0.006);
    await budget.ensureAvailable();
    await budget.recordUsd(0.006);
    await expect(budget.ensureAvailable()).rejects.toMatchObject({ name: 'BudgetExceededError' });
  });
});
