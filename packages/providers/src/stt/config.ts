import { z } from 'zod';

import { isLocalEndpoint } from '../privacy.js';
import type { ExternalUse } from '../privacy.js';

/** Speech-to-text providers (brief 10, ADR 0016). Exchangeable by configuration only. */
export const STT_PROVIDERS = ['deepgram', 'assemblyai', 'local', 'mock'] as const;
export type SttProviderName = (typeof STT_PROVIDERS)[number];

/** EU endpoints are the default: audio is processed inside the EU (ADR 0016). */
export const STT_REGIONS = ['eu', 'us'] as const;

export const sttConfigShape = {
  STT_PROVIDER: z.enum(STT_PROVIDERS),
  /** e.g. `nova-3` (Deepgram), `universal-streaming-multilingual` (AssemblyAI), `small` (local). */
  STT_MODEL: z.string().min(1),
  STT_LANGUAGE: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
    .default('de'),
  STT_REGION: z.enum(STT_REGIONS).default('eu'),
  /** Secret. */
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  /** Secret. */
  ASSEMBLYAI_API_KEY: z.string().min(1).optional(),
  /** WebSocket of `stt-local`, e.g. `ws://stt-local:8000/v1/stream` or `ws://host.docker.internal:8000/v1/stream`. */
  LOCAL_STT_URL: z.url({ protocol: /^wss?$/ }).optional(),
  STT_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  /** Silence in ms after which a cloud provider closes an utterance (Deepgram `endpointing`). */
  STT_ENDPOINTING_MS: z.coerce.number().int().min(10).max(5_000).default(300),
};

export type SttConfig = z.infer<z.ZodObject<typeof sttConfigShape>>;

/** For `secretKeys`: enables `<KEY>_FILE` and log redaction. */
export const STT_SECRET_KEYS = ['DEEPGRAM_API_KEY', 'ASSEMBLYAI_API_KEY'] as const;

export function checkSttConfig(config: SttConfig, ctx: z.RefinementCtx): void {
  const require = (key: keyof SttConfig) => {
    if (config[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `required when STT_PROVIDER=${config.STT_PROVIDER}`,
      });
    }
  };
  switch (config.STT_PROVIDER) {
    case 'deepgram':
      require('DEEPGRAM_API_KEY');
      break;
    case 'assemblyai':
      require('ASSEMBLYAI_API_KEY');
      break;
    case 'local':
      require('LOCAL_STT_URL');
      break;
    case 'mock':
      break;
  }
}

/** Whether the configured provider sends audio outside the own network (brief 15.6). */
export function sttUse(config: SttConfig): ExternalUse {
  const setting = `STT_PROVIDER=${config.STT_PROVIDER}`;
  switch (config.STT_PROVIDER) {
    case 'mock':
      return { setting, cloud: false };
    case 'local':
      return {
        setting,
        cloud: config.LOCAL_STT_URL === undefined || !isLocalEndpoint(config.LOCAL_STT_URL),
      };
    case 'deepgram':
    case 'assemblyai':
      return { setting, cloud: true };
  }
}

/** For logs and the status page: never keys, only the origin of a local endpoint. */
export function describeSttConfig(config: SttConfig) {
  return {
    provider: config.STT_PROVIDER,
    model: config.STT_MODEL,
    language: config.STT_LANGUAGE,
    ...(config.STT_PROVIDER === 'deepgram' || config.STT_PROVIDER === 'assemblyai'
      ? { region: config.STT_REGION }
      : {}),
    ...(config.STT_PROVIDER === 'local' && config.LOCAL_STT_URL !== undefined
      ? { endpoint: new URL(config.LOCAL_STT_URL).origin }
      : {}),
  };
}
