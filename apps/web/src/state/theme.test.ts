import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { matches: boolean }) => void;

/** A fake `matchMedia` for the dark-scheme query: the test flips `matches` and fires `change`. */
function fakeSystem(dark: boolean) {
  const listeners: Listener[] = [];
  const query = {
    matches: dark,
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    switchTo(theme: 'light' | 'dark') {
      query.matches = theme === 'dark';
      listeners.forEach((listener) => {
        listener({ matches: query.matches });
      });
    },
  };
}

describe('theme store (T6.5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    window.localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  const load = async () => (await import('./theme')).useTheme;

  it('follows the system at first and keeps following it until the user chooses', async () => {
    const system = fakeSystem(true);
    const useTheme = await load();
    expect(useTheme.getState()).toMatchObject({ preference: 'system', theme: 'dark' });
    expect(document.documentElement.dataset['theme']).toBe('dark');

    system.switchTo('light');
    expect(useTheme.getState().theme).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('pins the opposite theme on toggle, remembers it and ignores the system from then on', async () => {
    const system = fakeSystem(false);
    const useTheme = await load();
    useTheme.getState().toggle();
    expect(useTheme.getState()).toMatchObject({ preference: 'dark', theme: 'dark' });
    expect(window.localStorage.getItem('lfc.theme')).toBe('dark');

    system.switchTo('light');
    expect(useTheme.getState().theme).toBe('dark');

    useTheme.getState().toggle();
    expect(window.localStorage.getItem('lfc.theme')).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('restores a stored choice and can go back to the system', async () => {
    window.localStorage.setItem('lfc.theme', 'dark');
    fakeSystem(false);
    const useTheme = await load();
    expect(useTheme.getState()).toMatchObject({ preference: 'dark', theme: 'dark' });

    useTheme.getState().setPreference('system');
    expect(useTheme.getState().theme).toBe('light');
    expect(window.localStorage.getItem('lfc.theme')).toBeNull();
  });

  it('works without matchMedia and with blocked storage (light, in memory)', async () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const useTheme = await load();
    expect(useTheme.getState().theme).toBe('light');
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe('dark');
  });
});
