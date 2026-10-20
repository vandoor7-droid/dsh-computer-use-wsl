/**
 * Virtual-desktop lifecycle.
 *
 * The bash scripts are shipped as files (so they stay reviewable) and are
 * concatenated with their settings preamble, then piped over the transport's
 * stdin. That is what makes "run this on Windows against WSL" and "run this
 * inside the distribution" the exact same code path.
 */

import { readFile } from 'node:fs/promises';
import { sh } from './transport.mjs';

const SCRIPTS_DIR = new URL('../scripts/', import.meta.url);

/** Parse `KEY=VALUE` lines emitted by the shell scripts. */
export function parseKeyValues(stdout) {
  const out = {};
  for (const raw of String(stdout || '').split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function composeScript(name, vars) {
  const [lib, body] = await Promise.all([
    readFile(new URL('lib.sh', SCRIPTS_DIR), 'utf8'),
    readFile(new URL(name, SCRIPTS_DIR), 'utf8'),
  ]);
  const assign = Object.entries(vars)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${sh(value)}`)
    .join('\n');
  // The preamble must come first so the scripts see the settings as locals.
  return `#!/usr/bin/env bash\n${assign}\n${lib}\n${body}\n`;
}

export class Desktop {
  constructor({ transport, settings }) {
    this.transport = transport;
    this.settings = settings;
    this.stateDir = settings.stateDir || '/tmp/wslcu';
    this.shotDir = settings.screenshotDir || `${this.stateDir}/shots`;
    this.last = null;
  }

  vars() {
    return {
      WSLCU_STATE_DIR: this.stateDir,
      WSLCU_DISPLAY_NUM: String(this.settings.display).replace(/^:/, ''),
      WSLCU_RESOLUTION: this.settings.resolution,
      WSLCU_VNC_PORT: this.settings.vncPort,
      WSLCU_WEB_PORT: this.settings.webPort,
      WSLCU_BIND: this.settings.bindHost,
    };
  }

  get display() {
    return this.settings.display;
  }

  /** Build the URLs the viewer and the model use, from the live ports. */
  urls(info = this.last || {}) {
    const webPort = Number(info.WEB_PORT || this.settings.webPort) || this.settings.webPort;
    const password = info.VNC_PASSWORD ?? '';
    const query = [
      'autoconnect=1',
      'resize=scale',
      'reconnect=1',
      'reconnect_delay=1500',
      'view_only=0',
    ];
    if (password) query.push(`password=${encodeURIComponent(password)}`);
    return {
      sidebarUrl: `http://127.0.0.1:${webPort}/vnc.html?${query.join('&')}`,
      webPort,
      vncPort: Number(info.VNC_PORT || this.settings.vncPort) || this.settings.vncPort,
    };
  }

  info(info) {
    const urls = this.urls(info);
    const ready = info.READY === '1' || (info.DISPLAY_ALIVE === '1' && info.WEB_ALIVE === '1');
    return {
      display: this.display,
      resolution: info.RESOLUTION || this.settings.resolution,
      owned: info.XVFB_OWNED === '1',
      xvfbPid: info.XVFB_PID || '',
      vncPort: urls.vncPort,
      webPort: urls.webPort,
      vncOwned: info.VNC_OWNED === '1',
      webOwned: info.WEB_OWNED === '1',
      bind: info.BIND || this.settings.bindHost,
      ready,
      sidebarUrl: urls.sidebarUrl,
      screenshotDir: this.shotDir,
    };
  }

  async up() {
    const script = await composeScript('desktop-up.sh', this.vars());
    const result = await this.transport.run(script, { timeoutMs: 120000 });
    const kv = parseKeyValues(result.stdout);
    if (result.code !== 0 || kv.READY !== '1') {
      const detail = (kv.ERROR || result.stderr || result.stdout || '').trim().slice(0, 600);
      const error = new Error(`desktop_up failed (exit ${result.code}): ${detail}`);
      error.code = 'DESKTOP_UP_FAILED';
      error.hint = kv.TOOLS_MISSING
        ? `Missing binaries: ${kv.TOOLS_MISSING}. Run the "bootstrap" tool.`
        : 'Check the log files under the plugin state directory.';
      throw error;
    }
    // Prefer a password read back from the probe: a reused display already had one.
    if (!kv.VNC_PASSWORD) {
      const probe = await this.probe();
      kv.VNC_PASSWORD = probe.VNC_PASSWORD || '';
    }
    this.last = kv;
    return this.info(kv);
  }

  async down() {
    const script = await composeScript('desktop-down.sh', this.vars());
    const result = await this.transport.run(script, { timeoutMs: 60000 });
    const kv = parseKeyValues(result.stdout);
    this.last = null;
    return { ...kv, code: result.code };
  }

  async probe() {
    const script = await composeScript('probe.sh', this.vars());
    const result = await this.transport.run(script, { timeoutMs: 30000 });
    const kv = parseKeyValues(result.stdout);
    if (kv.VNC_PASSWORD || kv.WEB_PORT) this.last = { ...(this.last || {}), ...kv };
    return { ...kv, info: this.info({ ...(this.last || {}), ...kv }) };
  }

  async bootstrap() {
    const script = await composeScript('bootstrap.sh', this.vars());
    const result = await this.transport.run(script, { timeoutMs: 600000 });
    return { ...parseKeyValues(result.stdout), code: result.code };
  }
}

export function createDesktop({ transport, settings }) {
  return new Desktop({ transport, settings });
}
