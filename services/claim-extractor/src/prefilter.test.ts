import { describe, expect, it } from 'vitest';

import { prefilter } from './prefilter.js';

const run = (text: string) => prefilter(text, { minWords: 5 });

describe('prefilter (ADR 0017)', () => {
  it.each([
    'Der Zweite Weltkrieg endete im Jahr 1965.',
    'Berlin hat ungefähr drei Komma neun Millionen Einwohner.',
    'Die Arbeitslosigkeit ist seit 2020 um die Hälfte gesunken.',
    'Deutschland exportiert mehr als China und die USA zusammen.',
    // An opinion marker with a fact inside stays: the classifier decides.
    'Ich glaube, die Rente liegt im Schnitt bei 800 Euro.',
    // A greeting that carries a number stays too.
    'Guten Abend, heute sind 30 Millionen Menschen zugeschaltet.',
    // No fact signal, no marker: the classifier decides.
    'Die Mondlandung wurde in einem Filmstudio gedreht.',
  ])('passes %j', (text) => {
    expect(run(text)).toEqual({ pass: true });
  });

  it.each([
    'Wer',
    'Wen',
    'Wem',
    'Wessen',
    'Was',
    'Wann',
    'Wo',
    'Woher',
    'Wohin',
    'Warum',
    'Wieso',
    'Weshalb',
    'Wie',
    'Welche',
    'Welcher',
    'Welches',
    'Welchen',
    'Welchem',
  ])('drops a question starting with %j even without a question mark', (word) => {
    expect(run(`${word} hat das damals eigentlich entschieden`)).toEqual({
      pass: false,
      reason: 'question',
    });
  });

  it('treats a greeting word inside a sentence as content, not as a greeting', () => {
    expect(run('Der Kanzler sagte danke an alle Beteiligten im Saal.')).toEqual({ pass: true });
  });

  it.each([
    ['Das stimmt so nicht.', 'too_short'],
    ['  ', 'too_short'],
    ['Wie hoch ist die Arbeitslosigkeit eigentlich gerade?', 'question'],
    ['Warum sollten wir das überhaupt glauben', 'question'],
    ['Stimmt es, dass Berlin größer als Hamburg ist?', 'question'],
    ['Guten Abend und willkommen zur Diskussion.', 'greeting_or_filler'],
    ['Vielen Dank für die Einladung in diese Runde.', 'greeting_or_filler'],
    ['Das sehe ich anders, ich finde das Thema wichtig.', 'opinion_only'],
    ['Meiner Meinung nach macht die Regierung alles falsch.', 'opinion_only'],
  ] as const)('drops %j as %s', (text, reason) => {
    expect(run(text)).toEqual({ pass: false, reason });
  });
});
