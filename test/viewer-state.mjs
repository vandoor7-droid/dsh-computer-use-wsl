/**
 * L2b — the sidebar shell's control-state surface.
 *
 * The badge text itself lives in viewer.js (it is rendered client-side), so we
 * assert three things separately:
 *   1. /state reports the right state machine transitions;
 *   2. the shell actually ships the 「DSH 操作中」 label (so the badge can);
 *   3. the SSE stream pushes transitions without polling.
 */

import assert from 'node:assert/strict';
import { createClient } from './helpers/mcp-client.mjs';

const SETTINGS = {
  display: ':98',
  vncPort: 5902,
  webPort: 6082,
  viewerPort: 6084,
  stateDir: '/tmp/wslcu-test',
  screenshotDir: '/tmp/wslcu-test/shots',
  agentStateHoldMs: 900,
  allowExec: true,
};

const client = createClient(SETTINGS);
const results = [];
async function step(name, fn) {
  try {
    results.push({ name, ok: true, detail: (await fn()) ?? '' });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let base = '';
async function state() {
  const response = await fetch(`${base}state`, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.ok, true);
  return response.json();
}
async function waitForState(want, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await state();
    if (last.state === want) return last;
    await sleep(100);
  }
  throw new Error(`state stayed "${last?.state}" (tool=${last?.tool}), wanted "${want}"`);
}

try {
  await client.initialize();
  const up = await client.callTool('desktop_up', {});
  assert.equal(up.isError, false, JSON.stringify(up.value));
  base = up.value.viewerUrl;

  await step('initial state is idle', async () => {
    const current = await waitForState('idle');
    return `state=${current.state}`;
  });

  await step('an input tool flips the badge to agent', async () => {
    const clicked = await client.callTool('click', { x: 120, y: 140 });
    assert.equal(clicked.isError, false, JSON.stringify(clicked.value));
    const during = await waitForState('agent', 1500);
    assert.equal(during.tool, 'click');
    return `state=agent tool=${during.tool} remaining=${during.remainingMs}ms`;
  });

  await step('the badge falls back to idle after the hold window', async () => {
    const idle = await waitForState('idle', SETTINGS.agentStateHoldMs + 2500);
    return `state=${idle.state} after hold`;
  });

  await step('viewer.js ships the DSH 操作中 label', async () => {
    const js = await (await fetch(`${base}viewer.js`, { signal: AbortSignal.timeout(15000) })).text();
    assert.match(js, /DSH 操作中/, 'agent label missing from viewer.js');
    assert.match(js, /你正在操作/, 'user label missing from viewer.js');
    const html = await (await fetch(base, { signal: AbortSignal.timeout(15000) })).text();
    const token = /name="wslcu-token" content="([^"]+)"/.exec(html)?.[1];
    assert.ok(token, 'viewer html has no token');
    return `token=${token.slice(0, 6)}… labels present`;
  });

  let token = '';
  await step('takeover POST requires the page token', async () => {
    const html = await (await fetch(base)).text();
    token = /name="wslcu-token" content="([^"]+)"/.exec(html)[1];
    const bad = await fetch(`${base}takeover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', token: 'wrong' }),
    });
    assert.equal(bad.status, 403, `bad token returned ${bad.status}`);
    return 'cross-site takeover rejected with 403';
  });

  await step('takeover start switches the badge to user and blocks input', async () => {
    const response = await fetch(`${base}takeover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', token }),
    });
    assert.equal(response.ok, true);
    const payload = await response.json();
    assert.equal(payload.state, 'user');
    const blocked = await client.callTool('click', { x: 10, y: 10 });
    assert.equal(blocked.isError, true);
    assert.match(blocked.result?.content?.[0]?.text || '', /USER_IN_CONTROL/);
    return 'state=user, click refused';
  });

  await step('takeover stop hands control back', async () => {
    const response = await fetch(`${base}takeover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop', token }),
    });
    assert.equal((await response.json()).state, 'idle');
    const click = await client.callTool('click', { x: 30, y: 30 });
    assert.equal(click.isError, false);
    return 'state=idle, click accepted';
  });

  await step('SSE pushes state changes', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}events`, { signal: controller.signal });
    assert.equal(response.ok, true);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const frames = [];
    const deadline = Date.now() + 8000;
    // Trigger a transition while the stream is open.
    setTimeout(() => client.callTool('click', { x: 40, y: 40 }), 300);
    while (Date.now() < deadline && frames.length < 2) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          frames.push(JSON.parse(line.slice(6)));
        } catch {
          /* comment/heartbeat */
        }
      }
    }
    controller.abort();
    assert.ok(frames.length >= 2, `expected at least 2 SSE frames, got ${frames.length}`);
    assert.ok(frames.some((f) => f.state === 'agent'), `no agent frame: ${JSON.stringify(frames.map((f) => f.state))}`);
    return `${frames.length} frames, states=${frames.map((f) => f.state).join('->')}`;
  });
} finally {
  await client.callTool('takeover', { action: 'stop' }).catch(() => {});
  await client.callTool('desktop_down', {}).catch(() => {});
  await client.close();
}

const failed = results.filter((row) => !row.ok);
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}  ${row.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
