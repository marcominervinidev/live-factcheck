// Configuration of `make llm-scan` (see README), validated before any git or model call.
import { checkLlmConfig, llmConfigShape, llmUse } from '@lfc/providers';
import { z } from 'zod';

export const Config = z
  .object({
    ...llmConfigShape('SCAN'),
    // No leading '-': the value goes to git and must never be read as an option.
    LLM_SCAN_BASE_REF: z
      .string()
      .regex(/^[\w.][\w./-]*$/)
      .default('origin/main'),
    // Small chunks: a 7B model on a laptop has a small context window.
    LLM_SCAN_MAX_CHARS: z.coerce.number().int().min(500).max(40_000).default(6_000),
  })
  .superRefine(checkLlmConfig('SCAN'))
  .superRefine((config, ctx) => {
    // ADR 0014: source code never goes to a cloud model (fails closed like PRIVACY_MODE=local).
    if (llmUse('SCAN', config).cloud) {
      ctx.addIssue({
        code: 'custom',
        path: ['SCAN_LLM_PROVIDER'],
        message: 'only a local model may read the source code (LM Studio/Ollama, ADR 0014)',
      });
    }
  });
