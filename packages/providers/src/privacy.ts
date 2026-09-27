import { isIP } from 'node:net';

import { z } from 'zod';

import type { ClassifierConfig, ClassifierTask } from './classifier/config.js';
import type { LlmConfig, LlmTask } from './llm/config.js';

/**
 * `local`: no data may leave the own network except search queries and page fetches
 * (brief 15.6). Every worker refuses to start if a configured provider would send data to a
 * cloud service (ADR 0007).
 */
export const PRIVACY_MODES = ['cloud', 'local'] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const privacyModeShape = { PRIVACY_MODE: z.enum(PRIVACY_MODES).default('cloud') };

/** One configured external dependency and whether it sends data outside the own network. */
export interface ExternalUse {
  /** The setting that selects it, e.g. `CHECKER_LLM_PROVIDER=anthropic`. Never a secret. */
  readonly setting: string;
  readonly cloud: boolean;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * True for endpoints on the Mac or the local network: `localhost`, `host.docker.internal`,
 * single-label hosts (Compose service names), `*.local`, private and loopback IPs.
 * Everything else counts as cloud, so an unknown host fails closed.
 */
export function isLocalEndpoint(url: string): boolean {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === 'host.docker.internal' || host.endsWith('.local')) {
    return true;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return PRIVATE_V4.some((range) => range.test(host));
  }
  if (ipVersion === 6) {
    return host === '::1' || /^f[cd]/.test(host);
  }
  return !host.includes('.');
}

/** How an LLM task's config uses the network. */
export function llmUse<T extends LlmTask>(task: T, config: LlmConfig<T>): ExternalUse {
  // Same generic-index limitation as in llm/config.ts; zod has validated every field.
  const values = config as Record<string, unknown>;
  const provider = values[`${task}_LLM_PROVIDER`] as string;
  const baseUrl = values[`${task}_LLM_BASE_URL`] as string | undefined;
  const setting = `${task}_LLM_PROVIDER=${provider}`;
  switch (provider) {
    case 'mock':
      return { setting, cloud: false };
    case 'openai-compatible':
      return { setting, cloud: baseUrl === undefined || !isLocalEndpoint(baseUrl) };
    default:
      return { setting, cloud: true };
  }
}

/** How a classifier task's config uses the network (the `llm` classifier is covered by `llmUse`). */
export function classifierUse<T extends ClassifierTask>(
  task: T,
  config: ClassifierConfig<T>,
): ExternalUse {
  const values = config as Record<string, unknown>;
  const provider = values[`${task}_CLASSIFIER_PROVIDER`] as string;
  return { setting: `${task}_CLASSIFIER_PROVIDER=${provider}`, cloud: provider === 'typesafe' };
}

/** `superRefine` rule: in `PRIVACY_MODE=local`, every cloud use is a config error. */
export function checkPrivacyMode<Config extends { PRIVACY_MODE: PrivacyMode }>(
  uses: (config: Config) => readonly ExternalUse[],
) {
  return (config: Config, ctx: z.RefinementCtx): void => {
    if (config.PRIVACY_MODE !== 'local') {
      return;
    }
    for (const use of uses(config)) {
      if (use.cloud) {
        ctx.addIssue({
          code: 'custom',
          path: ['PRIVACY_MODE'],
          message: `${use.setting} sends data to a cloud service; not allowed when PRIVACY_MODE=local`,
        });
      }
    }
  };
}
