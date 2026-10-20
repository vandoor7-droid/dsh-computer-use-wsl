/**
 * L4 — host-mode (`transport: "wsl"`) code path.
 *
 * The plugin's Windows shape is exercised on Linux by putting a stub `wsl.exe`
 * first on PATH. Same server, same scripts, different argv — which is exactly
 * the only difference between the two transports.
 */

import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = new URL('./', import.meta.url);
const SERVER = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
const STUB = fileURLToPath(new URL('./fixtures/wsl.exe', HERE));

const results = [];
function check(name, detail) {
  results.push({ name, ok: true, detail: detail ?? '' });
}

const dir = await mkdtemp(path.join(tmpdir(), 'wslcu-l4-'));
const binDir = path.join(dir, 'bin');
await mkdir(binDir, { recursive: true });
await copyFile(STUB, path.join(binDir, 'wsl.exe'));
await chmod(path.join(binDir, 'wsl.exe'), 0o755);

const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    WSLCU_SETTINGS_JSON: JSON.stringify({
      transport: 'wsl',
      distro: 'StubDistro',
      display: ':98',
      vncPort: 5902,
      webPort: 6082,
      viewerPort: 6084,
      stateDir: '/tmp/wslcu-test',
      screenshotDir: '/tmp/wslcu-test/shots',
      allowExec: true,
      agentStateHoldMs: 800,
    }),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
let nextId = 1;
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
  }
});
child.stderr.on('data', () => {});

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout: ${method}`));
    }, 180000).unref?.();
  });
}

async function call(name, args = {}) {
  const result = await request('tools/call', { name, arguments: args });
  const text = result?.content?.[0]?.text || '{}';
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { raw: text };
  }
  return { value, isError: Boolean(result?.isError), text };
}

try {
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'l4', version: '0' } });

  const health = await call('health');
  assert.equal(health.value.transport, 'wsl', 'transport should resolve to wsl when configured');
  assert.equal(health.value.distro, 'StubDistro', 'distro should come from the stub');
  check('stub wsl.exe resolves the configured distro', `transport=wsl distro=${health.value.distro}`);

  const up = await call('desktop_up', { resolution: '1024x768' });
  assert.equal(up.isError, false, up.text);
  assert.equal(up.value.ready, true);
  assert.equal(up.value.resolution, '1024x768');
  check('desktop_up works through the wsl transport', `${up.value.display} ${up.value.resolution}`);

  const snap = await call('snapshot', { saveAs: 'l4' });
  assert.equal(snap.isError, false, snap.text);
  assert.equal(snap.value.width, 1024);
  check('snapshot returns a host-visible path', `${snap.value.path} (${snap.value.bytes}B)`);

  await call('takeover', { action: 'start' });
  const blocked = await call('click', { x: 5, y: 5 });
  assert.equal(blocked.isError, true);
  assert.match(blocked.text, /USER_IN_CONTROL/);
  check('takeover still gates input', 'click refused with USER_IN_CONTROL');

  await call('takeover', { action: 'stop' });
  const click = await call('click', { x: 5, y: 5 });
  assert.equal(click.isError, false, click.text);
  check('control returns to the agent', 'click accepted');

  const down = await call('desktop_down');
  assert.equal(down.isError, false, down.text);
  check('desktop_down through the wsl transport', down.value.DONE === '1' ? 'stopped' : JSON.stringify(down.value));
} finally {
  child.stdin.end();
  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(() => child.kill('SIGKILL'), 3000).unref?.();
  });
  await rm(dir, { recursive: true, force: true });
}

for (const row of results) console.log(`PASS  ${row.name}  ${row.detail}`);
console.log(`\n${results.length}/${results.length} passed (L4)`);
