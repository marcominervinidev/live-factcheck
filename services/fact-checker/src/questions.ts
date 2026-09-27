import { readFileSync } from 'node:fs';

import { VERDICTS } from '@lfc/contracts';
import { parse } from 'yaml';
import { z } from 'zod';

const Text = z.string().trim().min(1);

const QuestionsFile = z.strictObject({
  schemaVersion: z.literal(1),
  relevance: z.strictObject({
    /** Contains `{{id}}`, replaced by the snippet key. */
    instructions: Text.refine((value) => value.includes('{{id}}'), {
      message: 'must contain {{id}}',
    }),
    criteria: z.strictObject({ true: Text, false: Text }),
  }),
  sufficient: z.strictObject({
    instructions: Text,
    criteria: z.strictObject({ true: Text, false: Text }),
  }),
  verdict: z.strictObject({
    instructions: Text,
    options: z.strictObject(
      Object.fromEntries(VERDICTS.map((v) => [v, Text])) as Record<
        (typeof VERDICTS)[number],
        typeof Text
      >,
    ),
  }),
  best: z.strictObject({ instructions: Text }),
});

export type QuestionTexts = z.infer<typeof QuestionsFile>;

/** Loads `prompts/questions.yaml` at startup; a malformed file stops the service (fail fast). */
export function loadQuestionTexts(url: URL): QuestionTexts {
  return QuestionsFile.parse(parse(readFileSync(url, 'utf8')));
}
