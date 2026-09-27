import { readFileSync } from 'node:fs';

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Renders a prompt template with `{{name}}` placeholders (brief 8: prompts are versioned files,
 * not strings in code). A missing or unused variable is an error, so a template and its caller
 * cannot drift apart silently.
 */
export function renderPrompt(
  template: string,
  variables: Readonly<Record<string, string>>,
): string {
  const used = new Set<string>();
  const rendered = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      throw new Error(`prompt variable {{${name}}} has no value`);
    }
    used.add(name);
    return value;
  });
  const unused = Object.keys(variables).filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new Error(`prompt variables not used by the template: ${unused.join(', ')}`);
  }
  return rendered;
}

/** A prompt file split into its system and user parts at the line `---user---`. */
export interface PromptTemplate {
  readonly system: string;
  readonly user: string;
}

const USER_MARKER = /^---user---$/m;

/** Loads a prompt file (read once at startup, fail fast if it is malformed). */
export function loadPromptTemplate(url: URL): PromptTemplate {
  const text = readFileSync(url, 'utf8');
  const parts = text.split(USER_MARKER);
  if (parts.length !== 2) {
    throw new Error(`${url.pathname}: expected exactly one ---user--- line`);
  }
  const [system = '', user = ''] = parts;
  return { system: system.trim(), user: user.trim() };
}
