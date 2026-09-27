import { randomBytes } from 'node:crypto';

import type { ClaimChecked, ClaimExplained } from '@lfc/contracts';
import { ClaimExplained as ClaimExplainedSchema, Explanation } from '@lfc/contracts';
import type { DailyBudget, LlmProvider, MockLlmHandler, PromptTemplate } from '@lfc/providers';
import { BudgetExceededError, LlmError, renderPrompt } from '@lfc/providers';
import { z } from 'zod';

export const ExplanationAnswer = z.strictObject({ explanation: Explanation });

export interface ExplainDeps {
  readonly llm: LlmProvider;
  readonly prompt: PromptTemplate;
  /** Present when the LLM is a cloud model (brief 15.5). */
  readonly budget?: DailyBudget;
}

export type ExplainOutcome =
  | { readonly ok: true; readonly event: ClaimExplained }
  | {
      readonly ok: false;
      readonly reason: 'budget_exceeded' | 'invalid_llm_output' | 'refused' | 'provider_error';
    };

/**
 * Explains one verdict in at most two German sentences (brief 6a, ADR 0009), based only on the
 * evidence. The claim and snippets are data inside a tag with a random suffix per request.
 * A failure produces no event: the card keeps its placeholder.
 */
export async function explain(
  checked: ClaimChecked,
  deps: ExplainDeps,
  signal?: AbortSignal,
): Promise<ExplainOutcome> {
  try {
    await deps.budget?.ensureAvailable();
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, reason: 'budget_exceeded' };
    throw error;
  }
  const data = JSON.stringify(
    {
      behauptung: checked.claim,
      belege: checked.evidence.map((e) => ({
        herausgeber: e.publisher,
        stufe: e.tier,
        auszug: e.snippet,
      })),
      ...(checked.existingFactCheck === undefined
        ? {}
        : {
            bestehenderFaktencheck: {
              herausgeber: checked.existingFactCheck.publisher,
              bewertung: checked.existingFactCheck.rating,
            },
          }),
    },
    null,
    2,
  );
  try {
    const result = await deps.llm.generateStructured(
      {
        task: 'explanation',
        system: deps.prompt.system,
        user: renderPrompt(deps.prompt.user, {
          verdict: checked.verdict,
          confidenceLevel: checked.confidenceLevel,
          reason: checked.reason ?? '–',
          nonce: randomBytes(8).toString('hex'),
          data,
        }),
        schema: ExplanationAnswer,
        maxTokens: 400,
      },
      signal === undefined ? {} : { signal },
    );
    await deps.budget?.record(result.model, result.usage);
    return {
      ok: true,
      event: ClaimExplainedSchema.parse({
        schemaVersion: 1,
        sessionId: checked.sessionId,
        claimId: checked.claimId,
        explanation: result.value.explanation,
        provider: { llm: result.provider, model: result.model.slice(0, 128) },
      }),
    };
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    await deps.budget?.record(deps.llm.model, error.usage);
    return {
      ok: false,
      reason: error.kind === 'invalid_output' ? 'invalid_llm_output' : error.kind,
    };
  }
}

const VERDICT_TEXT: Readonly<Record<string, string>> = {
  stimmt: 'stimmt',
  groesstenteils_richtig: 'ist größtenteils richtig',
  uebertrieben: 'ist übertrieben',
  falsch: 'ist falsch',
  nicht_pruefbar: 'ließ sich nicht prüfen',
};

/** Deterministic explanation for `EXPLAINER_LLM_PROVIDER=mock` (tests and CI only). */
export const mockExplanation: MockLlmHandler = (request) => {
  const verdict = /^Urteil: (\S+)$/m.exec(request.user)?.[1] ?? 'nicht_pruefbar';
  return {
    explanation: `Testerklärung: Die Behauptung ${VERDICT_TEXT[verdict] ?? 'ließ sich nicht prüfen'}.`,
  };
};
