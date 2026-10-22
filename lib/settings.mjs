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
  distro: 'UbuntuLab',
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
  /**
   * Start with the human holding the pointer (the agent must wait for
   * 「交还给 DSH」). Off by default: the agent drives until the human takes over.
   */
  startHeldByUser: false,
  /** Allow the model to run arbitrary shell commands in the distribution */
  allowExec: false,
  failOnStartupError: false,
  toolCallTimeoutMs: 60000,

  /* ---- WSL2 resource allocation (written to %USERPROFILE%\.wslconfig) ----
   * VM-level knobs: they apply to EVERY WSL distribution of this user, not just
   * the managed one, and only take effect after the WSL2 VM restarts. Defaults
   * mirror the values used while the lab ran. */
  /** Memory cap for the WSL2 VM, in GB. */
  wslMemoryGb: 4,
  /** Logical processors given to the WSL2 VM. */
  wslProcessors: 2,
  /** Swap file size for the WSL2 VM, in GB (0 = no swap file). */
  wslSwapGb: 2,
  /** WSL2 autoMemoryReclaim: disabled | gradual | dropcache. */
  autoMemoryReclaim: 'disabled',

  /* ---- Locations on the real (Windows) system -------------------------- */
  /** Windows directory that should hold the distro vhdx; '' = WSL default.
   * Data only moves when the explicit wsl_move_distro tool is called. */
  distroDataDir: '',
  /** Windows directory for plugin artifacts (shots/exports/backups);
   * '' = %LOCALAPPDATA%\wslcu\output. */
  windowsOutputDir: '',

  /* ---- Idle release ---------------------------------------------------- */
  /** Minutes without an mcp__wslcu__* call before the managed distro is
   * terminated to give the VM's memory back; 0 = never release. */
  idleReleaseMin: 30,
});

const INT_FIELDS = ['vncPort', 'webPort', 'viewerPort', 'agentStateHoldMs', 'toolCallTimeoutMs'];
const BOOL_FIELDS = ['allowExec', 'failOnStartupError', 'startHeldByUser'];
const NONNEG_FIELDS = ['wslSwapGb', 'idleReleaseMin'];
/** Clamped (never rejected) integers, so a typo cannot silently disable a guard. */
const RANGED_FIELDS = {
  wslMemoryGb: [1, 128],
  wslProcessors: [1, 64],
  wslSwapGb: [0, 256],
  idleReleaseMin: [0, 1440],
};
const RECLAIM_MODES = ['disabled', 'gradual', 'dropcache'];
const STRING_FIELDS = ['distro', 'user', 'screenshotDir', 'stateDir', 'distroDataDir', 'windowsOutputDir'];
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
  for (const key of NONNEG_FIELDS) {
    const n = Number(out[key]);
    out[key] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULTS[key];
  }
  for (const [key, [min, max]] of Object.entries(RANGED_FIELDS)) {
    out[key] = Math.min(max, Math.max(min, out[key]));
  }
  for (const key of BOOL_FIELDS) out[key] = Boolean(out[key]);
  out.transport = ['wsl', 'local'].includes(out.transport) ? out.transport : '';
  out.display = /^:\d{1,3}$/.test(String(out.display)) ? String(out.display) : DEFAULTS.display;
  out.resolution = RESOLUTION_RE.test(String(out.resolution)) ? String(out.resolution) : DEFAULTS.resolution;
  out.autoMemoryReclaim = RECLAIM_MODES.includes(out.autoMemoryReclaim)
    ? out.autoMemoryReclaim
    : DEFAULTS.autoMemoryReclaim;
  out.bindHost = String(out.bindHost || DEFAULTS.bindHost);
  for (const key of STRING_FIELDS) out[key] = String(out[key] ?? '');
  return out;
}

/** Split a `WxH` resolution string. */
export function parseResolution(value) {
  const [w, h] = String(value).split('x').map(Number);
  return { width: w, height: h };
}
