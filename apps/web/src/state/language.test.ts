import { beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n';

import { useLanguage } from './language';

describe('language store (T6.6, ADR 0020)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLanguage.getState().setPreference('system');
  });

  it('follows the device until a choice is made, and the choice survives in storage', () => {
    // jsdom reports en-US as the device language.
    expect(useLanguage.getState().language).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    useLanguage.getState().setPreference('de');
    expect(useLanguage.getState().language).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(window.localStorage.getItem('lfc.language')).toBe('de');

    useLanguage.getState().setPreference('system');
    expect(window.localStorage.getItem('lfc.language')).toBeNull();
    expect(useLanguage.getState().language).toBe('en');
  });

  it('switches every t() text with the language', () => {
    useLanguage.getState().setPreference('de');
    expect(t('verdict.falsch')).toBe('Falsch');
    expect(t('verdict.uncertain', { verdict: t('verdict.stimmt') })).toBe('Unsicher: Stimmt');

    useLanguage.getState().setPreference('en');
    expect(t('verdict.falsch')).toBe('False');
    expect(t('verdict.uncertain', { verdict: t('verdict.stimmt') })).toBe('Uncertain: True');
  });

  it('keeps working when storage throws (private mode)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    useLanguage.getState().setPreference('en');
    expect(useLanguage.getState().language).toBe('en');
    spy.mockRestore();
  });
});
