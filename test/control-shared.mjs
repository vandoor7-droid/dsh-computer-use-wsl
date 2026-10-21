/**
 * L7 — control is shared across instances.
 *
 * Regression for a real incident: the human clicked 「我要接管」 in the viewer,
 * the badge turned orange, and a *second* MCP server driving the same desktop
 * happily kept moving the pointer, because takeover lived in process memory.
 *
 * Two independent servers now share $stateDir/control.json, so a takeover in
 * one is visible (and enforced) in the other; a dead holder goes stale and
 * releases the desktop instead of locking it forever.
 */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './helpers/mcp-client.mjs';

const STATE_DIR = '/tmp/wslcu-shared-test';
const SETTINGS = (viewerPort) => ({
  transport: 'local',
  display: ':98',
  vncPort: 5912,
  webPort: 6112,
  viewerPort,
  stateDir: STATE_DIR,
  screenshotDir: join(STATE_DIR, 'shots'),
  agentStateHoldMs: 800,
  allowExec: false,
});

let failures = 0;
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name}  ${Date.now() - started}ms  ${detail || ''}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}  ${error.message}`);
  }
}

rmSync(STATE_DIR, { recursive: true, force: true });
mkdirSync(STATE_DIR, { recursive: true });

const agent = createClient(SETTINGS(6114));
const other = createClient(SETTINGS(6116));

try {
  await agent.initialize();
  await other.initialize();

  await step('both instances start idle', async () => {
    const a = await agent.callTool('control_state', {});
    const b = await other.callTool('control_state', {});
    assert.equal(a.value.holder, 'idle', JSON.stringify(a.value));
    assert.equal(b.value.holder, 'idle', JSON.stringify(b.value));
    assert.notEqual(a.value.by, b.value.by, 'instances must have distinct owners');
    return `owners ${a.value.by} / ${b.value.by}`;
  });

  await step('human takes over in instance A', async () => {
    const { value } = await agent.callTool('takeover', { action: 'start' });
    assert.equal(value.state, 'user', JSON.stringify(value));
    return 'A: user';
  });

  await step('instance B sees the same takeover', async () => {
    const { value } = await other.callTool('control_state', {});
    assert.equal(value.holder, 'user', JSON.stringify(value));
    assert.equal(value.humanInControl, true);
    return `B sees holder=user by=${value.by}`;
  });

  await step('instance B refuses to move the pointer', async () => {
    const { isError, value } = await other.callTool('click', { x: 10, y: 10 });
    assert.equal(isError, true, 'click should be refused');
    assert.match(String(value.raw || ''), /USER_IN_CONTROL/, JSON.stringify(value));
    return 'click refused with USER_IN_CONTROL';
  });

  await step('hand back in A clears it for B', async () => {
    await agent.callTool('takeover', { action: 'stop' });
    const { value } = await other.callTool('control_state', {});
    assert.equal(value.holder, 'idle', JSON.stringify(value));
    const click = await other.callTool('click', { x: 10, y: 10 });
    assert.ok(
      !String(click.value.raw || '').includes('USER_IN_CONTROL'),
      'click must not be refused once the human handed back',
    );
    return 'B: idle, click allowed';
  });

  await step('instance B sees A driving (badge must not read idle)', async () => {
    // A moves the pointer just now; the viewer instance (B) must report
    // 「DSH 操作中」, not 空闲 — otherwise the human cannot tell the agent acts.
    await agent.callTool('click', { x: 20, y: 20 });
    const { value } = await other.callTool('control_state', {});
    assert.equal(value.holder, 'agent', JSON.stringify(value));
    assert.equal(value.tool, 'click', JSON.stringify(value));
    return `B sees holder=agent tool=${value.tool} by=${value.by}`;
  });

  await step('badge falls back to idle when the driving hold expires', async () => {
    // The shared record outlives the action; the viewer must not stay on
    // 「DSH 操作中」 once holdMs has passed (holdMs is 800ms in this test).
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const { value } = await other.callTool('control_state', {});
    assert.equal(value.holder, 'idle', `badge stuck on agent: ${JSON.stringify(value)}`);
    return 'back to idle';
  });

  await step('a stale takeover releases the desktop', async () => {
    writeFileSync(
      join(STATE_DIR, 'control.json'),
      JSON.stringify({
        holder: 'user',
        by: 'ghost/1',
        pid: 1,
        tool: '',
        since: Date.now() - 60000,
        hb: Date.now() - 60000,
      }),
    );
    const { value } = await other.callTool('control_state', {});
    // The ghost claim must not block the agent. (The last click may have left
    // the local instance in `agent`, which is fine — only `user` blocks.)
    assert.notEqual(value.holder, 'user', `stale holder must not lock the desktop: ${JSON.stringify(value)}`);
    assert.equal(value.humanInControl, false, JSON.stringify(value));
    const click = await other.callTool('click', { x: 12, y: 12 });
    assert.ok(
      !String(click.value.raw || '').includes('USER_IN_CONTROL'),
      'a stale takeover must not refuse input',
    );
    return `ghost holder ignored (holder=${value.holder})`;
  });
} finally {
  await agent.close();
  await other.close();
  rmSync(STATE_DIR, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
