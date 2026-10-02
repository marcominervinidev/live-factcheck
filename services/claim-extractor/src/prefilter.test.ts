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
    // Rhetorical questions that insinuate a fact reach the classifier (owner decision 2026-09-30).
    'Denn waren es nicht Sie, der der Ampel ein Durchpeitschen vorgeworfen hat?',
    'Stimmt es nicht, dass die Arbeitslosigkeit gestiegen ist?',
    'Hat die Regierung nicht gerade erst die Steuern erhöht?',
    // Being a question is no reason to drop: only the classifier tells a rhetorical question
    // from a genuine one (owner decision 2026-10-02).
    'Wer hat denn die Mieten in Berlin verdoppelt?',
    'Wie hoch ist die Arbeitslosigkeit eigentlich gerade?',
    'Stimmt es, dass Berlin größer als Hamburg ist?',
    // A leading interrogative can open a claim (the detection set lost one this way).
    'Was uns empört, ist, dass die Mieten in Berlin explodiert sind.',
    // A filler opener does not drop a question either (owner decision 2026-10-02).
    'Also wer hat denn die Mieten in Berlin verdoppelt?',
    'Ja, aber wer hat das am Ende eigentlich bezahlt?',
  ])('passes %j', (text) => {
    expect(run(text)).toEqual({ pass: true });
  });

  it('treats a greeting word inside a sentence as content, not as a greeting', () => {
    expect(run('Der Kanzler sagte danke an alle Beteiligten im Saal.')).toEqual({ pass: true });
  });

  it.each([
    ['Das stimmt so nicht.', 'too_short'],
    ['  ', 'too_short'],
    ['Guten Abend und willkommen zur Diskussion.', 'greeting_or_filler'],
    ['Vielen Dank für die Einladung in diese Runde.', 'greeting_or_filler'],
    ['Das sehe ich anders, ich finde das Thema wichtig.', 'opinion_only'],
    ['Meiner Meinung nach macht die Regierung alles falsch.', 'opinion_only'],
    // Kept by owner decision 2026-10-02: filler openers and opinion markers without a fact
    // signal are still dropped; the conversation eval (plan E2) counts what that costs.
    ['Also die Mieten in Berlin sind explodiert.', 'greeting_or_filler'],
    ['Nein, die Regierung hat das Gesetz nie beschlossen.', 'greeting_or_filler'],
    ['Ich finde es absurd, dass Berlin eine kostenlose Kita hat.', 'opinion_only'],
    // A question is recognised by its question mark; without one the filler rule still applies.
    ['Also wer hat denn die Mieten in Berlin verdoppelt', 'greeting_or_filler'],
  ] as const)('drops %j as %s', (text, reason) => {
    expect(run(text)).toEqual({ pass: false, reason });
  });
});
