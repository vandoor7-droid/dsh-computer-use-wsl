/**
 * L0 — pure-logic units. No X server, no WSL, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULTS, parseResolution } from '../lib/settings.mjs';
import { sh, detectKind } from '../mcp/transport.mjs';
import { parseKeyValues } from '../mcp/desktop.mjs';
import { ControlState, ControlError, USER_IN_CONTROL } from '../mcp/takeover.mjs';

test('settings: defaults are complete and frozen', () => {
  const settings = normalizeSettings({});
  assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULTS).sort());
  assert.equal(settings.resolution, '1280x960');
  assert.equal(settings.bindHost, '127.0.0.1');
  assert.equal(settings.allowExec, false);
});

test('settings: unknown keys are dropped and scalars coerced', () => {
  const settings = normalizeSettings({ vncPort: '5905', allowExec: 'yes', bogus: 1, display: 'nope' });
  assert.equal(settings.vncPort, 5905);
  assert.equal(settings.allowExec, true);
  assert.equal(settings.bogus, undefined);
  assert.equal(settings.display, ':99');
});

test('settings: invalid numbers and resolutions fall back', () => {
  const settings = normalizeSettings({ webPort: -1, resolution: 'huge' });
  assert.equal(settings.webPort, DEFAULTS.webPort);
  assert.equal(settings.resolution, DEFAULTS.resolution);
  assert.deepEqual(parseResolution('1024x768'), { width: 1024, height: 768 });
});

test('transport: kind auto-detection respects the platform', () => {
  assert.equal(detectKind({ transport: 'local' }), 'local');
  assert.equal(detectKind({ transport: 'wsl' }), 'wsl');
  const auto = detectKind({ transport: '' });
  assert.ok(auto === 'wsl' || auto === 'local');
});

test('transport: shell quoting survives quotes, spaces and CJK', () => {
  assert.equal(sh("it's"), `'it'\\''s'`);
  assert.equal(sh('/tmp/中文 path/x.png'), `'/tmp/中文 path/x.png'`);
  const value = `a'b"c$d\`e`;
  // The quoted form must round-trip through a POSIX shell unchanged.
  assert.equal(sh(value), `'a'\\''b"c$d\`e'`);
});

test('desktop: key=value parsing ignores diagnostics', () => {
  const parsed = parseKeyValues(
    ['openbox: warning', 'VNC_PORT=5902', 'READY=1', '', 'WEB_PORT=6082'].join('\n'),
  );
  assert.deepEqual(parsed, { VNC_PORT: '5902', READY: '1', WEB_PORT: '6082' });
});

test('control: an input tool flips idle -> agent and holds', () => {
  let now = 1000;
  const state = new ControlState({ holdMs: 500, now: () => now });
  assert.equal(state.get().state, 'idle');
  state.touch('click');
  assert.equal(state.get().state, 'agent');
  now += 400;
  assert.equal(state.get().state, 'agent', 'still inside the hold window');
  now += 200;
  assert.equal(state.get().state, 'idle', 'hold expired');
});

test('control: takeover blocks input until released', () => {
  const state = new ControlState({ holdMs: 100 });
  state.setUserActive(true);
  assert.throws(() => state.assertAgentMayAct('click'), (error) => {
    assert.ok(error instanceof ControlError);
    assert.equal(error.code, USER_IN_CONTROL);
    return true;
  });
  state.setUserActive(false);
  assert.doesNotThrow(() => state.assertAgentMayAct('click'));
});

test('control: subscribers observe every transition', () => {
  const state = new ControlState({ holdMs: 100 });
  const seen = [];
  state.subscribe((snapshot) => seen.push(snapshot.state));
  state.touch('key');
  state.setUserActive(true);
  state.setUserActive(false);
  assert.deepEqual(seen, ['agent', 'user', 'idle']);
});

test('control: a throwing subscriber cannot break the tool path', () => {
  const state = new ControlState({ holdMs: 100 });
  state.subscribe(() => {
    throw new Error('boom');
  });
  assert.doesNotThrow(() => state.touch('click'));
});
