import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import './zod-config';

describe('zod config', () => {
  it('runs without code generation so the strict CSP is never violated', () => {
    expect(z.config().jitless).toBe(true);
  });
});
