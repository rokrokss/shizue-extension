// Tells Chrome about the native host, the way Claude Code does for Claude in Chrome: a manifest in
// Chrome's folder, naming a launcher and the one extension that may start it.
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
        description: 'Shizue bridge for Claude Code',
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
  console.log(`Wrote ${manifest}`);
  console.log('Restart Chrome, then add the server to Claude Code:');
  console.log(`claude mcp add shizue -- "${process.execPath}" "${fileURLToPath(new URL('./mcp.mjs', import.meta.url))}"`);
}
