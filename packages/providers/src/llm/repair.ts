import type { z } from 'zod';

import type { StructuredRequest, TokenUsage } from './types.js';
import { LlmError, NO_USAGE, addUsage } from './types.js';

/** One raw model answer before validation. `text` is null when the model returned nothing usable. */
export interface RawAnswer {
  readonly text: string | null;
  readonly usage: TokenUsage;
}

const MAX_ISSUE_TEXT = 1_000;

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
    .slice(0, MAX_ISSUE_TEXT);
}

function validate<T>(
  schema: z.ZodType<T>,
  text: string | null,
): { value: T } | { problem: string } {
  if (text === null) {
    return { problem: 'The answer was empty or cut off.' };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { problem: 'The answer was not valid JSON.' };
  }
  const result = schema.safeParse(data);
  return result.success ? { value: result.data } : { problem: describeIssues(result.error) };
}

/**
 * Brief 8: validate every answer with zod; on failure make exactly one repair attempt that
 * includes the validation errors; if that fails too, throw `invalid_output` (callers turn it
 * into `nicht_pruefbar`). `ask` receives the extra user text for the repair attempt.
 */
export async function withOneRepair<T>(
  request: StructuredRequest<T>,
  ask: (repairNote: string | undefined) => Promise<RawAnswer>,
): Promise<{ value: T; usage: TokenUsage }> {
  let usage = NO_USAGE;
  const first = await ask(undefined);
  usage = addUsage(usage, first.usage);
  const firstCheck = validate(request.schema, first.text);
  if ('value' in firstCheck) {
    return { value: firstCheck.value, usage };
  }

  const note =
    `Your previous answer was rejected:\n${firstCheck.problem}\n` +
    'Answer again with a single JSON object that satisfies the schema exactly.';
  const second = await ask(note);
  usage = addUsage(usage, second.usage);
  const secondCheck = validate(request.schema, second.text);
  if ('value' in secondCheck) {
    return { value: secondCheck.value, usage };
  }
  throw new LlmError(
    'invalid_output',
    `${request.task}: invalid output after one repair attempt`,
    usage,
  );
}
