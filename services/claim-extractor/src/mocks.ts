// Deterministic stand-ins for the classifier and the LLM when the stack runs with
// `DETECTOR_CLASSIFIER_PROVIDER=mock` and `EXTRACTOR_LLM_PROVIDER=mock` (CI, stage 3/4): a segment
// with a number is a checkworthy claim, the standalone wording is the segment itself.
import type { MockClassifierHandler, MockLlmHandler, RawAnswer } from '@lfc/providers';
import { normalizeClaimText } from '@lfc/service-kit';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function newestText(state: unknown): string {
  if (!isRecord(state) || !isRecord(state['neu'])) return '';
  const text = state['neu']['text'];
  return typeof text === 'string' ? text : '';
}

export const mockDetector: MockClassifierHandler = (state, questions) => {
  const answers: Record<string, RawAnswer> = {};
  if ('same' in questions && isRecord(state)) {
    const [a, b] = [state['a'], state['b']];
    const same =
      typeof a === 'string' &&
      typeof b === 'string' &&
      normalizeClaimText(a) === normalizeClaimText(b);
    answers['same'] = same ? 0.97 : 0.03;
    return answers;
  }
  const claim = /\d/.test(newestText(state));
  answers['claim'] = claim ? 0.97 : 0.03;
  // Level 4 of 5 ("wichtig") for every claim.
  answers['checkworthiness'] = { '0': 0, '1': 0, '2': 0, '3': 1, '4': 0 };
  return answers;
};

/** The newest segment's text from the JSON between the data tags of the prompt. */
function newestTextOfPrompt(user: string): string {
  // The block whose tags stand on their own lines; the prompt's intro sentence names the tags too.
  const match = /^<daten-([0-9a-f]+)>\n([\s\S]*?)\n<\/daten-\1>$/m.exec(user);
  try {
    return newestText(JSON.parse(match?.[2] ?? '{}'));
  } catch {
    return '';
  }
}

export const mockStandalone: MockLlmHandler = (request) => {
  const text = newestTextOfPrompt(request.user);
  return { standaloneText: text, originalText: text };
};
