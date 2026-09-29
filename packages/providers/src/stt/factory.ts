import { createAssemblyAiProvider } from './assemblyai.js';
import type { SttConfig } from './config.js';
import { createDeepgramProvider } from './deepgram.js';
import { createLocalSttProvider } from './local.js';
import { createMockSttProvider } from './mock.js';
import type { SttProvider } from './types.js';

/** Test seam only: WebSocket origins of fake provider servers. Production uses the region hosts. */
export interface CreateSttOptions {
  readonly deepgramHost?: string;
  readonly assemblyAiHost?: string;
}

/**
 * The provider for `STT_PROVIDER` (brief 10, ADR 0016). Call after `checkSttConfig` validated
 * the config; a missing key or URL here is a programming error.
 */
export function createSttProvider(config: SttConfig, options: CreateSttOptions = {}): SttProvider {
  switch (config.STT_PROVIDER) {
    case 'deepgram': {
      const key = config.DEEPGRAM_API_KEY;
      if (key === undefined) throw new Error('DEEPGRAM_API_KEY is required for deepgram');
      return createDeepgramProvider({ ...config, DEEPGRAM_API_KEY: key }, options.deepgramHost);
    }
    case 'assemblyai': {
      const key = config.ASSEMBLYAI_API_KEY;
      if (key === undefined) throw new Error('ASSEMBLYAI_API_KEY is required for assemblyai');
      return createAssemblyAiProvider(
        { ...config, ASSEMBLYAI_API_KEY: key },
        options.assemblyAiHost,
      );
    }
    case 'local': {
      const url = config.LOCAL_STT_URL;
      if (url === undefined) throw new Error('LOCAL_STT_URL is required for local');
      return createLocalSttProvider({ ...config, LOCAL_STT_URL: url });
    }
    case 'mock':
      return createMockSttProvider(config.STT_MODEL);
  }
}
