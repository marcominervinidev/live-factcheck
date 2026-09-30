import { describe, expect, it } from 'vitest';

import { germanNumberWordsToDigits, parseGermanNumber } from './numbers.js';

describe('parseGermanNumber', () => {
  it.each([
    ['neunzehnhundertfünfundvierzig', 1945],
    ['neunzehnhundertsechzig', 1960],
    ['zweitausendvierundzwanzig', 2024],
    ['zweitausend', 2000],
    ['tausendneunhundertfünfundsechzig', 1965],
    ['einhundertzwölf', 112],
    ['hundert', 100],
    ['dreihundertvierzigtausend', 340_000],
    ['achtundsechzig', 68],
    ['dreißig', 30],
    ['dreissig', 30],
    ['sechzehn', 16],
    ['siebzehn', 17],
    ['einundzwanzig', 21],
    ['zwölf', 12],
    ['Neunzehnhundertfünfundvierzig', 1945],
  ])('reads %j as %d', (word, value) => {
    expect(parseGermanNumber(word)).toBe(value);
  });

  it.each([
    'Hundertjährige',
    'Tausende',
    'Neunziger',
    'und',
    'zig',
    'hunderthundert',
    'Weltkrieg',
    '',
  ])('is not a number: %j', (word) => {
    expect(parseGermanNumber(word)).toBeUndefined();
  });
});

describe('germanNumberWordsToDigits (live transcript)', () => {
  it.each([
    ['Der 2. Weltkrieg endete neunzehnhundertfünfundvierzig', 'Der 2. Weltkrieg endete 1945'],
    ['Der 2. Weltkrieg endete neunzehnhundertsechzig.', 'Der 2. Weltkrieg endete 1960.'],
    ['Im Jahr zweitausendvierundzwanzig, sagte er.', 'Im Jahr 2024, sagte er.'],
    ['Das kostet dreihundert Euro.', 'Das kostet 300 Euro.'],
    ['Es waren achtundsechzig Prozent.', 'Es waren 68 Prozent.'],
  ])('%j → %j', (input, output) => {
    expect(germanNumberWordsToDigits(input)).toBe(output);
  });

  it('keeps small numbers and articles as words, as written German does', () => {
    const text = 'Eine Frage an zwei Gäste: Hat einer von beiden zwölf Jahre gewartet?';
    expect(germanNumberWordsToDigits(text)).toBe(text);
  });

  it('leaves text without number words unchanged', () => {
    const text = 'Berlin hat ungefähr 3900000 Einwohner.';
    expect(germanNumberWordsToDigits(text)).toBe(text);
  });
});
