import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SourceTiersError, parseSourceTiers } from './source-tiers.js';

const REPO_FILE = new URL('../../../config/source-tiers.yaml', import.meta.url);

const valid = `
schemaVersion: 1
tiers:
  faktencheck: { weight: 1.0, domains: [correctiv.org] }
  amtlich: { weight: 0.9, domains: [bund.de] }
  referenz: { weight: 0.8, domains: [wikipedia.org] }
  presse: { weight: 0.6, domains: [zeit.de] }
  sonstige: { weight: 0.3, domains: [] }
`;

const issuesOf = (yamlText: string): readonly string[] => {
  try {
    parseSourceTiers(yamlText);
  } catch (error) {
    if (error instanceof SourceTiersError) return error.issues;
    throw error;
  }
  return [];
};

describe('source tiers', () => {
  it('accepts the committed config/source-tiers.yaml', () => {
    const tiers = parseSourceTiers(readFileSync(REPO_FILE, 'utf8'));
    expect(tiers.tiers.referenz.domains).toContain('wikipedia.org');
  });

  it('accepts a minimal valid file', () => {
    expect(issuesOf(valid)).toEqual([]);
  });

  it('rejects a domain listed in two tiers', () => {
    expect(issuesOf(valid.replace('[zeit.de]', '[zeit.de, bund.de]'))).toEqual([
      'tiers.presse.domains: bund.de is already listed in amtlich',
    ]);
  });

  it('rejects domains in the fallback tier', () => {
    expect(
      issuesOf(valid.replace('weight: 0.3, domains: []', 'weight: 0.3, domains: [x.de]')),
    ).toEqual([
      'tiers.sonstige.domains: sonstige is the fallback for unlisted domains and lists none',
    ]);
  });

  it('rejects URLs instead of domains, weights out of range and unknown tiers', () => {
    const issues = issuesOf(
      valid
        .replace('[correctiv.org]', '[https://correctiv.org/faktencheck]')
        .replace('weight: 0.9', 'weight: 1.5')
        .replace('  sonstige:', '  blogs: { weight: 0.1, domains: [] }\n  sonstige:'),
    );
    expect(issues.map((issue) => issue.split(':')[0])).toEqual([
      'tiers.faktencheck.domains.0',
      'tiers.amtlich.weight',
      'tiers',
    ]);
  });

  it('rejects a missing tier and a wrong schema version', () => {
    const issues = issuesOf(
      valid.replace('schemaVersion: 1', 'schemaVersion: 2').replace(/ {2}referenz:.*\n/, ''),
    );
    expect(issues.map((issue) => issue.split(':')[0])).toEqual(['schemaVersion', 'tiers.referenz']);
  });

  it('reports broken YAML as a clear error', () => {
    expect(issuesOf('tiers: [unclosed')[0]).toMatch(/^not valid YAML: /);
  });
});
