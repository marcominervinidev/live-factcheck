import { describe, expect, it } from 'vitest';

import de from './de.json';
import en from './en.json';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n catalogues (T6.6, ADR 0020)', () => {
  it('both languages carry exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });

  it('every key uses the same placeholders in both languages', () => {
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect({ key, params: placeholders(en[key]) }).toEqual({
        key,
        params: placeholders(de[key]),
      });
    }
  });

  it('no catalogue entry is empty or whitespace', () => {
    for (const [key, value] of [...Object.entries(de), ...Object.entries(en)]) {
      expect({ key, empty: value.trim() === '' }).toEqual({ key, empty: false });
    }
  });
});
