/**
 * L2 — backend end-to-end on a dedicated display (:98).
 *
 * Deliberately avoids :99: that display belongs to the human and must never be
 * clicked, typed into or restarted by a test run.
 */

import assert from 'node:assert/strict';
import { createClient } from './helpers/mcp-client.mjs';

// Poison the Wayland hint on purpose: WSL shells export it, and x11vnc must
// still start on the X display we point it at (see step below).
process.env.XDG_SESSION_TYPE = 'wayland';
process.env.WAYLAND_DISPLAY = 'wayland-0';
const SETTINGS = {
  display: ':98',
  vncPort: 5902,
  webPort: 6082,
  viewerPort: 6084,
  stateDir: '/tmp/wslcu-test',
  screenshotDir: '/tmp/wslcu-test/shots',
  agentStateHoldMs: 800,
  allowExec: true,
};

const client = createClient(SETTINGS);
const results = [];

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '', ms: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message, ms: Date.now() - started });
  }
}

async function exec(command, timeoutMs = 30000) {
  const result = await client.callTool('exec', { command, timeoutMs });
  if (result.isError) throw new Error(`exec failed: ${result.result?.content?.[0]?.text || ''}`);
  return { ...result.value, out: String(result.value.stdout || '').trim() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Count processes whose cmdline contains the pattern (pgrep -c exits 1 on 0). */
async function countProcess(pattern) {
  const out = await exec(`pgrep -cf ${JSON.stringify(pattern)} 2>/dev/null || true`);
  const first = out.out.split(/\s+/)[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : 0;
}

/** Parse the LISTEN scope of a TCP port from /proc (no ss/netstat needed). */
async function listenScope(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const out = await exec(
    `for f in /proc/net/tcp /proc/net/tcp6; do [ -r "$f" ] || continue; awk 'NR>1 && $4=="0A"{print $2}' "$f"; done`,
  );
  const wanted = out.out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.toUpperCase().endsWith(`:${hex}`));
  if (!wanted.length) return 'none';
  const loopback = wanted.every((line) => /^(0100007F|0{23}1)$/i.test(line.split(':')[0]));
  return loopback ? 'loopback' : 'all';
}

/** Launch an xterm that records stdin into a file. */
async function launchCat(title, file) {
  const launched = await client.callTool('launch', {
    command: `xterm -T ${title} -geometry 90x24 -e sh -c 'cat > ${file}; sleep 300'`,
    logName: title,
  });
  assert.equal(launched.isError, false, JSON.stringify(launched.value));
  assert.equal(launched.value.alive, true, `xterm died: ${launched.value.logTail || launched.value.log}`);
  const waited = await client.callTool('wait_window', { titleContains: title, timeoutMs: 15000 });
  assert.equal(waited.value.found, true, `${title} window did not appear`);
  return waited.value.window;
}

try {
  await client.initialize();

  await step('clean stale test resources', async () => {
    await exec(
      [
        "pkill -f 'websockify.*:608[2-9]' || true",
        "pkill -f 'x11vnc.*:590[2-9]' || true",
        "pkill -f 'Xvfb :98' || true",
        "pkill -f 'Xvfb :97' || true",
        'rm -rf /tmp/wslcu-test /tmp/wslcu-in.txt /tmp/wslcu-ascii.txt',
        'sleep 0.4',
      ].join('\n'),
    );
    return 'ports 6082-6089 / 5902-5909 and :97/:98 cleared';
  });

  let firstUp = null;
  await step('desktop_up starts the desktop', async () => {
    const { value, isError } = await client.callTool('desktop_up', { resolution: '1280x960' });
    assert.equal(isError, false, JSON.stringify(value));
    assert.equal(value.ready, true, 'desktop not ready');
    assert.equal(value.owned, true, 'expected the test display to be owned by the plugin');
    firstUp = value;
    return `${value.display} ${value.resolution} vnc=${value.vncPort} web=${value.webPort} viewer=${value.viewerUrl}`;
  });

  await step('desktop_up is idempotent', async () => {
    const { value } = await client.callTool('desktop_up', {});
    assert.equal(value.ready, true);
    const n = await countProcess('Xvfb :98');
    assert.equal(n, 1, `expected exactly one Xvfb :98, found ${n}`);
    const size = await exec("DISPLAY=:98 xdpyinfo | awk '/dimensions:/{print $2; exit}'");
    assert.equal(size.out, '1280x960');
    return 'single Xvfb, reused';
  });

  await step('websockify binds loopback only', async () => {
    const scope = await listenScope(firstUp.webPort);
    assert.equal(scope, 'loopback', `websockify is listening on "${scope}"`);
    return `port ${firstUp.webPort} = ${scope}`;
  });

  // Regression: WSL remote shells often export Wayland hints. x11vnc trusts
  // them over -display and exits, which leaves the sidebar on
  // "Failed to connect" while Xvfb and websockify still look healthy.
  await step('x11vnc starts despite a Wayland session hint', async () => {
    const processes = await exec("pgrep -af 'x11vnc' | grep -c ':98'");
    assert.ok(Number(processes.out.trim()) >= 1, 'x11vnc for :98 is not running');
    const page = await exec(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${firstUp.webPort}/vnc.html`);
    assert.equal(page.out.trim(), '200', 'websockify does not serve the noVNC client');
    return `x11vnc alive, noVNC client served on ${firstUp.webPort}`;
  });

  await step('viewer is reachable and never shares a port with websockify', async () => {
    const viewerPort = Number(firstUp.viewerUrl.match(/:(\d+)\//)[1]);
    assert.notEqual(viewerPort, firstUp.webPort, 'viewer port equals websockify port');
    const stateResponse = await fetch(`${firstUp.viewerUrl}state`, { signal: AbortSignal.timeout(15000) });
    assert.equal(stateResponse.ok, true, `viewer /state returned ${stateResponse.status}`);
    const state = await stateResponse.json();
    assert.ok(['idle', 'agent', 'user'].includes(state.state), `unexpected state ${state.state}`);
    const html = await (await fetch(firstUp.viewerUrl, { signal: AbortSignal.timeout(15000) })).text();
    assert.match(html, /wslcu-token/, 'viewer shell html not served');
    return `viewer=${viewerPort} web=${firstUp.webPort} state=${state.state}`;
  });

  let xtermWindow = null;
  await step('launch xterm and wait for its window', async () => {
    xtermWindow = await launchCat('wslcu-e2e', '/tmp/wslcu-in.txt');
    return `window ${xtermWindow.id} at ${xtermWindow.x},${xtermWindow.y} ${xtermWindow.width}x${xtermWindow.height}`;
  });

  await step('snapshot returns a rendered PNG path', async () => {
    const { value, isError } = await client.callTool('snapshot', { saveAs: 'e2e-with-window' });
    assert.equal(isError, false, JSON.stringify(value));
    assert.equal(value.width, 1280);
    assert.equal(value.height, 960);
    assert.ok(value.bytes > 200, `png too small: ${value.bytes}`);
    // A mapped white xterm on a black root gives a clearly non-zero mean.
    assert.ok(value.mean > 0.01, `screen looks blank (mean=${value.mean})`);
    assert.equal(value.blank, false);
    return `${value.path} (${value.bytes}B mean=${value.mean})`;
  });

  await step('windows lists the test window', async () => {
    const { value } = await client.callTool('windows', {});
    const hit = value.windows.find((w) => String(w.title).includes('wslcu-e2e'));
    assert.ok(hit, `xterm not listed: ${JSON.stringify(value.windows)}`);
    return `${value.windows.length} visible windows`;
  });

  await step('click focuses the window', async () => {
    const { value, isError } = await client.callTool('click', { window: xtermWindow.id, relX: 60, relY: 60 });
    assert.equal(isError, false, JSON.stringify(value));
    assert.equal(value.window, xtermWindow.id);
    return `clicked ${value.x},${value.y} in window ${value.window}`;
  });

  await step('ASCII typing reaches the application (xtest path)', async () => {
    const window = await launchCat('wslcu-ascii', '/tmp/wslcu-ascii.txt');
    await client.callTool('click', { window: window.id, relX: 50, relY: 50 });
    const typed = await client.callTool('type_text', { text: 'hello world', target: window.id });
    assert.equal(typed.isError, false, JSON.stringify(typed.value));
    assert.equal(typed.value.method, 'xtest', `auto should pick xtest for ASCII, got ${typed.value.method}`);
    await client.callTool('key', { keys: ['Return'] });
    await sleep(200);
    await client.callTool('key', { keys: ['ctrl', 'd'] });
    await sleep(400);
    const cat = await exec('cat /tmp/wslcu-ascii.txt 2>/dev/null || true');
    assert.equal(cat.out, 'hello world', `stdin mismatch: ${JSON.stringify(cat.out)}`);
    return JSON.stringify(cat.out);
  });

  await step('CJK typing reaches the application (clipboard path)', async () => {
    await client.callTool('click', { window: xtermWindow.id, relX: 60, relY: 60 });
    const typed = await client.callTool('type_text', {
      text: '中文测试',
      method: 'clipboard',
      pasteChord: 'middle',
      target: xtermWindow.id,
    });
    assert.equal(typed.isError, false, JSON.stringify(typed.value));
    assert.equal(typed.value.method, 'clipboard');
    await client.callTool('key', { keys: ['Return'] });
    await sleep(250);
    await client.callTool('key', { keys: ['ctrl', 'd'] });
    await sleep(500);
    const cat = await exec('cat /tmp/wslcu-in.txt 2>/dev/null || true');
    assert.equal(cat.out, '中文测试', `CJK paste mismatch: ${JSON.stringify(cat.out)}`);
    return JSON.stringify(cat.out);
  });

  await step('takeover start blocks every mutating tool', async () => {
    const started = await client.callTool('takeover', { action: 'start' });
    assert.equal(started.value.state, 'user');
    for (const [tool, args] of [
      ['click', { x: 10, y: 10 }],
      ['type_text', { text: 'x' }],
      ['key', { keys: ['Return'] }],
      ['exec', { command: 'echo hi' }],
      ['launch', { command: 'xterm -T blocked' }],
    ]) {
      const result = await client.callTool(tool, args);
      assert.equal(result.isError, true, `${tool} should be refused while the human owns the pointer`);
      const text = result.result?.content?.[0]?.text || '';
      assert.match(text, /USER_IN_CONTROL/, `${tool} returned: ${text.slice(0, 120)}`);
    }
    const snap = await client.callTool('snapshot', { saveAs: 'e2e-during-takeover' });
    assert.equal(snap.isError, false, 'snapshot must stay available during takeover');
    return 'click/type_text/key/exec/launch refused, snapshot ok';
  });

  await step('takeover stop restores agent control', async () => {
    const stopped = await client.callTool('takeover', { action: 'stop' });
    assert.equal(stopped.value.state, 'idle');
    const click = await client.callTool('click', { x: 100, y: 100 });
    assert.equal(click.isError, false);
    return 'click accepted again';
  });

  await step('desktop_down stops what it started', async () => {
    // A foreign display the plugin never started must survive.
    await exec('DISPLAY=:97 nohup Xvfb :97 -screen 0 320x240x24 </dev/null >/tmp/wslcu-foreign.log 2>&1 & sleep 1.2; DISPLAY=:97 xdpyinfo >/dev/null 2>&1 && echo ok');
    const down = await client.callTool('desktop_down', {});
    assert.equal(down.isError, false, JSON.stringify(down.value));
    const gone = await exec('DISPLAY=:98 xdpyinfo >/dev/null 2>&1 && echo alive || echo gone');
    assert.equal(gone.out, 'gone', 'display :98 still alive after desktop_down');
    const foreign = await exec('DISPLAY=:97 xdpyinfo >/dev/null 2>&1 && echo alive || echo gone');
    assert.equal(foreign.out, 'alive', 'foreign display :97 was killed');
    await exec('pkill -f "Xvfb :97" || true');
    const leaked = await countProcess('Xvfb :98');
    assert.equal(leaked, 0, 'Xvfb :98 leaked');
    return 'owned display stopped, foreign display untouched';
  });
} finally {
  await client.callTool('takeover', { action: 'stop' }).catch(() => {});
  await client.callTool('desktop_down', {}).catch(() => {});
  await client.close();
}

const failed = results.filter((row) => !row.ok);
for (const row of results) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}  ${row.ms}ms  ${row.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
