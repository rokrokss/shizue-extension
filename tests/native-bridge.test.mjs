import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHost } from '../scripts/shizue-bridge/install.mjs';
import { agentName, bridgeSocket, encodeFrame, frameDecoder, lineDecoder } from '../scripts/shizue-bridge/protocol.mjs';

const script = (name) => fileURLToPath(new URL(`../scripts/shizue-bridge/${name}`, import.meta.url));

const tempDir = (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shz-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

const until = async (check, what) => {
  for (let tries = 0; tries < 200; tries++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${what}`);
};

// The host with this test in Chrome's place. `answer` plays Shizue.
const startHost = async (t, directory, answer = () => null) => {
  const host = spawn(process.execPath, [script('host.mjs')], { env: { ...process.env, SHIZUE_BRIDGE_DIR: directory } });
  t.after(() => host.kill());
  const received = [];
  host.stdout.on(
    'data',
    frameDecoder((request) => {
      received.push(request);
      const response = answer(request);
      if (response) host.stdin.write(encodeFrame({ id: request.id, ...response }));
    })
  );
  await until(() => existsSync(join(directory, 'bridge.sock')), 'the host socket');
  return { host, received };
};

const startMcp = (t, directory) => {
  const server = spawn(process.execPath, [script('mcp.mjs')], { env: { ...process.env, SHIZUE_BRIDGE_DIR: directory } });
  t.after(() => server.kill());
  const answers = new Map();
  server.stdout.on(
    'data',
    lineDecoder((message) => answers.set(message.id, message))
  );
  let nextId = 1;
  return async (method, params) => {
    const id = nextId++;
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    await until(() => answers.has(id), method);
    return answers.get(id);
  };
};

test('Native messages survive being split and run together, Korean included', () => {
  const seen = [];
  const decode = frameDecoder((message) => seen.push(message));
  const bytes = Buffer.concat([encodeFrame({ text: '시즈에' }), encodeFrame({ text: 'two' })]);
  decode(bytes.subarray(0, 2));
  assert.deepEqual(seen, []);
  decode(bytes.subarray(2, 9));
  decode(bytes.subarray(9));
  assert.deepEqual(seen, [{ text: '시즈에' }, { text: 'two' }]);
});

test('Lines survive a character split between chunks', () => {
  const seen = [];
  const decode = lineDecoder((message) => seen.push(message));
  const bytes = Buffer.from('{"text":"시즈에"}\n\n{"n":2}\n');
  decode(bytes.subarray(0, 11));
  decode(bytes.subarray(11));
  assert.deepEqual(seen, [{ text: '시즈에' }, { n: 2 }]);
});

test('The socket lives only in a folder this user alone can open', (t) => {
  const parent = tempDir(t);
  const before = process.env.SHIZUE_BRIDGE_DIR;
  t.after(() => {
    if (before === undefined) delete process.env.SHIZUE_BRIDGE_DIR;
    else process.env.SHIZUE_BRIDGE_DIR = before;
  });
  process.env.SHIZUE_BRIDGE_DIR = join(parent, 'new');
  assert.equal(bridgeSocket(), join(parent, 'new', 'bridge.sock'));
  assert.equal(lstatSync(join(parent, 'new')).mode & 0o777, 0o700);
  process.env.SHIZUE_BRIDGE_DIR = join(parent, 'open');
  mkdirSync(join(parent, 'open'), { mode: 0o755 });
  assert.throws(bridgeSocket, /only this user/);
});

test('The MCP server speaks MCP and lists the tools', async (t) => {
  const ask = startMcp(t, tempDir(t));
  const { result } = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.equal(result.serverInfo.name, 'shizue');
  const { tools } = (await ask('tools/list')).result;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['list_tabs', 'read_page', 'find', 'get_text', 'act', 'screenshot', 'switch_tab', 'close_tab']
  );
  // Claude Code can let the reading tools run unasked and still ask about act.
  const hints = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
  for (const name of ['list_tabs', 'read_page', 'find', 'get_text', 'screenshot']) assert.equal(hints[name].readOnlyHint, true, name);
  assert.equal(hints.act.readOnlyHint, false);
  assert.equal(hints.act.destructiveHint, true);
  assert.equal(tools.find((tool) => tool.name === 'act').inputSchema.properties.include_snapshot.type, 'boolean');
  assert.deepEqual(tools.find((tool) => tool.name === 'find').inputSchema.required, ['query']);
  assert.deepEqual((await ask('ping')).result, {});
  assert.equal((await ask('nope')).error.code, -32601);
});

test('The agent is named as people call it, or as it calls itself', () => {
  assert.equal(agentName({ name: 'claude-code', version: '2.1.0' }), 'Claude Code');
  assert.equal(agentName({ name: 'codex-mcp-client' }), 'Codex');
  assert.equal(agentName({ name: 'gemini-cli-mcp-client' }), 'Gemini CLI');
  assert.equal(agentName({ name: 'cursor-vscode' }), 'Cursor');
  assert.equal(agentName({ name: 'Visual Studio Code' }), 'VS Code');
  assert.equal(agentName({ name: 'claude-ai' }), 'Claude');
  assert.equal(agentName({ name: '  My\nOwn \u0007 Agent  ' }), 'My Own Agent');
  assert.equal(agentName({ name: 'x'.repeat(100) }).length, 40);
  assert.equal(agentName({ name: '' }), undefined);
  assert.equal(agentName(undefined), undefined);
  assert.equal(agentName({ name: 42 }), undefined);
});

test('Each call carries the name the agent gave when it started', async (t) => {
  const directory = tempDir(t);
  const { received } = await startHost(t, directory, () => ({ result: { text: 'ok' } }));
  const ask = startMcp(t, directory);
  await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-mcp-client', version: '0.50.0' } });
  await ask('tools/call', { name: 'list_tabs', arguments: {} });
  assert.equal(received[0].agent, 'Codex');
});

test('A tool call reaches Shizue through the host, and its answer comes back', async (t) => {
  const directory = tempDir(t);
  const { received } = await startHost(t, directory, ({ tool }) => {
    if (tool === 'read_page') return { result: { text: '페이지' } };
    if (tool === 'screenshot') return { result: { text: 'shot', image: { data: 'AAAA', mimeType: 'image/jpeg' } } };
    return { error: 'Result: refused, a password field' };
  });
  const ask = startMcp(t, directory);
  const read = await ask('tools/call', { name: 'read_page', arguments: { tabId: 7 } });
  assert.deepEqual(read.result, { content: [{ type: 'text', text: '페이지' }] });
  assert.equal(received[0].tool, 'read_page');
  assert.deepEqual(received[0].args, { tabId: 7 });
  const shot = await ask('tools/call', { name: 'screenshot', arguments: {} });
  assert.deepEqual(shot.result.content[1], { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
  const refused = await ask('tools/call', { name: 'act', arguments: { kind: 'click', ref: 1 } });
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /a password field/);
});

test('Answers go to whoever asked when two ask at once', async (t) => {
  const directory = tempDir(t);
  const waiting = [];
  const { host } = await startHost(t, directory, (request) => {
    waiting.push(request);
    // Answers the second first.
    if (waiting.length === 2) {
      host.stdin.write(encodeFrame({ id: waiting[1].id, result: { text: `for ${waiting[1].args.who}` } }));
      host.stdin.write(encodeFrame({ id: waiting[0].id, result: { text: `for ${waiting[0].args.who}` } }));
    }
    return null;
  });
  const [askA, askB] = [startMcp(t, directory), startMcp(t, directory)];
  const [a, b] = await Promise.all([
    askA('tools/call', { name: 'read_page', arguments: { who: 'a' } }),
    askB('tools/call', { name: 'read_page', arguments: { who: 'b' } }),
  ]);
  assert.equal(a.result.content[0].text, 'for a');
  assert.equal(b.result.content[0].text, 'for b');
});

test('Without a browser connected, a tool call says so instead of hanging', async (t) => {
  const ask = startMcp(t, tempDir(t));
  const { result } = await ask('tools/call', { name: 'list_tabs', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not connected/);
});

test('A second browser is turned away, and the socket goes when the browser does', async (t) => {
  const directory = tempDir(t);
  const socket = join(directory, 'bridge.sock');
  const { host } = await startHost(t, directory);
  const second = spawn(process.execPath, [script('host.mjs')], { env: { ...process.env, SHIZUE_BRIDGE_DIR: directory } });
  const code = await new Promise((resolve) => second.on('exit', resolve));
  assert.equal(code, 1);
  await new Promise((resolve, reject) => createConnection(socket).once('connect', resolve).once('error', reject));
  // Chrome closing the port.
  host.stdin.end();
  await until(() => !existsSync(socket), 'the socket to go');
});

test('A socket left by a crash does not stop the next host', async (t) => {
  const directory = tempDir(t);
  const socket = join(directory, 'bridge.sock');
  // Nothing listens on it.
  writeFileSync(socket, '');
  const { received } = await startHost(t, directory, () => ({ result: { text: 'ok' } }));
  await until(() => {
    try {
      return statSync(socket).isSocket();
    } catch {
      return false;
    }
  }, 'a new socket');
  const ask = startMcp(t, directory);
  assert.equal((await ask('tools/call', { name: 'list_tabs', arguments: {} })).result.content[0].text, 'ok');
  assert.equal(received.length, 1);
});

test('Installing names one extension and an executable launcher', (t) => {
  const directory = tempDir(t);
  const manifestPath = installHost({
    extensionId: 'a'.repeat(32),
    chromeDir: join(directory, 'chrome'),
    hostDir: join(directory, 'host'),
  });
  assert.equal(manifestPath, join(directory, 'chrome/NativeMessagingHosts/net.shizue.bridge.json'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${'a'.repeat(32)}/`]);
  assert.equal(manifest.type, 'stdio');
  assert.equal(statSync(manifest.path).mode & 0o111, 0o111);
  assert.ok(readFileSync(manifest.path, 'utf8').includes(process.execPath));
  assert.throws(() => installHost({ extensionId: 'nope', chromeDir: directory, hostDir: directory }), /extension id/);
});
