import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { loadPromptTemplate, renderPrompt } from './prompt.js';

describe('renderPrompt', () => {
  it('fills every placeholder, also with spaces inside the braces', () => {
    expect(
      renderPrompt('Claim: {{claim}} / {{ verdict }}', { claim: 'A', verdict: 'falsch' }),
    ).toBe('Claim: A / falsch');
  });

  it('does not interpret placeholders inside inserted values (no template injection)', () => {
    expect(renderPrompt('{{claim}}', { claim: '{{verdict}}' })).toBe('{{verdict}}');
  });

  it('fails on a missing value and on unused variables', () => {
    expect(() => renderPrompt('{{claim}} {{evidence}}', { claim: 'A' })).toThrow(
      'prompt variable {{evidence}} has no value',
    );
    expect(() => renderPrompt('{{claim}}', { claim: 'A', extra: 'B' })).toThrow(
      'prompt variables not used by the template: extra',
    );
  });
});

describe('loadPromptTemplate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lfc-prompt-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const file = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return pathToFileURL(path);
  };

  it('splits the file into system and user part', () => {
    const url = file('ok.md', 'You are a judge.\n\n---user---\n\nClaim: {{claim}}\n');
    expect(loadPromptTemplate(url)).toEqual({
      system: 'You are a judge.',
      user: 'Claim: {{claim}}',
    });
  });

  it('rejects a file without or with two user markers', () => {
    expect(() => loadPromptTemplate(file('none.md', 'only system'))).toThrow('---user---');
    expect(() => loadPromptTemplate(file('two.md', 'a\n---user---\nb\n---user---\nc'))).toThrow(
      '---user---',
    );
  });
});
