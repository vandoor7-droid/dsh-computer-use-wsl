/**
 * One execution surface for both deployment shapes.
 *
 *   kind === 'wsl'   -> wsl.exe -d <distro> [-u <user>] -- bash -s
 *   kind === 'local' -> bash -s
 *
 * The script is always fed through **stdin**, never through argv: that removes
 * quoting entirely (the single largest source of bugs when driving a Linux
 * desktop from Windows with paths in CJK).
 */

import { spawn } from 'node:child_process';

/** POSIX single-quote escaping, for the few places that really need argv. */
export function sh(value) {
  const s = String(value);
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Resolve which transport this process should use. */
export function detectKind(settings) {
  if (settings.transport === 'wsl' || settings.transport === 'local') return settings.transport;
  return process.platform === 'win32' ? 'wsl' : 'local';
}

function runProcess(bin, args, script, { timeoutMs = 30000, env = {} } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(bin, args, {
        windowsHide: true,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error?.message || error), timedOut: false });
      return;
    }
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish(-1);
    }, Math.max(1000, timeoutMs));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      stderr += String(error?.message || error);
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));
    child.stdin.on('error', () => {});
    child.stdin.end(script);
  });
}

/** First installed WSL distribution, or '' when the lookup fails. */
export async function detectDistro() {
  if (process.platform !== 'win32') return '';
  const result = await runProcess('wsl.exe', ['-l', '-q'], '', { timeoutMs: 15000 });
  const line = String(result.stdout || '')
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean);
  return line || '';
}

export class Transport {
  constructor(settings, options = {}) {
    this.settings = settings;
    this.kind = options.kind || detectKind(settings);
    this.distro = settings.distro || '';
    this.log = options.log || (() => {});
    this._distroReady = Boolean(this.distro) || this.kind !== 'wsl';
    this._hostCache = new Map();
  }

  get bin() {
    return this.kind === 'wsl' ? 'wsl.exe' : 'bash';
  }

  async ensureReady() {
    if (this._distroReady) return;
    this.distro = await detectDistro();
    this._distroReady = true;
  }

  args() {
    if (this.kind !== 'wsl') return ['-s'];
    const args = [];
    if (this.distro) args.push('-d', this.distro);
    if (this.settings.user) args.push('-u', this.settings.user);
    args.push('--', 'bash', '-s');
    return args;
  }

  /** Run a bash script on the target and return its output. */
  async run(script, options = {}) {
    await this.ensureReady();
    const { timeoutMs = 30000, env = {} } = options;
    const result = await runProcess(this.bin, this.args(), script, { timeoutMs, env });
    if (options.throwOnError && result.code !== 0) {
      const detail = (result.stderr || result.stdout || '').trim().slice(0, 800);
      throw new Error(`command failed (${result.code}${result.timedOut ? ', timeout' : ''}): ${detail}`);
    }
    return result;
  }

  /** Convert a Linux-side path into a path the host process can open. */
  async toHostPath(linuxPath) {
    if (this.kind !== 'wsl') return linuxPath;
    const key = String(linuxPath);
    if (this._hostCache.has(key)) return this._hostCache.get(key);
    const result = await runProcess('wsl.exe', this.args(), `wslpath -a -w ${sh(key)}`, { timeoutMs: 10000 });
    const mapped = String(result.stdout || '').trim() || key;
    this._hostCache.set(key, mapped);
    return mapped;
  }

  /** Convert a host-side path into a Linux-side path. */
  async toLinuxPath(hostPath) {
    if (this.kind !== 'wsl') return hostPath;
    const result = await runProcess('wsl.exe', this.args(), `wslpath -a -u ${sh(hostPath)}`, { timeoutMs: 10000 });
    return String(result.stdout || '').trim() || hostPath;
  }
}

export function createTransport(settings, options = {}) {
  return new Transport(settings, options);
}
