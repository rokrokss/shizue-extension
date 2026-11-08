// Claude Code's whole road into Shizue, with this test in Claude Code's place: mcp.mjs, the socket,
// a host Chrome really starts from its manifest, the bridge build, and a page. Needs
// `pnpm build:bridge` and Chrome for Testing, as branded Chrome won't load an extension from a flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHost } from '../scripts/shizue-bridge/install.mjs';
import { lineDecoder } from '../scripts/shizue-bridge/protocol.mjs';

const extension = fileURLToPath(new URL('../dist/chrome-mv3-bridge', import.meta.url));

const testingChrome = () => {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const installs = existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith('chromium-')) : [];
  for (const install of installs.sort().reverse()) {
    for (const folder of readdirSync(join(cache, install))) {
      const binary = join(cache, install, folder, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(binary)) return binary;
    }
  }
  return null;
};

// Chrome's id for an extension loaded from a folder.
const unpackedId = (path) =>
  [...createHash('sha256').update(realpathSync(path)).digest('hex').slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join('');

// What the page itself saw, so a check doesn't rest on the road it is checking.
const startPage = async (t) => {
  const events = [];
  const report = `<script>const report = (what) => fetch('/event?what=' + encodeURIComponent(what));</script>`;
  const pages = {
    '/': `<!doctype html><meta charset="utf-8"><title>Bridge test</title>${report}
      <h1>Bridge test page</h1>
      <input id="who" aria-label="Your name" onkeydown="if (event.key === 'Enter') report('enter')">
      <button onclick="report('greet:' + who.value); out.textContent = 'Hello, ' + who.value">Show greeting</button>
      <p id="out"></p>
      <input type="password" aria-label="Password" oninput="report('password')">
      <button onclick="report('delete')">Delete account</button>
      <a href="/next">Go to the next page</a>`,
    '/next': `<!doctype html><meta charset="utf-8"><title>Second</title>${report}
      <h1>Second page</h1>
      <button onclick="report('second')">Second button</button>`,
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://page');
    if (url.pathname === '/event') events.push(url.searchParams.get('what'));
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(pages[url.pathname] ?? '');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { origin: `http://127.0.0.1:${server.address().port}`, events };
};

const startClaudeCodeSide = (t, env) => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('../scripts/shizue-bridge/mcp.mjs', import.meta.url))], { env });
  t.after(() => server.kill());
  const waiting = new Map();
  server.stdout.on(
    'data',
    lineDecoder(({ id, result }) => waiting.get(id)?.(result))
  );
  let nextId = 1;
  return (name, args = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, (result) => resolve({ ...result, text: result.content[0].text }));
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
    });
};

const refOf = (page, label) => {
  const line = page.text.split('\n').find((row) => /^\[\d+\]/.test(row) && row.includes(label));
  assert.ok(line, `${label} should be on the page:\n${page.text}`);
  return Number(line.match(/^\[(\d+)\]/)[1]);
};

const until = async (check, what) => {
  for (let tries = 0; tries < 80; tries++) {
    const found = await check();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`Timed out waiting for ${what}`);
};

test('Claude Code reads and works a real page through Shizue', { timeout: 180_000 }, async (t) => {
  const chrome = testingChrome();
  assert.ok(chrome, 'Chrome for Testing is needed. Set CHROME_BIN.');
  assert.ok(existsSync(join(extension, 'manifest.json')), 'Run pnpm build:bridge first.');
  assert.ok(JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8')).permissions.includes('nativeMessaging'));

  const directory = mkdtempSync(join(tmpdir(), 'shz-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const profile = join(directory, 'profile');
  installHost({ extensionId: unpackedId(extension), chromeDir: profile, hostDir: join(directory, 'host') });
  const env = { ...process.env, SHIZUE_BRIDGE_DIR: directory };

  const { origin, events } = await startPage(t);
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--window-size=800,600',
      origin,
    ],
    { env, stdio: 'ignore' }
  );
  t.after(() => browser.kill('SIGKILL'));

  const tool = startClaudeCodeSide(t, env);

  // Once Chrome has started the extension and the extension the host. The page Chrome opened isn't
  // in the Shizue group, so nothing is shared yet.
  const none = await until(async () => {
    const tabs = await tool('list_tabs');
    return tabs.isError ? null : tabs;
  }, 'Shizue to connect');
  assert.match(none.text, /No tab is shared/);
  assert.match((await tool('read_page')).text, /tab group named "Shizue"/);

  // A tab it opens joins the group, behind the user's tab.
  const opened = await tool('act', { kind: 'open_tab', url: `${origin}/` });
  assert.ok(!opened.isError, opened.text);
  const tabId = Number(opened.text.match(/Opened tab (\d+)/)[1]);
  const shared = JSON.parse((await tool('list_tabs')).text);
  assert.deepEqual(shared.map((tab) => [tab.id, tab.url, tab.active]), [[tabId, `${origin}/`, false]]);

  let page = await tool('read_page', { tabId });
  assert.ok(!page.isError, page.text);
  assert.match(page.text, /Bridge test page/);

  // A tab behind another can't be seen until it comes forward.
  assert.equal((await tool('screenshot', { tabId })).isError, true);
  assert.ok(!(await tool('switch_tab', { tabId })).isError);
  const shot = await tool('screenshot', { tabId });
  assert.ok(!shot.isError, shot.text);
  const image = shot.content.find((part) => part.type === 'image');
  assert.equal(image.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(image.data, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  // The screenshot numbered the page afresh.
  page = await tool('read_page', { tabId });

  // An action answers in a line, and the numbers of the last read still hold after it.
  const typed = await tool('act', { tabId, kind: 'type', ref: refOf(page, 'Your name'), text: '시즈에' });
  assert.match(typed.text, /^Result: done/);
  assert.doesNotMatch(typed.text, /Bridge test page/);
  page = await tool('act', { tabId, kind: 'click', ref: refOf(page, 'Show greeting'), include_snapshot: true });
  assert.match(page.text, /Hello, 시즈에/);
  await until(() => events.includes('greet:시즈에'), 'the page to see the click');

  // find numbers the page afresh.
  const found = await tool('find', { tabId, query: 'delete account' });
  assert.match(found.text, /\[\d+\] button "Delete account"/);

  // What may send, delete or pay waits for the user's own click on the page; nobody clicks here.
  const declined = await tool('act', { tabId, kind: 'click', ref: refOf(found, 'Delete account') });
  assert.ok(!declined.isError, declined.text);
  assert.match(declined.text, /declined/);
  assert.ok(!events.includes('delete'), 'the delete waits for the user');

  // A password stays out of reach.
  page = await tool('read_page', { tabId });
  const password = await tool('act', { tabId, kind: 'type', ref: refOf(page, 'Password'), text: 'hunter2' });
  assert.match(password.text, /refused/);
  page = await tool('read_page', { tabId });
  assert.doesNotMatch(page.text, /hunter2/);
  assert.ok(!events.includes('password'), 'the password field stays empty');

  // What the agent can't do at all is turned away.
  assert.equal((await tool('act', { tabId, kind: 'finish' })).isError, true);

  // Control stays across a page change.
  page = await tool('act', { tabId, kind: 'click', ref: refOf(page, 'Go to the next page'), include_snapshot: true });
  assert.match(page.text, /Second page/);
  await tool('act', { tabId, kind: 'click', ref: refOf(page, 'Second button') });
  await until(() => events.includes('second'), 'the second page to see the click');
  page = await tool('act', { tabId, kind: 'back', include_snapshot: true });
  assert.match(page.text, /Bridge test page/);

  // The page's text as the panel reads it.
  assert.match((await tool('get_text', { tabId })).text, /Bridge test page/);

  // It closes what it opened, and then has nothing again.
  assert.ok(!(await tool('close_tab', { tabId })).isError);
  assert.match((await tool('list_tabs')).text, /No tab is shared/);
});
