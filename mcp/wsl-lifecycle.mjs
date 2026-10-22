/**
 * WSL2 lifecycle helpers: .wslconfig merging, idle release, distro probing.
 *
 * Two layers on purpose:
 *   - pure functions (parse/merge/decide/badge) — unit-testable without WSL;
 *   - side-effecting helpers (read/write .wslconfig, wsl.exe calls) — Windows
 *     host only, every call degraded to `{ supported: false }` elsewhere.
 *
 * Everything here runs on the HOST (Windows): the MCP server is a Windows
 * process that shells out to wsl.exe, exactly like the rest of mcp/*.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** WSL2 settings this plugin owns. Order is the write order in the file. */
export const WSL2_KEYS = ['memory', 'processors', 'swap', 'autoMemoryReclaim', 'sparseVhd'];

/** Badge states, in the order they must be tested (most specific first). */
export const BADGE = Object.freeze({
  off: '未启动',
  idle: '空闲',
  agent: 'DSH 操作中',
  user: '已人工接管',
  released: '已释放',
});

/* ------------------------------------------------------------------ paths */

export function wslconfigPath(home = os.homedir()) {
  return path.join(home, '.wslconfig');
}

export function wslcuDir(env = process.env) {
  const base = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'wslcu');
}

export const settingsFilePath = (env = process.env) => path.join(wslcuDir(env), 'settings.json');
export const statusFilePath = (env = process.env) => path.join(wslcuDir(env), 'status.json');

/** Where Windows-side artifacts (shots/exports/backups) land. */
export function outputDir(settings = {}, env = process.env) {
  const configured = String(settings.windowsOutputDir || '').trim();
  return configured || path.join(wslcuDir(env), 'output');
}

/* ------------------------------------------------------- pure: wslconfig */

/**
 * Parse a .wslconfig into `{ section: { key: value } }` (section '' = top).
 * Comments and blank lines are ignored; keys keep their last value.
 */
export function parseWslconfig(text = '') {
  const out = {};
  let section = '';
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const m = line.match(/^\[([^\]]+)\]$/);
    if (m) {
      section = m[1].trim().toLowerCase();
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[section] ??= {};
    out[section][key.toLowerCase()] = value;
  }
  return out;
}

/**
 * Merge `updates` (already WSL-flavoured values, e.g. `{ memory: '4GB' }`) into
 * the `[wsl2]` section of an existing .wslconfig, preserving every other line,
 * comment and section byte-for-byte. Missing keys are appended to the section.
 */
export function mergeWslconfig(text = '', updates = {}) {
  const entries = Object.entries(updates).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return String(text);

  const lines = String(text).split(/\r?\n/);
  const seen = new Set();
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let section = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^\[([^\]]+)\]$/);
    if (m) {
      const name = m[1].trim().toLowerCase();
      if (name === 'wsl2' && sectionStart < 0) sectionStart = i;
      else if (sectionStart >= 0 && sectionEnd === lines.length) sectionEnd = i;
      section = name;
      continue;
    }
    if (section !== 'wsl2' || !line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const hit = entries.find(([k]) => k.toLowerCase() === key);
    if (!hit) continue;
    lines[i] = `${hit[0]}=${hit[1]}`;
    seen.add(hit[0].toLowerCase());
  }

  const missing = entries.filter(([k]) => !seen.has(k.toLowerCase()));
  if (missing.length > 0) {
    if (sectionStart < 0) {
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      lines.push('[wsl2]', ...missing.map(([k, v]) => `${k}=${v}`), '');
    } else {
      const additions = missing.map(([k, v]) => `${k}=${v}`);
      lines.splice(sectionEnd, 0, ...additions);
    }
  }
  return lines.join('\n');
}

/** Map normalized settings onto the `[wsl2]` keys this plugin writes. */
export function wslconfigUpdates(settings = {}) {
  return {
    memory: `${settings.wslMemoryGb}GB`,
    processors: String(settings.wslProcessors),
    swap: `${settings.wslSwapGb}GB`,
    autoMemoryReclaim: settings.autoMemoryReclaim,
  };
}

/* -------------------------------------------------- pure: idle + badge */

/**
 * Should the managed distro be released right now?
 * `0` disables the feature; a fresh (post-release) activity resets the clock.
 */
export function shouldRelease(now, lastActivityAt, idleReleaseMin) {
  const minutes = Number(idleReleaseMin);
  const last = Number(lastActivityAt);
  if (!(minutes > 0) || !(last > 0)) return false;
  return Number(now) - last > minutes * 60000;
}

/**
 * Collapse the live desktop snapshot into exactly one badge state.
 * Order matters: a released distro outranks "not ready", and holding a pointer
 * outranks an in-flight tool call (the human must win).
 */
export function badgeStateOf(snapshot = {}) {
  const { desktop, state, releasedAt, distroRunning } = snapshot;
  const ready = Boolean(desktop?.ready);
  if (!ready && releasedAt) return 'released';
  if (!ready && distroRunning === false) return 'off';
  if (!ready) return 'off';
  if (state === 'user') return 'user';
  if (state === 'agent') return 'agent';
  return 'idle';
}

/** Human-facing payload for the badge (label + the detail line). */
export function badgeView(snapshot = {}) {
  const state = badgeStateOf(snapshot);
  const detail = state === 'agent'
    ? [snapshot.tool, snapshot.remainingMs > 0 ? `剩余 ${(snapshot.remainingMs / 1000).toFixed(1)}s` : '']
      .filter(Boolean).join(' · ')
    : state === 'user'
      ? (snapshot.by ? `持有者 ${snapshot.by}` : '人工接管中')
      : '';
  return { state, label: BADGE[state] || state, detail };
}

/* ------------------------------------------------------ side effects */

function winOnly() {
  return process.platform === 'win32';
}

async function wsl(args = [], timeoutMs = 20000) {
  if (!winOnly()) return { supported: false, ok: false, stdout: '', stderr: 'not windows' };
  try {
    const { stdout = '', stderr = '' } = await execFileAsync('wsl.exe', args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { supported: true, ok: true, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    return {
      supported: true,
      ok: false,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? ''),
      code: error?.code,
    };
  }
}

/** Read the current .wslconfig (never throws). */
export function readWslconfig(home = os.homedir()) {
  const file = wslconfigPath(home);
  try {
    return { path: file, exists: true, text: fs.readFileSync(file, 'utf8') };
  } catch {
    return { path: file, exists: false, text: '' };
  }
}

/**
 * Write the settings into .wslconfig, backing up the previous file first.
 * Returns what changed so the caller can report it truthfully.
 */
export function applyWslconfig(settings = {}, home = os.homedir()) {
  const file = wslconfigPath(home);
  const before = readWslconfig(home);
  const updates = wslconfigUpdates(settings);
  const after = mergeWslconfig(before.text, updates);
  const parsedBefore = parseWslconfig(before.text);
  const parsedAfter = parseWslconfig(after);

  if (after === before.text) {
    return { path: file, changed: false, backup: '', before: parsedBefore, after: parsedAfter };
  }

  let backup = '';
  if (before.exists) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  fs.writeFileSync(file, after, 'utf8');
  return { path: file, changed: true, backup, before: parsedBefore, after: parsedAfter };
}

/** Terminate the managed distro (frees the VM's memory; data is untouched). */
export async function terminateDistro(distro = '') {
  const target = String(distro || '').trim();
  return wsl(target ? ['--terminate', target] : ['--terminate'], 30000);
}

/**
 * Shut the whole WSL2 VM down. `.wslconfig` (memory/processors/swap) is only
 * read at VM boot, so this is the only way to apply a performance change — and
 * it stops EVERY distribution of this user.
 */
export async function shutdownWsl() {
  return wsl(['--shutdown'], 60000);
}

/** State of every distro, as `{ name, state, version, default }`. */
export async function listDistros() {
  const res = await wsl(['-l', '-v'], 20000);
  if (!res.supported) return { supported: false, distros: [] };
  const distros = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const text = line.replace(/\u0000/g, '').trimEnd();
    if (!text.trim()) continue;
    const m = text.match(/^(\*)?\s*(\S.*?)\s{2,}(Running|Stopped|Installing|Uninstalling|Converting|Installed)\s+(\d+)/i);
    if (m) {
      distros.push({ default: m[1] === '*', name: m[2].trim(), state: m[3], version: Number(m[4]) });
    }
  }
  return { supported: true, ok: res.ok, distros, raw: res.stdout };
}

/** Running state of one distro: true / false / null (unknown). */
export async function distroRunning(distro = '') {
  const { distros } = await listDistros();
  const target = String(distro || '').trim();
  if (distros.length === 0) return null;
  const hit = target ? distros.find((d) => d.name === target) : distros.find((d) => d.default) || distros[0];
  if (!hit) return null;
  return /^running$/i.test(hit.state);
}

/** Move a distro's vhdx to another Windows directory (slow, explicit only). */
export async function moveDistro(distro = '', targetDir = '') {
  const target = String(targetDir || '').trim();
  const name = String(distro || '').trim();
  if (!target) return { supported: winOnly(), ok: false, error: '目标目录为空' };
  if (!name) return { supported: winOnly(), ok: false, error: '未指定发行版' };
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (error) {
    return { supported: true, ok: false, error: `无法创建目标目录：${error.message}` };
  }
  const res = await wsl(['--manage', name, '--move', target], 30 * 60 * 1000);
  return { ...res, target, distro: name };
}

/* ------------------------------------------------------------ status file */

/** Read `%LOCALAPPDATA%\wslcu\status.json` (never throws). */
export function readStatus(env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(statusFilePath(env), 'utf8'));
  } catch {
    return {};
  }
}

/** Shallow-merge a patch into the status file; creates the directory on demand. */
export function writeStatus(patch = {}, env = process.env) {
  const file = statusFilePath(env);
  const current = readStatus(env);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch {
    return current;
  }
}

/* ------------------------------------------------------- status endpoint */

/** GET the viewer's `/state` (loopback, short timeout, never throws). */
export function fetchViewerState(port, timeoutMs = 900) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let req;
    try {
      req = http.get({ host: '127.0.0.1', port, path: '/state', timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return done(null);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64 * 1024) {
            res.destroy();
            done(null);
          }
        });
        res.on('end', () => {
          try {
            done(JSON.parse(body));
          } catch {
            done(null);
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        done(null);
      });
      req.on('error', () => done(null));
    } catch {
      done(null);
    }
  });
}

/**
 * Build the badge payload: live viewer state + released marker + distro state.
 * `probe` injects both side-effecting lookups, which is how it stays testable.
 */
export async function buildStatus(settings = {}, probe = {}) {
  const probeState = probe.fetchViewerState || fetchViewerState;
  const probeRunning = probe.distroRunning || distroRunning;
  const marker = probe.readStatus ? probe.readStatus() : readStatus();

  const [desktop, running] = await Promise.all([
    Promise.resolve()
      .then(() => probeState(settings.viewerPort))
      .catch(() => null),
    Promise.resolve()
      .then(() => probeRunning(settings.distro))
      .catch(() => null),
  ]);

  // `/state` answering at all means the viewer (and thus the desktop) is up;
  // its own `desktop` field can still report a partial state.
  const desktopInfo = desktop
    ? { ...(desktop.desktop || {}), ready: desktop.desktop?.ready ?? true }
    : null;

  const view = badgeView({
    desktop: desktopInfo,
    state: desktop?.state,
    tool: desktop?.tool,
    by: desktop?.by,
    remainingMs: desktop?.remainingMs,
    releasedAt: marker?.releasedAt,
    distroRunning: running,
  });

  return {
    ...view,
    distro: settings.distro || '',
    running,
    idleReleaseMin: Number(settings.idleReleaseMin) || 0,
    lastActivityAt: marker?.lastActivityAt ?? null,
    releasedAt: marker?.releasedAt ?? null,
    viewerPort: settings.viewerPort,
    at: Date.now(),
  };
}
