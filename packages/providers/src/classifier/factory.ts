import type { ConfidenceLevel } from '@lfc/contracts';

import type { LlmProvider } from '../llm/types.js';
import type { ClassifierConfig, ClassifierTask } from './config.js';
import { resolveClassifierConfig } from './config.js';
import { createLlmClassifier } from './llm.js';
import type { MockClassifierHandler } from './mock.js';
import { createMockClassifier } from './mock.js';
import { createTypeSafeClassifier } from './typesafe.js';
import type { ClassifierProvider } from './types.js';

export interface CreateClassifierOptions {
  /** The task's `LlmProvider`; used when the provider is `llm`. */
  readonly llm: LlmProvider;
  /** Answers for `provider=mock`; required only then. */
  readonly mock?: MockClassifierHandler;
}

/** Builds the configured classifier of a task (brief 8.1, ADR 0007). */
export function createClassifier<T extends ClassifierTask>(
  task: T,
  config: ClassifierConfig<T>,
  options: CreateClassifierOptions,
): ClassifierProvider {
  const resolved = resolveClassifierConfig(task, config);
  switch (resolved.provider) {
    case 'llm':
      return createLlmClassifier(options.llm);
    case 'typesafe': {
      if (resolved.apiKey === undefined || resolved.model === undefined) {
        // Unreachable after checkClassifierConfig; a guard instead of non-null assertions.
        throw new Error(`${task}_CLASSIFIER_PROVIDER=typesafe needs a model and TYPESAFE_API_KEY`);
      }
      return createTypeSafeClassifier({
        apiKey: resolved.apiKey,
        model: resolved.model,
        timeoutMs: resolved.timeoutMs,
        maxRetries: resolved.maxRetries,
      });
    }
    case 'mock': {
      if (options.mock === undefined) {
        throw new Error(`${task}_CLASSIFIER_PROVIDER=mock needs mock answers from the service`);
      }
      return createMockClassifier(resolved.model ?? 'mock', options.mock);
    }
  }
}

/** Confidence thresholds of a task (ADR 0007): ≥ high → hoch, ≥ low → mittel, else niedrig. */
export function confidenceLevel(
  confidence: number,
  thresholds: { readonly high: number; readonly low: number },
): ConfidenceLevel {
  if (confidence >= thresholds.high) return 'hoch';
  if (confidence >= thresholds.low) return 'mittel';
  return 'niedrig';
}
