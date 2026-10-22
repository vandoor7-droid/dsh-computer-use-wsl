/**
 * L0 — pure-logic units. No X server, no WSL, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULTS, parseResolution } from '../lib/settings.mjs';
import { sh, detectKind } from '../mcp/transport.mjs';
import { parseKeyValues } from '../mcp/desktop.mjs';
import { ControlState, ControlError, USER_IN_CONTROL } from '../mcp/takeover.mjs';
import { textMatches, hasCondition } from '../mcp/text-match.mjs';
import {
  parseWslconfig,
  mergeWslconfig,
  wslconfigUpdates,
  shouldRelease,
  badgeStateOf,
  badgeView,
  buildStatus,
  outputDir,
} from '../mcp/wsl-lifecycle.mjs';

test('settings: defaults are complete and frozen', () => {
  const settings = normalizeSettings({});
  assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULTS).sort());
  assert.equal(settings.resolution, '1280x960');
  assert.equal(settings.bindHost, '127.0.0.1');
  assert.equal(settings.allowExec, false);
  // The agent drives by default; only an explicit setting makes the human own
  // the pointer from the start.
  assert.equal(settings.startHeldByUser, false);
});

test('settings: unknown keys are dropped and scalars coerced', () => {
  const settings = normalizeSettings({ vncPort: '5905', allowExec: 'yes', bogus: 1, display: 'nope' });
  assert.equal(settings.vncPort, 5905);
  assert.equal(settings.allowExec, true);
  assert.equal(settings.bogus, undefined);
  assert.equal(settings.display, ':99');
  assert.equal(normalizeSettings({ startHeldByUser: 'yes' }).startHeldByUser, true);
  assert.equal(normalizeSettings({ startHeldByUser: 0 }).startHeldByUser, false);
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
test('textMatches: contains / absent / regex combine with AND', () => {
  const text = '正在部署… / 部署成功 / 共 3 项';
  assert.equal(textMatches(text, { contains: '部署成功' }), true);
  assert.equal(textMatches(text, { contains: '部署失败' }), false);
  assert.equal(textMatches(text, { absent: '正在部署' }), false);
  assert.equal(textMatches(text, { contains: '部署成功', absent: '正在部署' }), false);
  assert.equal(textMatches(text, { regex: '共\\s*\\d+\\s*项' }), true);
  assert.equal(textMatches(text, { regex: '(' }), false, 'an invalid pattern never matches');
});

test('textMatches: case-insensitive by default, and empty conditions match', () => {
  assert.equal(textMatches('Deployed OK', { contains: 'deployed ok' }), true);
  assert.equal(textMatches('Deployed OK', { contains: 'deployed ok', ignoreCase: false }), false);
  assert.equal(textMatches('x', {}), true);
  assert.equal(hasCondition({}), false);
  assert.equal(hasCondition({ contains: '' }), false);
  assert.equal(hasCondition({ contains: 'a' }), true);
});

/* ---------------------------------------------- wsl-lifecycle (pure) */

test('wslconfig: parse ignores comments and keeps sections apart', () => {
  const parsed = parseWslconfig(
    ['# top', '[wsl2]', 'memory=4GB', 'processors=2', '', '[experimental]', 'sparseVhd=true'].join('\n'),
  );
  assert.equal(parsed.wsl2.memory, '4GB');
  assert.equal(parsed.wsl2.processors, '2');
  assert.equal(parsed.experimental.sparsevhd, 'true', 'keys are compared case-insensitively (stored lowercased)');
  assert.equal(parsed.wsl2['# top'], undefined);
});

test('wslconfig: merge rewrites owned keys but preserves everything else', () => {
  const before = [
    '# my comment survives',
    '[wsl2]',
    'memory=8GB',
    'kernel=/custom/kernel',
    '',
    '[experimental]',
    'autoMemoryReclaim=gradual',
  ].join('\n');
  const after = mergeWslconfig(before, { memory: '4GB', processors: '2' });
  assert.match(after, /# my comment survives/);
  assert.match(after, /memory=4GB/);
  assert.doesNotMatch(after, /memory=8GB/);
  assert.match(after, /kernel=\/custom\/kernel/, 'unowned keys are untouched');
  assert.match(after, /processors=2/, 'missing owned keys are appended');
  assert.match(after, /\[experimental\][\s\S]*autoMemoryReclaim=gradual/);
  // Idempotent: merging the same values twice changes nothing further.
  assert.equal(mergeWslconfig(after, { memory: '4GB', processors: '2' }), after);
});

test('wslconfig: a missing [wsl2] section is created', () => {
  const after = mergeWslconfig('[experimental]\nsparseVhd=true\n', { memory: '6GB' });
  assert.match(after, /\[wsl2\]\nmemory=6GB/);
  assert.match(after, /\[experimental\]/);
  assert.equal(mergeWslconfig('', {}), '', 'no updates leaves the file alone');
});

test('wslconfig: settings map onto VM knobs', () => {
  const updates = wslconfigUpdates({ wslMemoryGb: 6, wslProcessors: 3, wslSwapGb: 0, autoMemoryReclaim: 'gradual' });
  assert.deepEqual(updates, { memory: '6GB', processors: '3', swap: '0GB', autoMemoryReclaim: 'gradual' });
});

test('lifecycle: idle release honours 0 = off and the threshold', () => {
  const now = 10_000_000;
  assert.equal(shouldRelease(now, now - 3600_000, 0), false, '0 disables the reaper');
  assert.equal(shouldRelease(now, now - 60_000, 30), false, 'inside 30 min');
  assert.equal(shouldRelease(now, now - 31 * 60_000, 30), true, 'past 30 min');
  assert.equal(shouldRelease(now, 0, 30), false, 'unknown activity never releases');
});

test('badge: the five states are exclusive and ordered', () => {
  assert.equal(badgeStateOf({ desktop: { ready: false }, releasedAt: 'x' }), 'released');
  assert.equal(badgeStateOf({ desktop: { ready: false }, distroRunning: false }), 'off');
  assert.equal(badgeStateOf({ desktop: { ready: false } }), 'off');
  assert.equal(badgeStateOf({ desktop: { ready: true }, state: 'idle' }), 'idle');
  assert.equal(badgeStateOf({ desktop: { ready: true }, state: 'agent', tool: 'click' }), 'agent');
  assert.equal(badgeStateOf({ desktop: { ready: true }, state: 'user', by: 'PC' }), 'user');
  // A live desktop always outranks a stale release marker.
  assert.equal(badgeStateOf({ desktop: { ready: true }, state: 'idle', releasedAt: 'x' }), 'idle');
});

test('badge: view carries the label and a tool/holder detail', () => {
  assert.deepEqual(badgeView({ desktop: { ready: false } }), { state: 'off', label: '未启动', detail: '' });
  const agent = badgeView({ desktop: { ready: true }, state: 'agent', tool: 'click', remainingMs: 2000 });
  assert.equal(agent.label, 'DSH 操作中');
  assert.match(agent.detail, /click/);
  assert.match(agent.detail, /2\.0s/);
  assert.equal(badgeView({ desktop: { ready: true }, state: 'user', by: 'DESKTOP-1' }).detail, '持有者 DESKTOP-1');
});

test('settings: new WSL fields clamp instead of exploding', () => {
  const s = normalizeSettings({
    wslMemoryGb: '999',
    wslProcessors: -3,
    wslSwapGb: -1,
    autoMemoryReclaim: 'nonsense',
    idleReleaseMin: '1',
    distroDataDir: 'D:\\WSL',
    windowsOutputDir: 'E:\\out',
  });
  assert.equal(s.wslMemoryGb, 128, 'clamped to the ceiling');
  assert.equal(s.wslProcessors, 1, 'clamped to the floor');
  assert.equal(s.wslSwapGb, DEFAULTS.wslSwapGb, 'a negative swap is invalid and falls back to the default');
  assert.equal(s.autoMemoryReclaim, DEFAULTS.autoMemoryReclaim, 'unknown mode falls back');
  assert.equal(s.idleReleaseMin, 1);
  assert.equal(s.distroDataDir, 'D:\\WSL');
  assert.equal(s.windowsOutputDir, 'E:\\out');
  assert.equal(normalizeSettings({ idleReleaseMin: 0 }).idleReleaseMin, 0, '0 is a legal value (off)');
});

test('lifecycle: output dir honours the setting, else the default folder', () => {
  assert.equal(outputDir({ windowsOutputDir: 'E:\\shots' }, {}), 'E:\\shots');
  assert.match(outputDir({}, { LOCALAPPDATA: 'C:\\Local' }), /wslcu[\\/]output$/);
});

test('status: the payload merges viewer state, marker and distro state', async () => {
  const settings = { distro: 'UbuntuLab', viewerPort: 6081, idleReleaseMin: 30 };

  const live = await buildStatus(settings, {
    fetchViewerState: async () => ({ state: 'agent', tool: 'click', remainingMs: 1500, desktop: { ready: true } }),
    distroRunning: async () => true,
    readStatus: () => ({ lastActivityAt: 123 }),
  });
  assert.equal(live.state, 'agent');
  assert.equal(live.label, 'DSH 操作中');
  assert.match(live.detail, /click/);
  assert.equal(live.running, true);
  assert.equal(live.lastActivityAt, 123);

  const stopped = await buildStatus(settings, {
    fetchViewerState: async () => null,
    distroRunning: async () => false,
    readStatus: () => ({}),
  });
  assert.equal(stopped.state, 'off');
  assert.equal(stopped.label, '未启动');

  const released = await buildStatus(settings, {
    fetchViewerState: async () => null,
    distroRunning: async () => false,
    readStatus: () => ({ releasedAt: '2026-10-22T08:00:00.000Z' }),
  });
  assert.equal(released.state, 'released');
  assert.equal(released.label, '已释放');

  // A probe that throws must not take the endpoint down.
  const tolerant = await buildStatus(settings, {
    fetchViewerState: async () => { throw new Error('boom'); },
    distroRunning: async () => { throw new Error('boom'); },
    readStatus: () => ({}),
  });
  assert.equal(tolerant.state, 'off');
});