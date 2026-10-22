#!/usr/bin/env node
/**
 * MCP stdio server for the WSL/Linux desktop.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout, no dependencies.
 * Every mutating tool first asks ControlState whether the human owns the
 * pointer; observation tools always work.
 */

import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { hostname } from 'node:os';
import { normalizeSettings, parseResolution } from '../lib/settings.mjs';
import { createTransport } from './transport.mjs';
import { createDesktop } from './desktop.mjs';
import { createCapture } from './capture.mjs';
import { createInput } from './input.mjs';
import { ControlState, ControlError } from './takeover.mjs';
import { ControlFile } from './control-store.mjs';
import { textMatches, hasCondition } from './text-match.mjs';
import { startViewerServer } from './viewer-server.mjs';
import { sh } from './transport.mjs';
import {
  settingsFilePath,
  readStatus,
  writeStatus,
  readWslconfig,
  parseWslconfig,
  applyWslconfig,
  wslconfigUpdates,
  shouldRelease,
  terminateDistro,
  shutdownWsl,
  moveDistro,
  listDistros,
  distroRunning,
  outputDir,
} from './wsl-lifecycle.mjs';

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

function loadSettings() {
  const raw = process.env.WSLCU_SETTINGS_JSON;
  if (!raw) return normalizeSettings({});
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings({});
  }
}

const settings = loadSettings();
const log = (line) => process.stderr.write(`[wslcu] ${line}\n`);

const transport = createTransport(settings, { log });
const desktop = createDesktop({ transport, settings });
const capture = createCapture({ transport, settings, desktop });
const input = createInput({ transport, desktop });
const control = new ControlState({
  holdMs: settings.agentStateHoldMs,
  store: new ControlFile({
    dir: settings.stateDir || '/tmp/wslcu',
    owner: `${hostname()}/${process.pid}`,
  }),
});

// Some users want the desktop to be theirs until they explicitly hand it over:
// with `startHeldByUser` the agent begins in USER_IN_CONTROL and must wait for
// 「交还给 DSH」 instead of driving straight away.
if (settings.startHeldByUser) control.setUserActive(true);

// ---------------------------------------------------------------------------
// Live settings + idle release
// ---------------------------------------------------------------------------
// The bridge fixes our env at spawn time, so the host publishes settings edits
// to a file; re-reading it by mtime is what makes a volatile change take effect
// without restarting this process.
let settingsMtime = 0;
function refreshSettings() {
  const file = settingsFilePath();
  try {
    const stat = fs.statSync(file);
    if (stat.mtimeMs === settingsMtime) return false;
    settingsMtime = stat.mtimeMs;
    const next = normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
    Object.assign(settings, next); // in-place: desktop/capture/input share this object
    control.holdMs = Math.max(200, Number(settings.agentStateHoldMs) || 3000);
    log(`settings reloaded from ${file}`);
    return true;
  } catch {
    return false; // no published file yet: the env snapshot stands
  }
}

/** Last tool activity, the only clock the idle reaper trusts. */
let lastActivityAt = Date.now();
let releaseInFlight = false;
let nextReapCheckAt = 0;

function markActivity() {
  lastActivityAt = Date.now();
  const marker = readStatus();
  // Fresh activity resurrects a released distro: drop the old marker.
  writeStatus({
    lastActivityAt,
    distro: settings.distro || '',
    ...(marker.releasedAt ? { releasedAt: null } : {}),
  });
}

/**
 * Terminate the managed distro after `idleReleaseMin` minutes without an
 * mcp__wslcu__* call. 0 disables it. Only our own distro is touched, and the
 * data stays on disk; the next tool call cold-starts it again.
 */
async function reapIfIdle() {
  if (releaseInFlight) return;
  const now = Date.now();
  if (now < nextReapCheckAt) return;
  nextReapCheckAt = now + 30000;
  refreshSettings();
  const minutes = Number(settings.idleReleaseMin);
  if (!(minutes > 0)) return;
  if (!live.ready) return; // nothing of ours is running
  if (!shouldRelease(now, lastActivityAt, minutes)) return;

  releaseInFlight = true;
  try {
    const result = await terminateDistro(settings.distro);
    live.ready = false;
    const releasedAt = new Date().toISOString();
    writeStatus({ releasedAt, lastActivityAt, distro: settings.distro || '' });
    log(
      `idle release: terminated ${settings.distro || 'default distro'} after ${minutes}min without activity`
        + (result.ok ? '' : ` (${result.stderr || 'terminate failed'})`),
    );
  } catch (error) {
    log(`idle release failed: ${error?.message || error}`);
  } finally {
    releaseInFlight = false;
  }
}

/** Facts the model (and the badge) need about the WSL side, in one object. */
async function wslSummary() {
  const { distros } = await listDistros().catch(() => ({ distros: [] }));
  const name = settings.distro || '';
  const hit = name ? distros.find((d) => d.name === name) : distros.find((d) => d.default) || distros[0];
  const marker = readStatus();
  const cfg = parseWslconfig(readWslconfig().text);
  return {
    distro: name || hit?.name || '',
    state: hit?.state || 'unknown',
    running: hit ? /^running$/i.test(hit.state) : null,
    distros: distros.map((d) => ({ name: d.name, state: d.state, version: d.version })),
    config: cfg.wsl2 || {},
    idleReleaseMin: Number(settings.idleReleaseMin) || 0,
    lastActivityAt: new Date(lastActivityAt).toISOString(),
    releasedAt: marker.releasedAt || null,
    outputDir: outputDir(settings),
    distroDataDir: settings.distroDataDir || '',
  };
}

/** Last known desktop facts, kept fresh for the viewer shell. */
const live = {
  ready: false,
  owned: false,
  display: settings.display,
  resolution: settings.resolution,
  sidebarUrl: '',
  vncPort: 0,
  webPort: 0,
  transportKind: transport.kind,
  distro: '',
};

function absorb(info) {
  Object.assign(live, {
    ready: Boolean(info.ready),
    owned: Boolean(info.owned),
    display: info.display ?? live.display,
    resolution: info.resolution ?? live.resolution,
    sidebarUrl: info.sidebarUrl ?? live.sidebarUrl,
    vncPort: info.vncPort ?? live.vncPort,
    webPort: info.webPort ?? live.webPort,
  });
  return live;
}

const describe = () => ({ ...live, state: control.get().state, tool: control.get().tool });

let viewer = null;
async function ensureViewer() {
  if (viewer) return viewer;
  for (let offset = 0; offset < 10; offset += 1) {
    try {
      viewer = await startViewerServer({
        settings: { ...settings, viewerPort: settings.viewerPort + offset },
        control,
        describe,
        log,
      });
      return viewer;
    } catch (error) {
      if (offset === 9) throw error;
    }
  }
  return viewer;
}

let ticker = null;
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    control.tick();
    void reapIfIdle();
  }, 500);
  ticker.unref?.();
}

// ---------------------------------------------------------------------------
// Tool helpers
// ---------------------------------------------------------------------------

const DANGEROUS = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\$HOME)\s*$/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^\n]*\bof=\/dev\//,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bchmod\s+-R\s+777\s+\//,
  /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/,
  />\s*\/dev\/(sd|nvme|hd)/,
];

function assertSafeCommand(command) {
  for (const pattern of DANGEROUS) {
    if (pattern.test(command)) {
      throw new ControlError('DESTRUCTIVE_COMMAND', `refusing to run a destructive command: ${pattern}`, { command });
    }
  }
}

async function windowsList() {
  const script = [
    `export DISPLAY=${sh(desktop.display)}`,
    `command -v xdotool >/dev/null 2>&1 || { echo "NO_XDOTOOL=1"; exit 0; }`,
    `xdotool search --onlyvisible --name '.+' 2>/dev/null | while read -r id; do`,
    `  name=$(xdotool getwindowname "$id" 2>/dev/null || true)`,
    `  geo=$(xdotool getwindowgeometry --shell "$id" 2>/dev/null | tr '\\n' ' ')`,
    `  echo "W|$id|$name|$geo"`,
    `done`,
  ].join('\n');
  const result = await transport.run(script, { timeoutMs: 20000 });
  if (String(result.stdout).includes('NO_XDOTOOL=1')) return [];
  const out = [];
  for (const line of String(result.stdout).split(/\r?\n/)) {
    if (!line.startsWith('W|')) continue;
    const [, id, name, geo] = line.split('|');
    const get = (key) => {
      const match = new RegExp(`${key}=(-?\\d+)`).exec(geo || '');
      return match ? Number(match[1]) : 0;
    };
    out.push({ id: Number(id), title: name, x: get('X'), y: get('Y'), width: get('WIDTH'), height: get('HEIGHT') });
  }
  return out;
}

async function activateWindow(id) {
  const script = [
    `export DISPLAY=${sh(desktop.display)}`,
    // EWMH first (needs a window manager), then the WM-less fallbacks.
    `xdotool windowactivate --sync ${Number(id)} 2>/dev/null || xdotool windowfocus --sync ${Number(id)} 2>/dev/null || true`,
    `xdotool windowraise ${Number(id)} 2>/dev/null || true`,
  ].join('\n');
  await transport.run(script, { timeoutMs: 15000 });
}

async function resolvePoint(args) {
  if (args.window !== undefined && args.window !== null) {
    const id = Number(args.window);
    const list = await windowsList();
    const win = list.find((w) => w.id === id);
    if (!win) throw new Error(`window ${id} not found among ${list.length} visible windows`);
    await activateWindow(id);
    return {
      x: win.x + Math.round(Number(args.relX ?? 0)),
      y: win.y + Math.round(Number(args.relY ?? 0)),
      window: id,
    };
  }
  if (args.x === undefined || args.y === undefined) throw new Error('provide x/y, or window + relX/relY');
  return { x: Math.round(Number(args.x)), y: Math.round(Number(args.y)) };
}

// ---------------------------------------------------------------------------
// Tool table
// ---------------------------------------------------------------------------

const N = (description) => ({ type: 'number', description });

const tools = [
  {
    name: 'health',
    description: 'Report transport, display, VNC/noVNC ports, readiness and the sidebar/viewer URLs. Read-only; never starts or stops anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const probe = await desktop.probe();
      absorb(probe.info);
      const viewerInfo = await ensureViewer();
      startTicker();
      return {
        ok: true,
        version: VERSION,
        transport: transport.kind,
        distro: transport.distro || process.env.WSL_DISTRO_NAME || '',
        display: probe.DISPLAY_ALIVE === '1' ? desktop.display : '',
        displaySize: probe.DISPLAY_SIZE || '',
        ready: probe.DISPLAY_ALIVE === '1' && probe.WEB_ALIVE === '1',
        owned: live.owned,
        control: control.get(),
        vncPort: live.vncPort,
        webPort: live.webPort,
        sidebarUrl: live.sidebarUrl || probe.info?.sidebarUrl || '',
        viewerUrl: viewerInfo.url,
        state: control.get().state,
        missingTools: probe.TOOLS_MISSING || '',
        wsl: await wslSummary(),
        hint: 'Open viewerUrl in the sidebar (or call sidebar_open with it) so the human can watch and take over.',
      };
    },
  },
  {
    name: 'control_state',
    description: 'Read-only: who owns the pointer right now. The answer is shared across every instance driving this desktop (plugin, scripts, second profile), so a takeover started anywhere is visible everywhere. Check before acting when a human may be using the desktop.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      startTicker();
      const state = control.get();
      return {
        ok: true,
        holder: state.state,
        by: state.by || '',
        since: state.since,
        tool: state.tool || '',
        shared: Boolean(state.shared),
        humanInControl: state.state === 'user',
        hint:
          state.state === 'user'
            ? 'The human owns the desktop; mutating tools are refused until they hand it back.'
            : 'The agent may drive the desktop.',
      };
    },
  },
  {
    name: 'desktop_up',
    description: 'Start (or reuse) the virtual desktop: Xvfb + window manager + x11vnc + websockify. Idempotent; reuses an already-running display and reports owned=false in that case.',
    inputSchema: {
      type: 'object',
      properties: { resolution: { type: 'string', description: 'WxH, e.g. 1280x960' }, bootstrap: { type: 'boolean' } },
      additionalProperties: false,
    },
    handler: async (args) => {
      // Reserve the viewer port before websockify scans for a free one, so the
      // two can never fight over the same port.
      const viewerInfo = await ensureViewer();
      if (args.resolution) {
        parseResolution(args.resolution);
        desktop.settings.resolution = args.resolution;
      }
      if (args.bootstrap) await desktop.bootstrap();
      const info = absorb(await desktop.up());
      startTicker();
      return { ...info, viewerUrl: viewerInfo.url, state: control.get().state };
    },
  },
  {
    name: 'desktop_down',
    description: 'Stop the desktop processes this plugin started. Never stops a display it did not start (owned=false).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const result = await desktop.down();
      live.ready = false;
      return { ...result, ready: false };
    },
  },
  {
    name: 'bootstrap',
    description: 'Install the desktop prerequisites inside the distribution (xvfb, x11vnc, xdotool, imagemagick, xclip, openbox, novnc, websockify). Explicit only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => desktop.bootstrap(),
  },
  {
    name: 'launch',
    description:
      'Start a GUI application (or any long-running command) detached on the virtual display, and report whether it is still alive. '
      + 'Use this instead of a bare "cmd &" in exec: WSL reaps background jobs when the invoking shell exits, so a plain ampersand dies silently.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'shell command to run, e.g. "xterm -e bash"' },
        logName: { type: 'string', description: 'log file base name (default: derived from command)' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    handler: async (args) => {
      control.assertAgentMayAct('launch');
      const command = String(args.command || '').trim();
      if (!command) throw new ControlError('BAD_ARGUMENT', 'command is required');
      control.touch('launch');
      const logDir = `${settings.stateDir || '/tmp/wslcu'}/apps`;
      const base = String(args.logName || command.split(/\s+/)[0] || 'app').replace(/[^\w.-]+/g, '_').slice(0, 40);
      const logFile = `${logDir}/${base}-${Date.now()}.log`;
      const script = [
        `mkdir -p ${sh(logDir)}`,
        `export DISPLAY=${sh(desktop.display)}`,
        `unset WAYLAND_DISPLAY WAYLAND_SOCKET`,
        `nohup bash -c ${sh(command)} </dev/null >${sh(logFile)} 2>&1 &`,
        'PID=$!',
        'sleep 0.6',
        'if kill -0 "$PID" 2>/dev/null; then echo "ALIVE=1"; else echo "ALIVE=0"; fi',
        'echo "PID=$PID"',
        `echo "LOG=${logFile}"`,
      ].join('\n');
      const result = await transport.run(script, { timeoutMs: 30000 });
      const kv = {};
      for (const line of String(result.stdout).split(/\r?\n/)) {
        const match = /^(ALIVE|PID|LOG)=(.*)$/.exec(line.trim());
        if (match) kv[match[1]] = match[2];
      }
      let tail = '';
      if (kv.ALIVE !== '1' && kv.LOG) {
        const read = await transport.run(`tail -n 15 ${sh(kv.LOG)} 2>/dev/null || true`, { timeoutMs: 10000 });
        tail = String(read.stdout || '').trim();
      }
      return {
        alive: kv.ALIVE === '1',
        pid: kv.PID ? Number(kv.PID) : null,
        log: kv.LOG || logFile,
        ...(tail ? { logTail: tail } : {}),
        hint: 'A GUI app needs its window mapped; follow with wait_window to confirm it is on screen.',
      };
    },
  },
  {
    name: 'snapshot',
    description: 'Capture the display (or one window) into a PNG and return its file path. The bridge drops MCP image blocks, so open the returned path with read_image.',
    inputSchema: {
      type: 'object',
      properties: {
        window: { type: 'number', description: 'xdotool window id' },
        region: { type: 'string', description: 'ImageMagick crop geometry, e.g. 800x600+10+20' },
        saveAs: { type: 'string', description: 'base name without extension' },
      },
      additionalProperties: false,
    },
    handler: async (args) => capture.snapshot(args),
  },
  {
    name: 'windows',
    description: 'List visible windows with their geometry. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ({ windows: await windowsList() }),
  },
  {
    name: 'wait_window',
    description: 'Wait until a visible window whose title contains the given text appears.',
    inputSchema: {
      type: 'object',
      properties: { titleContains: { type: 'string' }, timeoutMs: N('default 15000') },
      required: ['titleContains'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const deadline = Date.now() + Math.max(500, Number(args.timeoutMs) || 15000);
      const needle = String(args.titleContains).toLowerCase();
      for (;;) {
        const list = await windowsList();
        const hit = list.find((w) => String(w.title).toLowerCase().includes(needle));
        if (hit) return { found: true, window: hit, waitedMs: Math.max(0, Date.now() - (deadline - (Number(args.timeoutMs) || 15000))) };
        if (Date.now() > deadline) return { found: false, windows: list };
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    },
  },
  {
    name: 'click',
    description: 'Click a point (absolute x/y, or window + relX/relY). Mutating: refused while the human is in control.',
    inputSchema: {
      type: 'object',
      properties: {
        x: N(), y: N(), window: N('xdotool window id'), relX: N(), relY: N(),
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        count: N('1..3'),
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      control.assertAgentMayAct('click');
      control.touch('click');
      const point = await resolvePoint(args);
      const result = await input.click({ ...args, ...point });
      return { ...result, window: point.window ?? null, state: control.get().state };
    },
  },
  {
    name: 'move',
    description: 'Move the pointer to an absolute point. Mutating.',
    inputSchema: { type: 'object', properties: { x: N(), y: N() }, required: ['x', 'y'], additionalProperties: false },
    handler: async (args) => {
      control.assertAgentMayAct('move');
      control.touch('move');
      return input.move(args);
    },
  },
  {
    name: 'drag',
    description: 'Press, move and release the pointer between two absolute points. Mutating.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'object', properties: { x: N(), y: N() }, required: ['x', 'y'] },
        to: { type: 'object', properties: { x: N(), y: N() }, required: ['x', 'y'] },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    handler: async (args) => {
      control.assertAgentMayAct('drag');
      control.touch('drag');
      return input.drag(args);
    },
  },
  {
    name: 'scroll',
    description: 'Scroll at a point (positive deltaY scrolls down). Mutating.',
    inputSchema: {
      type: 'object',
      properties: { x: N(), y: N(), deltaY: N(), deltaX: N() },
      additionalProperties: false,
    },
    handler: async (args) => {
      control.assertAgentMayAct('scroll');
      control.touch('scroll');
      return input.scroll(args);
    },
  },
  {
    name: 'type_text',
    description: 'Type text at the current focus. Default method "auto" uses synthetic keys for ASCII and the clipboard for anything containing CJK. Mutating.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        method: { type: 'string', enum: ['auto', 'clipboard', 'xtest'] },
        pasteChord: { type: 'string', description: 'paste chord for the clipboard path (default ctrl+v; xterm needs ctrl+shift+v)' },
        target: { type: 'number', description: 'optional window id to activate first' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    handler: async (args) => {
      control.assertAgentMayAct('type_text');
      control.touch('type_text');
      if (args.target) await activateWindow(args.target);
      return input.typeText(args);
    },
  },
  {
    name: 'key',
    description: 'Press a key chord such as ["ctrl","shift","p"]. Mutating.',
    inputSchema: {
      type: 'object',
      properties: { keys: { type: 'array', items: { type: 'string' } } },
      required: ['keys'],
      additionalProperties: false,
    },
    handler: async (args) => {
      control.assertAgentMayAct('key');
      control.touch('key');
      return input.key(args);
    },
  },
  {
    name: 'read_all_text',
    description: 'Read the focused document as text (select-all + copy, then read the clipboard; the previous clipboard is restored). Vision-free and greppable — usually cheaper and more reliable than a screenshot for understanding a page. If focus sits inside a text input, the copy returns the value of that field instead of the page text: click a blank area first when you need the page. Mutating: it changes the selection.',
    inputSchema: {
      type: 'object',
      properties: {
        maxChars: { type: 'number', description: 'cap the returned text (default 200000)' },
        target: { type: 'number', description: 'optional window id to activate first' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      control.assertAgentMayAct('read_all_text');
      control.touch('read_all_text');
      if (args.target) await activateWindow(args.target);
      return input.readAllText(args);
    },
  },
  {
    name: 'wait_text',
    description: 'Wait until the focused document satisfies a text condition (contains / absent / regex), polling read_all_text. Use it instead of guessing sleeps: e.g. wait for 「部署成功」 to appear, or for a spinner label to disappear. Mutating: it copies.',
    inputSchema: {
      type: 'object',
      properties: {
        contains: { type: 'string', description: 'text that must be present' },
        absent: { type: 'string', description: 'text that must be gone' },
        regex: { type: 'string', description: 'regular expression that must match' },
        timeoutMs: { type: 'number', description: 'give up after this long (default 15000)' },
        intervalMs: { type: 'number', description: 'poll interval (default 500)' },
        maxChars: { type: 'number', description: 'cap the captured text (default 200000)' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!hasCondition(args)) throw new ControlError('BAD_ARGUMENT', 'wait_text needs at least one of contains / absent / regex');
      control.assertAgentMayAct('wait_text');
      control.touch('wait_text');
      const timeout = Math.max(300, Number(args.timeoutMs) || 15000);
      const interval = Math.max(150, Math.min(5000, Number(args.intervalMs) || 500));
      const started = Date.now();
      let last = { text: '', bytes: 0, truncated: false };
      for (;;) {
        last = await input.readAllText({ maxChars: args.maxChars });
        const waitedMs = Date.now() - started;
        if (textMatches(last.text, args)) return { matched: true, waitedMs, ...last };
        if (waitedMs >= timeout) return { matched: false, waitedMs, ...last };
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    },
  },
  {
    name: 'takeover',
    description: 'Human takeover switch: start = the human drives (all mutating tools are refused), stop = hand back to the agent, status = read only.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['start', 'stop', 'status'] } },
      required: ['action'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (args.action === 'status') return { ...control.get(), desktop: describe() };
      const snapshot = control.setUserActive(args.action === 'start');
      return { ...snapshot, desktop: describe() };
    },
  },
  {
    name: 'exec',
    description: 'Run a shell command inside the distribution (guarded). Disabled unless allowExec is on; destructive commands are always refused.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: N('default 30000'),
        allowDestructive: { type: 'boolean', description: 'ignored: destructive commands are always refused' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!settings.allowExec) {
        throw new ControlError(
          'EXEC_DISABLED',
          'exec is disabled. Enable allowExec in the plugin settings if you really want the model running shell commands.',
        );
      }
      control.assertAgentMayAct('exec');
      const command = String(args.command || '');
      assertSafeCommand(command);
      control.touch('exec');
      const script = [args.cwd ? `cd ${sh(args.cwd)}` : '', command].filter(Boolean).join('\n');
      const result = await transport.run(script, { timeoutMs: Math.max(1000, Number(args.timeoutMs) || 30000) });
      return {
        code: result.code,
        stdout: result.stdout.slice(-8000),
        stderr: result.stderr.slice(-4000),
        timedOut: result.timedOut,
      };
    },
  },
  {
    name: 'wsl_apply_perf',
    description:
      'Write the configured WSL2 performance limits (memory / processors / swap / autoMemoryReclaim) into %USERPROFILE%\\.wslconfig, backing the old file up first. '
      + 'These knobs apply to EVERY WSL distribution of this user and are only read when the WSL2 VM boots, so pass restart=true to shut the VM down and apply them now. '
      + 'Nothing is deleted: the previous .wslconfig is kept next to it as .wslconfig.bak-<timestamp>.',
    inputSchema: {
      type: 'object',
      properties: {
        restart: { type: 'boolean', description: 'shut the WSL2 VM down afterwards so the new limits take effect (stops every distro until the next call)' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      refreshSettings();
      const result = applyWslconfig(settings);
      let restarted = null;
      if (args.restart) {
        const res = await shutdownWsl();
        live.ready = false;
        restarted = { ok: Boolean(res.ok), stderr: res.stderr || '' };
      }
      return {
        ok: true,
        path: result.path,
        changed: result.changed,
        backup: result.backup,
        applied: wslconfigUpdates(settings),
        wslconfig: result.after?.wsl2 || {},
        restarted,
        hint: restarted
          ? 'VM shut down; the next mcp__wslcu__* call cold-starts it with the new limits.'
          : 'Written but not applied yet: .wslconfig is read at VM boot, so call again with restart=true (or run wsl --shutdown yourself).',
      };
    },
  },
  {
    name: 'wsl_release',
    description:
      'Release the managed WSL distribution right now: terminate it so the VM gives its memory back. Data is untouched and the next mcp__wslcu__* call cold-starts it again. '
      + 'The same thing happens automatically after idleReleaseMin minutes without activity.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      refreshSettings();
      const distro = settings.distro || '';
      const result = await terminateDistro(distro);
      live.ready = false;
      const releasedAt = new Date().toISOString();
      writeStatus({ releasedAt, lastActivityAt, distro });
      return {
        ok: Boolean(result.ok),
        distro: distro || '(default)',
        releasedAt,
        stderr: result.stderr || '',
        hint: 'The distro is stopped. The next tool call will cold-start it (a few seconds).',
      };
    },
  },
  {
    name: 'wsl_move_distro',
    description:
      'Move the distribution\'s virtual disk to the Windows directory configured in distroDataDir (explicit confirm=true required). '
      + 'Uses the official `wsl --manage <distro> --move`; it can take minutes and needs toolCallTimeoutMs raised well above the default. '
      + 'On failure the original disk stays where it is.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Windows directory; defaults to the distroDataDir setting' },
        confirm: { type: 'boolean', description: 'must be true: this is a long, disruptive operation' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      refreshSettings();
      if (args.confirm !== true) {
        throw new ControlError(
          'CONFIRM_REQUIRED',
          'wsl_move_distro needs confirm=true: it moves the whole distribution disk and can take minutes.',
        );
      }
      const target = String(args.target || settings.distroDataDir || '').trim();
      if (!target) {
        throw new ControlError('TARGET_REQUIRED', 'Set distroDataDir in the plugin settings, or pass target explicitly.');
      }
      const result = await moveDistro(settings.distro, target);
      writeStatus({ distroDataDir: target });
      return {
        ok: Boolean(result.ok),
        distro: settings.distro || '(default)',
        target,
        stderr: result.stderr || '',
        error: result.error || '',
        hint: result.ok ? 'Disk moved. Run wsl_apply_perf with restart=true if WSL asks for a restart.' : 'Nothing moved: the original disk is still in place.',
      };
    },
  },
];

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function replyError(id, code, message, data) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data } })}\n`);
}

async function handleCall(name, args) {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  refreshSettings();
  markActivity();
  const value = await tool.handler(args || {});
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

async function dispatch(message) {
  const { id, method, params } = message;
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'wslcu', version: VERSION },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') {
      reply(id, {});
      return;
    }
    if (method === 'tools/list') {
      reply(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
      return;
    }
    if (method === 'tools/call') {
      const name = params?.name;
      try {
        reply(id, await handleCall(name, params?.arguments));
      } catch (error) {
        reply(id, {
          content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }],
          structuredContent: { error: error.code || 'ERROR', message: error.message, ...(error.state ? { state: error.state } : {}) },
          isError: true,
        });
      }
      return;
    }
    if (method === 'resources/list') {
      reply(id, { resources: [] });
      return;
    }
    if (method === 'prompts/list') {
      reply(id, { prompts: [] });
      return;
    }
    if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
  } catch (error) {
    if (id !== undefined) replyError(id, -32603, error?.message || String(error));
    else log(`notification error: ${error?.message || error}`);
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const probe = await desktop.probe().catch((error) => ({ error: error.message }));
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          version: VERSION,
          transport: transport.kind,
          distro: transport.distro,
          settings,
          tools: tools.map((tool) => tool.name),
          probe,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  await ensureViewer().catch((error) => log(`viewer unavailable: ${error.message}`));
  startTicker();

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      replyError(null, -32700, 'parse error');
      return;
    }
    void dispatch(message);
  });
  rl.on('close', () => {
    process.exit(0);
  });
  log(`ready transport=${transport.kind} display=${desktop.display}`);
}

main().catch((error) => {
  log(`fatal: ${error?.stack || error}`);
  process.exit(1);
});
