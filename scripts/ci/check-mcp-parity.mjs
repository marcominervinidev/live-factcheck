// Claude Code (.mcp.json) and Antigravity (.agents/mcp_config.json) must offer the same MCP
// servers with the same launch commands (brief 1.4). Only the remote-server field names differ:
// Claude uses { type: "http", url }, Antigravity uses { serverUrl }.
import { readFileSync } from 'node:fs';

const load = (path) => JSON.parse(readFileSync(path, 'utf8')).mcpServers;
const claude = load('.mcp.json');
const antigravity = load('.agents/mcp_config.json');

const normalize = (server) =>
  'command' in server
    ? { command: server.command, args: server.args, env: server.env ?? {} }
    : { url: server.url ?? server.serverUrl };

const problems = [];
const names = new Set([...Object.keys(claude), ...Object.keys(antigravity)]);
for (const name of names) {
  if (!(name in claude)) problems.push(`${name}: missing in .mcp.json`);
  else if (!(name in antigravity)) problems.push(`${name}: missing in .agents/mcp_config.json`);
  else if (JSON.stringify(normalize(claude[name])) !== JSON.stringify(normalize(antigravity[name])))
    problems.push(`${name}: launch config differs between the two files`);
}

if (problems.length > 0) {
  console.error(`MCP configs out of sync:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`MCP configs in sync: ${[...names].sort().join(', ')}`);
