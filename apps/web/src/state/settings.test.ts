import { afterEach, describe, expect, it, vi } from 'vitest';

describe('settings store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    window.localStorage.clear();
  });

  const load = async () => (await import('./settings')).useSettings;

  it('restores the token from localStorage and keeps it trimmed', async () => {
    window.localStorage.setItem('lfc.gatewayToken', 'saved-token');
    const useSettings = await load();
    expect(useSettings.getState().token).toBe('saved-token');

    useSettings.getState().setToken('  new-token  ');
    expect(window.localStorage.getItem('lfc.gatewayToken')).toBe('new-token');
    useSettings.getState().clearToken();
    expect(window.localStorage.getItem('lfc.gatewayToken')).toBeNull();
    expect(useSettings.getState().token).toBeNull();
  });

  it('works in memory when storage is blocked (private mode)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const useSettings = await load();
    expect(useSettings.getState().token).toBeNull();
    useSettings.getState().setToken('memory-only');
    expect(useSettings.getState().token).toBe('memory-only');
  });
});
