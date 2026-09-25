import { describe, expect, it } from 'vitest';

import { REDACTED, createLogger } from './logger.js';

const SECRET = 'sk-ant-api03-test-0123456789abcdef';

function captureLogger(options: { secretKeys?: string[]; secretValues?: string[] }) {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'test',
    level: 'debug',
    ...options,
    destination: { write: (line: string) => lines.push(line) },
  });
  return { logger, lines };
}

describe('createLogger', () => {
  it('writes one JSON line per event with service, level label and ISO time', () => {
    const { logger, lines } = captureLogger({});
    logger.info({ sessionId: 's-1' }, 'hello');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(entry).toMatchObject({ service: 'test', level: 'info', msg: 'hello', sessionId: 's-1' });
    expect(typeof entry['time']).toBe('string');
  });

  it('never writes a configured secret, wherever it appears', () => {
    const { logger, lines } = captureLogger({
      secretKeys: ['ANTHROPIC_API_KEY'],
      secretValues: [SECRET],
    });

    logger.info({ ANTHROPIC_API_KEY: SECRET }, 'top-level field');
    logger.info({ config: { ANTHROPIC_API_KEY: SECRET } }, 'nested field');
    logger.info({ provider: { apiKey: SECRET } }, 'generic field name');
    logger.info({ req: { headers: { authorization: `Bearer ${SECRET}` } } }, 'header');
    logger.info(`message containing ${SECRET}`);
    logger.error({ err: new Error(`upstream said: invalid key ${SECRET}`) }, 'error text');
    logger.warn({ detail: `quoted "${SECRET}"` }, 'escaped value');

    expect(lines).toHaveLength(7);
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
    }
    expect(lines.join('')).toContain(REDACTED);
  });

  it('redacts known secret field names even without configured values', () => {
    const { logger, lines } = captureLogger({});
    logger.info({ db: { password: 'hunter2' } }, 'connect');
    expect(lines[0]).not.toContain('hunter2');
  });

  it('does not scrub short values that would match by coincidence', () => {
    const { logger, lines } = captureLogger({ secretValues: ['abc'] });
    logger.info('abc is fine here');
    expect(lines[0]).toContain('abc is fine here');
  });
});
