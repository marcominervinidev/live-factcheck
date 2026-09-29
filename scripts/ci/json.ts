// Runtime checks for JSON the CI scripts read (pnpm output, package manifests, GitHub API
// answers). An unexpected shape fails the step with a clear message instead of producing an
// empty matrix or a broken link.
import { appendFileSync } from 'node:fs';

export type JsonObject = Readonly<Record<string, unknown>>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function object(value: unknown, what: string): JsonObject {
  if (!isObject(value)) throw new TypeError(`${what}: expected an object`);
  return value;
}

export function array(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${what}: expected an array`);
  return value as readonly unknown[];
}

export function string(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new TypeError(`${what}: expected a string`);
  return value;
}

export function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${what}: expected a number`);
  }
  return value;
}

export function boolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${what}: expected a boolean`);
  return value;
}

/** Writes `key=value` to $GITHUB_OUTPUT (in CI) and stdout. */
export function output(key: string, value: unknown): void {
  const line = `${key}=${JSON.stringify(value)}\n`;
  const file = process.env['GITHUB_OUTPUT'];
  if (file !== undefined && file !== '') appendFileSync(file, line);
  process.stdout.write(line);
}
