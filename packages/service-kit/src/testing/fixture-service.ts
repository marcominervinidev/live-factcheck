// Minimal service used by lifecycle.test.ts, started as a real child process.
import { z } from 'zod';

import { baseConfigSchema } from '../config.js';
import { runService } from '../lifecycle.js';

await runService({
  name: 'fixture',
  configSchema: baseConfigSchema.extend({ FIXTURE_API_KEY: z.string().min(1) }),
  secretKeys: ['FIXTURE_API_KEY'],
  start: ({ config, logger }) => {
    // Simulates a careless log statement; redaction must still hide the key.
    logger.info({ config }, 'fixture configured');
    return Promise.resolve({
      readiness: [],
      stop: () => {
        logger.info('fixture stopped');
        return Promise.resolve();
      },
    });
  },
});
