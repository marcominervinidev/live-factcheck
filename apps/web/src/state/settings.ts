import { create } from 'zustand';

const STORAGE_KEY = 'lfc.gatewayToken';

/** localStorage can be missing or throw (private mode, blocked storage); the app still works. */
function readToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Kept in memory for this tab only.
  }
}

interface SettingsStore {
  /** The gateway token (ADR 0011); only ever sent in the Authorization header or the WS auth message. */
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export const useSettings = create<SettingsStore>((set) => ({
  token: readToken(),
  setToken: (token) => {
    const trimmed = token.trim();
    writeToken(trimmed);
    set({ token: trimmed });
  },
  clearToken: () => {
    writeToken(null);
    set({ token: null });
  },
}));
