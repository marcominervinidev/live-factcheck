// Claude Code (.mcp.json) and Antigravity (.agents/mcp_config.json) must offer the same MCP
// servers with the same launch commands (brief 1.4). Only the remote-server field names differ:
// Claude uses { type: "http", url }, Antigravity uses { serverUrl }.
import { readFileSync } from 'node:fs';

import type { JsonObject } from './json.ts';
import { object } from './json.ts';

function load(path: string): JsonObject {
  const { mcpServers } = object(JSON.parse(readFileSync(path, 'utf8')), path);
  return object(mcpServers, `${path}: mcpServers`);
}
const claude = load('.mcp.json');
const antigravity = load('.agents/mcp_config.json');

function normalize(value: unknown, what: string): string {
  const server = object(value, what);
  return JSON.stringify(
    'command' in server
      ? { command: server['command'], args: server['args'], env: server['env'] ?? {} }
      : { url: server['url'] ?? server['serverUrl'] },
  );
}

const problems: string[] = [];
const names = new Set([...Object.keys(claude), ...Object.keys(antigravity)]);
for (const name of names) {
  if (!(name in claude)) problems.push(`${name}: missing in .mcp.json`);
  else if (!(name in antigravity)) problems.push(`${name}: missing in .agents/mcp_config.json`);
  else if (normalize(claude[name], name) !== normalize(antigravity[name], name))
    problems.push(`${name}: launch config differs between the two files`);
}

if (problems.length > 0) {
  console.error(`MCP configs out of sync:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`MCP configs in sync: ${[...names].sort((a, b) => a.localeCompare(b)).join(', ')}`);
