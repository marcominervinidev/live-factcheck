import { destination, pino, stdTimeFunctions } from 'pino';
import type { DestinationStream, Level, Logger } from 'pino';

export type { Logger } from 'pino';

export const REDACTED = '[REDACTED]';

/** Field names that always hold secrets, at the top level or one level deep. */
const SECRET_FIELDS = ['apiKey', 'password', 'token', 'secret', 'authorization', 'cookie'] as const;

// Values shorter than this are too likely to appear by coincidence to be scrubbed.
const MIN_SCRUB_LENGTH = 8;

export interface CreateLoggerOptions {
  readonly service: string;
  readonly level: Level;
  /** Config keys holding secrets; fields with these names are redacted. */
  readonly secretKeys?: readonly string[];
  /** Resolved secret values; any occurrence in a log line is replaced. */
  readonly secretValues?: readonly string[];
  /** Defaults to stdout (brief 4.1 factor XI). */
  readonly destination?: DestinationStream;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * JSON logger on stdout with two layers of secret protection (brief 15.1):
 * 1. field redaction by name (`redact`),
 * 2. scrubbing of known secret values from every serialized line, which also covers
 *    secrets that end up in messages or error texts.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const fieldNames = [...SECRET_FIELDS, ...(options.secretKeys ?? [])];
  const paths = fieldNames.flatMap((name) => [name, `*.${name}`, `*.headers.${name}`]);

  const scrubbable = (options.secretValues ?? []).filter(
    (value) => value.length >= MIN_SCRUB_LENGTH,
  );
  // JSON escaping may change a value (quotes, backslashes), so match both forms.
  const patterns = scrubbable.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]);
  const scrub =
    patterns.length === 0
      ? undefined
      : new RegExp([...new Set(patterns)].map(escapeForRegExp).join('|'), 'g');

  return pino(
    {
      level: options.level,
      base: { service: options.service },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths, censor: REDACTED },
      ...(scrub === undefined
        ? {}
        : { hooks: { streamWrite: (line: string) => line.replace(scrub, REDACTED) } }),
    },
    options.destination ?? destination({ dest: 1, sync: true }),
  );
}
