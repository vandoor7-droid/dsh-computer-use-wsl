#!/usr/bin/env node
/**
 * Live check: the idle reaper really terminates the distro it manages.
 *
 * Drives the MCP server by hand (no host needed): start the desktop with one
 * tool call, then stay silent and watch the reaper terminate the distro and
 * leave a `releasedAt` marker. Run from the repo root:
 *
 *   node test/idle-release-live.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const baseDir = path.join(process.env.LOCALAPPDATA || path.join(repoRoot, '.tmp'), 'wslcu');
const settingsPath = path.join(baseDir, 'settings.json');
const statusPath = path.join(baseDir, 'status.json');

const settings = {
  distro: 'UbuntuLab',
  display: ':99',
  resolution: '1280x960',
  vncPort: 5900,
  webPort: 6080,
  viewerPort: 6081,
  stateDir: '/tmp/wslcu-idle',
  screenshotDir: '/tmp/wslcu-idle/shots',
  agentStateHoldMs: 800,
  allowExec: false,
  idleReleaseMin: 1,
};

fs.mkdirSync(baseDir, { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
try {
  fs.rmSync(statusPath, { force: true });
} catch {
  /* fine */
}

const child = spawn(process.execPath, [path.join(repoRoot, 'mcp', 'server.mjs')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, WSLCU_SETTINGS_JSON: JSON.stringify(settings) },
});

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});
child.stderr.on('data', (chunk) => process.stdout.write('[server] ' + chunk.toString()));

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: ' + method)), 240000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

function distroState() {
  try {
    const raw = execFileSync('wsl.exe', ['-l', '-v'], { encoding: 'utf16le' });
    const clean = raw.replace(/\u0000/g, ' ');
    return /UbuntuLab\s+(\w+)/.exec(clean)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function fail(message) {
  console.log('FAIL: ' + message);
  child.kill();
  process.exit(1);
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'idle-release-live', version: '0' },
});
console.log('initialized');

const shot = await rpc('tools/call', { name: 'desktop_up', arguments: {} });
const shotText = JSON.stringify(shot.result ?? {}).slice(0, 200);
console.log('screenshot: ' + (shot.result?.isError ? 'ERROR ' + shotText : 'ok'));
console.log('distro after start: ' + distroState());

// Silence from here on: the reaper has to act by itself.
const deadline = Date.now() + 150000;
let marker = null;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    if (parsed.releasedAt) {
      marker = parsed;
      break;
    }
  } catch {
    /* not written yet */
  }
}
if (!marker) fail('no releasedAt marker within 150s');
console.log('releasedAt=' + marker.releasedAt + ' distro=' + marker.distro);

const state = distroState();
console.log('distro after idle: ' + state);
if (!/Stopped/i.test(state)) fail('distro is still ' + state);

console.log('PASS: the idle reaper terminated the managed distro');
child.kill();
process.exit(0);
