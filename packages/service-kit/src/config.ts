import { readFileSync } from 'node:fs';

import { z } from 'zod';

/** Settings every service shares (brief 4.1 factor VII, XI). */
export const baseConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;

/** Invalid or missing configuration. Messages name the variable, never its value. */
export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions<Key extends string> {
  /** Variables that may also be given as `<KEY>_FILE` and must never be logged. */
  readonly secretKeys: readonly Key[];
  readonly env?: NodeJS.ProcessEnv;
}

export interface LoadedConfig<Config> {
  readonly config: Config;
  /** Resolved secret values, used by the logger to scrub accidental leaks. */
  readonly secretValues: readonly string[];
}

/**
 * Validates the environment against `schema` (fail fast, brief 4.1 factor III).
 * Secrets can be passed directly or as a file path in `<KEY>_FILE` (Compose/Kubernetes secrets).
 * An empty value (e.g. Compose `${VAR:-}` or an empty secret file) counts as "not set": optional
 * fields stay undefined and required fields fail with a clear message.
 */
export function loadConfig<Schema extends z.ZodObject>(
  schema: Schema,
  options: LoadConfigOptions<Extract<keyof z.infer<Schema>, string>>,
): LoadedConfig<z.infer<Schema>> {
  const env = options.env ?? process.env;
  const isSet = (value: string | undefined): value is string => value !== undefined && value !== '';
  const resolved: Record<string, string | undefined> = { ...env };
  const issues: string[] = [];
  const secretValues: string[] = [];

  for (const key of options.secretKeys) {
    const fileKey = `${key}_FILE`;
    const direct = env[key];
    const filePath = env[fileKey];

    if (isSet(direct) && isSet(filePath)) {
      issues.push(`${key}: set either ${key} or ${fileKey}, not both`);
      continue;
    }
    if (isSet(filePath)) {
      try {
        resolved[key] = readFileSync(filePath, 'utf8').trim();
      } catch {
        issues.push(`${fileKey}: cannot read secret file ${filePath}`);
        continue;
      }
    }
    const value = resolved[key];
    if (isSet(value)) {
      secretValues.push(value);
    }
  }

  for (const [key, value] of Object.entries(resolved)) {
    if (!isSet(value)) {
      resolved[key] = undefined;
    }
  }

  const result = schema.safeParse(resolved);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }
  if (issues.length > 0 || !result.success) {
    throw new ConfigError(issues);
  }
  return { config: result.data, secretValues };
}
