import { z } from 'zod';

/** LLM providers per brief 8; `openai-compatible` covers LM Studio, Ollama and vLLM. */
export const LLM_PROVIDERS = ['anthropic', 'openai-compatible', 'mock'] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** Each LLM task has its own configuration (brief 8): extraction, verdict and explanation can differ. */
export type LlmTask = 'EXTRACTOR' | 'CHECKER' | 'EXPLAINER';

const providerField = () => z.enum(LLM_PROVIDERS);
const baseUrlField = () => z.url({ protocol: /^https?$/ }).optional();
const modelField = () => z.string().min(1);
const apiKeyField = () => z.string().min(1).optional();
// Per attempt; the SDKs retry 408/409/429/5xx and connection errors (brief 8: configurable).
const timeoutField = () => z.coerce.number().int().positive().default(30_000);
const retriesField = () => z.coerce.number().int().min(0).max(5).default(2);

interface Keys<T extends LlmTask> {
  provider: `${T}_LLM_PROVIDER`;
  baseUrl: `${T}_LLM_BASE_URL`;
  model: `${T}_LLM_MODEL`;
  apiKey: `${T}_LLM_API_KEY`;
  timeout: `${T}_LLM_TIMEOUT_MS`;
  retries: `${T}_LLM_MAX_RETRIES`;
}

export type LlmConfigShape<T extends LlmTask> = Record<
  Keys<T>['provider'],
  ReturnType<typeof providerField>
> &
  Record<Keys<T>['baseUrl'], ReturnType<typeof baseUrlField>> &
  Record<Keys<T>['model'], ReturnType<typeof modelField>> &
  Record<Keys<T>['apiKey'], ReturnType<typeof apiKeyField>> &
  Record<Keys<T>['timeout'], ReturnType<typeof timeoutField>> &
  Record<Keys<T>['retries'], ReturnType<typeof retriesField>>;

export type LlmConfig<T extends LlmTask> = z.infer<z.ZodObject<LlmConfigShape<T>>>;

function keys<T extends LlmTask>(task: T): Keys<T> {
  return {
    provider: `${task}_LLM_PROVIDER`,
    baseUrl: `${task}_LLM_BASE_URL`,
    model: `${task}_LLM_MODEL`,
    apiKey: `${task}_LLM_API_KEY`,
    timeout: `${task}_LLM_TIMEOUT_MS`,
    retries: `${task}_LLM_MAX_RETRIES`,
  };
}

/**
 * Env fields `<TASK>_LLM_{PROVIDER,BASE_URL,MODEL,API_KEY,TIMEOUT_MS,MAX_RETRIES}`.
 * Model names are never hard-coded.
 */
export function llmConfigShape<T extends LlmTask>(task: T): LlmConfigShape<T> {
  const k = keys(task);
  // Computed template-literal keys widen to `string`; the mapped type restores them.
  return {
    [k.provider]: providerField(),
    [k.baseUrl]: baseUrlField(),
    [k.model]: modelField(),
    [k.apiKey]: apiKeyField(),
    [k.timeout]: timeoutField(),
    [k.retries]: retriesField(),
  } as LlmConfigShape<T>;
}

/** The secret key of a task, for `secretKeys` (enables `<KEY>_FILE` and redaction). */
export function llmSecretKey<T extends LlmTask>(task: T): Keys<T>['apiKey'] {
  return keys(task).apiKey;
}

/**
 * Cross-field rules for `superRefine`: `anthropic` needs an API key, `openai-compatible`
 * needs a base URL (LM Studio/Ollama usually need no key), `mock` needs neither.
 */
export function checkLlmConfig<T extends LlmTask>(task: T) {
  const k = keys(task);
  return (config: LlmConfig<T>, ctx: z.RefinementCtx): void => {
    // TypeScript cannot index a generic mapped type by a generic key; zod has already
    // validated every field, so reading them through a record is safe.
    const values = config as Record<string, unknown>;
    const provider = values[k.provider] as LlmProviderName;
    if (provider === 'anthropic' && values[k.apiKey] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [k.apiKey],
        message: `required when ${k.provider}=anthropic`,
      });
    }
    if (provider === 'openai-compatible' && values[k.baseUrl] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [k.baseUrl],
        message: `required when ${k.provider}=openai-compatible`,
      });
    }
  };
}

/** What may be logged at startup: provider, model and the base URL's origin. Never the key. */
export function describeLlmConfig<T extends LlmTask>(
  task: T,
  config: LlmConfig<T>,
): { provider: LlmProviderName; model: string; baseUrl?: string } {
  const k = keys(task);
  const values = config as Record<string, unknown>;
  const baseUrl = values[k.baseUrl] as string | undefined;
  return {
    provider: values[k.provider] as LlmProviderName,
    model: values[k.model] as string,
    ...(baseUrl === undefined ? {} : { baseUrl: new URL(baseUrl).origin }),
  };
}

/** The validated settings of one task, read by the factory. */
export interface ResolvedLlmConfig {
  readonly provider: LlmProviderName;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export function resolveLlmConfig<T extends LlmTask>(
  task: T,
  config: LlmConfig<T>,
): ResolvedLlmConfig {
  const k = keys(task);
  const values = config as Record<string, unknown>;
  const baseUrl = values[k.baseUrl] as string | undefined;
  const apiKey = values[k.apiKey] as string | undefined;
  return {
    provider: values[k.provider] as LlmProviderName,
    model: values[k.model] as string,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(apiKey === undefined ? {} : { apiKey }),
    timeoutMs: values[k.timeout] as number,
    maxRetries: values[k.retries] as number,
  };
}
