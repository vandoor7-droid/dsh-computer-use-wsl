/**
 * Configuration defaults and normalization.
 *
 * Every field is a plain JSON scalar so the same object can travel through a
 * DSH settings form, an env var and the MCP stdio handshake without loss.
 */

export const DEFAULTS = Object.freeze({
  /** '' = auto (win32 -> wsl, linux -> local) */
  transport: '',
  /** WSL distribution; '' = the default one */
  distro: '',
  /** WSL user; '' = the distribution default */
  user: '',
  /** X display the desktop runs on */
  display: ':99',
  /** WxH, 4:3 by default because the sidebar is narrow */
  resolution: '1280x960',
  vncPort: 5900,
  webPort: 6080,
  viewerPort: 6081,
  /** Linux-side directory for screenshots; '' = ~/.cache/wslcu/shots */
  screenshotDir: '',
  /** Linux-side runtime directory; '' = /tmp/wslcu */
  stateDir: '',
  /** websockify bind address; loopback only by default */
  bindHost: '127.0.0.1',
  /** How long the viewer keeps showing the agent state after the last action */
  agentStateHoldMs: 3000,
  /** Allow the model to run arbitrary shell commands in the distribution */
  allowExec: false,
  failOnStartupError: false,
  toolCallTimeoutMs: 60000,
});

const INT_FIELDS = ['vncPort', 'webPort', 'viewerPort', 'agentStateHoldMs', 'toolCallTimeoutMs'];
const BOOL_FIELDS = ['allowExec', 'failOnStartupError'];
const RESOLUTION_RE = /^\d{2,5}x\d{2,5}$/;

/**
 * Coerce unknown input into a complete, valid settings object.
 * Unknown keys are dropped so a stale profile entry cannot smuggle them in.
 */
export function normalizeSettings(input = {}) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (input[key] === undefined || input[key] === null) continue;
    out[key] = input[key];
  }
  for (const key of INT_FIELDS) {
    const n = Number(out[key]);
    out[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULTS[key];
  }
  for (const key of BOOL_FIELDS) out[key] = Boolean(out[key]);
  out.transport = ['wsl', 'local'].includes(out.transport) ? out.transport : '';
  out.display = /^:\d{1,3}$/.test(String(out.display)) ? String(out.display) : DEFAULTS.display;
  out.resolution = RESOLUTION_RE.test(String(out.resolution)) ? String(out.resolution) : DEFAULTS.resolution;
  out.bindHost = String(out.bindHost || DEFAULTS.bindHost);
  for (const key of ['distro', 'user', 'screenshotDir', 'stateDir']) out[key] = String(out[key] ?? '');
  return out;
}

/** Split a `WxH` resolution string. */
export function parseResolution(value) {
  const [w, h] = String(value).split('x').map(Number);
  return { width: w, height: h };
}
