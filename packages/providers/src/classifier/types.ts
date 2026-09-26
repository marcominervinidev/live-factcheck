import type { TokenUsage } from '../llm/types.js';
import { NO_USAGE } from '../llm/types.js';
import type { ClassifierProviderName } from './config.js';

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** What the questions are asked about: text or structured data (brief 8.1). */
export type ClassifierState = string | Readonly<Record<string, JsonValue>> | readonly JsonValue[];

/** Pick one option. `options` maps an option key to its description (`null`: key says it all). */
export interface ChoiceQuestion<O extends string = string> {
  readonly type: 'choice';
  readonly instructions: string;
  readonly options: Readonly<Record<O, string | null>>;
}

/** Rate on ordered levels (2–10), lowest first. */
export interface ScoreQuestion {
  readonly type: 'score';
  readonly instructions: string;
  readonly levels: readonly [string, string, ...string[]];
}

/** Probability that a statement is true (Jev: `noul`). */
export interface BoolQuestion {
  readonly type: 'bool';
  readonly instructions: string;
  readonly criteria?: { readonly true: string; readonly false: string };
}

export type Question = ChoiceQuestion | ScoreQuestion | BoolQuestion;
export type Questions = Readonly<Record<string, Question>>;

export interface ChoiceAnswer<O extends string = string> {
  readonly type: 'choice';
  readonly choice: O;
  readonly probabilities: Readonly<Record<O, number>>;
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: 'score';
  /** Probability-weighted level index; can fall between levels. */
  readonly score: number;
  /** Keyed by level index as string: `"0"`, `"1"`, … */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface BoolAnswer {
  readonly type: 'bool';
  /** Probability that the statement is true. */
  readonly probability: number;
  readonly probabilities: { readonly true: number; readonly false: number };
  readonly confidence: number;
}

export type AnswerFor<Q extends Question> =
  Q extends ChoiceQuestion<infer O>
    ? ChoiceAnswer<O>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : BoolAnswer;

export type Answers<Q extends Questions> = { readonly [K in keyof Q]: AnswerFor<Q[K]> };

export interface ClassifierResult<Q extends Questions> {
  readonly answers: Answers<Q>;
  readonly usage: TokenUsage;
  /** The model that answered (Jev reports the versioned id). */
  readonly model: string;
  readonly provider: ClassifierProviderName;
}

export interface ClassifierProvider {
  readonly name: ClassifierProviderName;
  readonly model: string;
  /** Several questions per call, answered against the same state (ADR 0007). */
  ask<Q extends Questions>(
    state: ClassifierState,
    questions: Q,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ClassifierResult<Q>>;
}

export type ClassifierErrorKind =
  | 'invalid_output'
  | 'refused'
  | 'provider_error'
  /** State plus questions exceed the provider's context budget; the caller must send less. */
  | 'state_too_large';

/** A failed classification. Callers map it to `nicht_pruefbar` instead of crashing. */
export class ClassifierError extends Error {
  constructor(
    readonly kind: ClassifierErrorKind,
    message: string,
    readonly usage: TokenUsage = NO_USAGE,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ClassifierError';
  }
}
