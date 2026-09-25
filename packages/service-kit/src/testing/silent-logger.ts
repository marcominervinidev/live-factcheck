import { createLogger } from '../logger.js';

/** Logger that discards every line; for tests that do not assert on logs. */
export function silentLogger() {
  return createLogger({ service: 'test', level: 'warn', destination: { write: () => undefined } });
}
