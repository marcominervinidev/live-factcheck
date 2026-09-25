import { z } from 'zod';
import { create } from 'zustand';

/**
 * Runtime configuration served by the web container as /config.json (brief 4.1, frontend
 * exception): generated from environment variables at container start, never baked into the
 * bundle and never containing secrets.
 */
export const RuntimeConfig = z.strictObject({
  gatewayUrl: z
    .string()
    .regex(/^(https?:\/\/[^/\s]+)?\/[^\s]*$/, 'Expected an absolute path or URL'),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

type State =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; config: RuntimeConfig }
  | { status: 'error'; reason: string };

interface RuntimeConfigStore {
  state: State;
  load: (fetchImpl?: typeof fetch) => Promise<void>;
}

export const useRuntimeConfig = create<RuntimeConfigStore>((set) => ({
  state: { status: 'idle' },
  load: async (fetchImpl = fetch) => {
    set({ state: { status: 'loading' } });
    try {
      const response = await fetchImpl('/config.json', { cache: 'no-store' });
      if (!response.ok) {
        set({ state: { status: 'error', reason: `HTTP ${String(response.status)}` } });
        return;
      }
      const parsed = RuntimeConfig.safeParse(await response.json());
      set({
        state: parsed.success
          ? { status: 'ready', config: parsed.data }
          : { status: 'error', reason: 'invalid config.json' },
      });
    } catch (error) {
      set({
        state: { status: 'error', reason: error instanceof Error ? error.message : 'unknown' },
      });
    }
  },
}));
