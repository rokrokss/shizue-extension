// What the bridge's programs share. Claude Code starts mcp.mjs, Chrome starts host.mjs, and the two
// meet on a Unix socket; the extension's side is src/services/background/nativeBridge.ts.
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const HOST_NAME = 'net.shizue.bridge';

// The name the page's pill and cards give the agent, from the clientInfo it sends when it starts
// the MCP server: the known ones as people call them, any other as it calls itself.
const KNOWN_AGENTS = [
  [/claude[-_ ]?code/i, 'Claude Code'],
  [/codex/i, 'Codex'],
  [/gemini/i, 'Gemini CLI'],
  [/cursor/i, 'Cursor'],
  [/windsurf|codeium/i, 'Windsurf'],
  [/copilot/i, 'GitHub Copilot'],
  [/visual studio code|vscode/i, 'VS Code'],
  [/claude/i, 'Claude'],
];
const MAX_AGENT_NAME = 40;

export const agentName = (clientInfo) => {
  const name = typeof clientInfo?.name === 'string' ? clientInfo.name : '';
  const known = KNOWN_AGENTS.find(([pattern]) => pattern.test(name));
  if (known) return known[1];
  const own = name.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  return own ? own.slice(0, MAX_AGENT_NAME) : undefined;
};

// Chrome refuses a larger message from a host.
export const MAX_MESSAGE_TO_CHROME = 1024 * 1024;

// Chrome's native messages: their length in 4 bytes, then the JSON.
export const encodeFrame = (message) => {
  const body = Buffer.from(JSON.stringify(message));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
};

export const frameDecoder = (onMessage) => {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const end = 4 + buffered.readUInt32LE(0);
      if (buffered.length < end) return;
      onMessage(JSON.parse(buffered.subarray(4, end).toString()));
      buffered = buffered.subarray(end);
    }
  };
};

// The socket and MCP's stdio: one JSON message a line.
export const lineDecoder = (onMessage) => {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (let end; (end = buffered.indexOf(10)) !== -1; buffered = buffered.subarray(end + 1)) {
      const line = buffered.subarray(0, end).toString().trim();
      if (line) onMessage(JSON.parse(line));
    }
  };
};

// Whoever reaches this socket can work the user's signed-in browser, so its folder must be this
// user's alone. /tmp keeps the path under the socket length limit, and anyone can create folders
// there, so one that is already there is checked rather than trusted.
export const bridgeSocket = () => {
  const directory = process.env.SHIZUE_BRIDGE_DIR ?? `/tmp/shizue-bridge-${process.getuid()}`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const found = lstatSync(directory);
  if (!found.isDirectory() || found.uid !== process.getuid() || (found.mode & 0o077) !== 0) {
    throw new Error(`${directory} must be a folder only this user can open.`);
  }
  return join(directory, 'bridge.sock');
};
