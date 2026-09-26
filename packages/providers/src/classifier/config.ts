import { z } from 'zod';

/** Classifier providers per brief 8.1 / ADR 0007; `local-model` may follow in phase 7. */
export const CLASSIFIER_PROVIDERS = ['llm', 'typesafe', 'mock'] as const;
export type ClassifierProviderName = (typeof CLASSIFIER_PROVIDERS)[number];

/** Tasks with their own classifier config. `DETECTOR` (claim-extractor) follows in phase 2. */
export type ClassifierTask = 'CHECKER';

/** Jev's API key is shared by every task that uses `typesafe`. */
export const TYPESAFE_API_KEY = 'TYPESAFE_API_KEY';

interface Keys<T extends ClassifierTask> {
  provider: `${T}_CLASSIFIER_PROVIDER`;
  model: `${T}_CLASSIFIER_MODEL`;
  high: `${T}_CONFIDENCE_HIGH`;
  low: `${T}_CONFIDENCE_LOW`;
}

const providerField = () => z.enum(CLASSIFIER_PROVIDERS);
const modelField = () => z.string().min(1).optional();
// Starting thresholds from ADR 0007, tuned per task with the eval (brief 13.5).
const highField = () => z.coerce.number().gt(0).lt(1).default(0.75);
const lowField = () => z.coerce.number().gt(0).lt(1).default(0.45);
const apiKeyField = () => z.string().min(1).optional();

export type ClassifierConfigShape<T extends ClassifierTask> = Record<
  Keys<T>['provider'],
  ReturnType<typeof providerField>
> &
  Record<Keys<T>['model'], ReturnType<typeof modelField>> &
  Record<Keys<T>['high'], ReturnType<typeof highField>> &
  Record<Keys<T>['low'], ReturnType<typeof lowField>> &
  Record<typeof TYPESAFE_API_KEY, ReturnType<typeof apiKeyField>>;

export type ClassifierConfig<T extends ClassifierTask> = z.infer<
  z.ZodObject<ClassifierConfigShape<T>>
>;

function keys<T extends ClassifierTask>(task: T): Keys<T> {
  return {
    provider: `${task}_CLASSIFIER_PROVIDER`,
    model: `${task}_CLASSIFIER_MODEL`,
    high: `${task}_CONFIDENCE_HIGH`,
    low: `${task}_CONFIDENCE_LOW`,
  };
}

/**
 * Env fields `<TASK>_CLASSIFIER_{PROVIDER,MODEL}`, `<TASK>_CONFIDENCE_{HIGH,LOW}` and
 * `TYPESAFE_API_KEY`. The `llm` classifier uses the task's `<TASK>_LLM_*` settings.
 */
export function classifierConfigShape<T extends ClassifierTask>(task: T): ClassifierConfigShape<T> {
  const k = keys(task);
  // Computed template-literal keys widen to `string`; the mapped type restores them.
  return {
    [k.provider]: providerField(),
    [k.model]: modelField(),
    [k.high]: highField(),
    [k.low]: lowField(),
    [TYPESAFE_API_KEY]: apiKeyField(),
  } as ClassifierConfigShape<T>;
}

/**
 * Cross-field rules for `superRefine`: `typesafe` needs a pinned model and the API key
 * (ADR 0007), and the high threshold must be above the low one.
 */
export function checkClassifierConfig<T extends ClassifierTask>(task: T) {
  const k = keys(task);
  return (config: ClassifierConfig<T>, ctx: z.RefinementCtx): void => {
    // Same generic-index limitation as in llm/config.ts; zod has validated every field.
    const values = config as Record<string, unknown>;
    if (values[k.provider] === 'typesafe') {
      if (values[k.model] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [k.model],
          message: `required when ${k.provider}=typesafe (pin a version such as jev-1.13.0)`,
        });
      }
      if (values[TYPESAFE_API_KEY] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [TYPESAFE_API_KEY],
          message: `required when ${k.provider}=typesafe`,
        });
      }
    }
    if ((values[k.high] as number) <= (values[k.low] as number)) {
      ctx.addIssue({
        code: 'custom',
        path: [k.high],
        message: `must be greater than ${k.low}`,
      });
    }
  };
}

/** What may be logged at startup: provider, model and thresholds. Never the key. */
export function describeClassifierConfig<T extends ClassifierTask>(
  task: T,
  config: ClassifierConfig<T>,
): { provider: ClassifierProviderName; model?: string; high: number; low: number } {
  const k = keys(task);
  const values = config as Record<string, unknown>;
  const model = values[k.model] as string | undefined;
  return {
    provider: values[k.provider] as ClassifierProviderName,
    ...(model === undefined ? {} : { model }),
    high: values[k.high] as number,
    low: values[k.low] as number,
  };
}
