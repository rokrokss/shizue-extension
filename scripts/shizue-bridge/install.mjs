// Tells Chrome about the native host, the way Claude Code does for Claude in Chrome: a manifest in
// Chrome's folder, naming a launcher and the one extension that may start it. Any agent that runs
// a stdio MCP server can then start mcp.mjs.
//   node scripts/shizue-bridge/install.mjs --extension-id <the id chrome://extensions shows>
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HOST_NAME } from './protocol.mjs';

export const installHost = ({ extensionId, chromeDir, hostDir }) => {
  if (!/^[a-p]{32}$/.test(extensionId ?? '')) throw new Error('--extension-id must be a Chrome extension id.');
  mkdirSync(hostDir, { recursive: true });
  const launch = join(hostDir, 'launch');
  // Chrome starts it without the shell's PATH, so this names node itself.
  writeFileSync(launch, `#!/bin/sh\nexec "${process.execPath}" "${fileURLToPath(new URL('./host.mjs', import.meta.url))}"\n`);
  chmodSync(launch, 0o755);
  const manifests = join(chromeDir, 'NativeMessagingHosts');
  mkdirSync(manifests, { recursive: true });
  const manifest = join(manifests, `${HOST_NAME}.json`);
  writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        name: HOST_NAME,
        description: 'Shizue bridge for MCP agents',
        path: launch,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2
    )}\n`
  );
  return manifest;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { 'extension-id': { type: 'string' }, 'chrome-dir': { type: 'string' } },
  });
  const manifest = installHost({
    extensionId: values['extension-id'],
    chromeDir: values['chrome-dir'] ?? join(homedir(), 'Library/Application Support/Google/Chrome'),
    hostDir: join(homedir(), '.shizue/bridge-host'),
  });
  const server = fileURLToPath(new URL('./mcp.mjs', import.meta.url));
  console.log(`Wrote ${manifest}`);
  console.log('Restart Chrome, then add the server to your agent. Claude Code:');
  console.log(`claude mcp add shizue -- "${process.execPath}" "${server}"`);
  // Codex asks before each act, and with approval_policy "never" turns it down instead. Shizue
  // asks on the page itself before what may send, delete or pay.
  console.log('Codex, in ~/.codex/config.toml:');
  console.log('[mcp_servers.shizue]');
  console.log(`command = ${JSON.stringify(process.execPath)}`);
  console.log(`args = [${JSON.stringify(server)}]`);
  console.log('default_tools_approval_mode = "approve"');
  console.log('Gemini CLI, Cursor and other MCP agents: a stdio server named shizue, with');
  console.log(`  command: ${process.execPath}`);
  console.log(`  args: ["${server}"]`);
}
