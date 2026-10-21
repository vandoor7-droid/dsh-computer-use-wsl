/**
 * Cross-instance control state.
 *
 * The in-process ControlState is enough for one MCP server, but a desktop can
 * be driven by more than one entry point at the same time (the DSH plugin
 * instance, a script, a second profile). With process-local state alone,
 * "the human took over" was only true for the instance whose button was
 * clicked: every other instance still saw `idle` and happily moved the pointer.
 * That is exactly what happened in practice, so ownership now lives on disk.
 *
 * Layout: $stateDir/control.json
 *   { holder: 'user'|'agent', by: '<host>/<pid>', pid, tool, since, hb }
 *
 * * writes are atomic (temp file + rename) so a reader never sees half a file;
 * * every holder refreshes `hb` on tick; a record older than STALE_MS is
 *   treated as released, so a crashed instance cannot lock the desktop forever;
 * * claiming `user` never steals from another live owner — the caller gets the
 *   existing record back instead.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STALE_MS = 8000;

export class ControlFile {
  constructor({ dir, owner }) {
    this.dir = dir || '/tmp/wslcu';
    this.owner = owner || `${process.pid}`;
    this.path = join(this.dir, 'control.json');
    this.enabled = true;
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      this.enabled = false;
    }
  }

  /** Latest record, or null. A stale record is returned with `stale: true`. */
  read() {
    if (!this.enabled) return null;
    try {
      const record = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!record || typeof record !== 'object') return null;
      const hb = Number(record.hb || 0);
      const stale = !hb || Date.now() - hb > STALE_MS;
      return { ...record, stale };
    } catch {
      return null;
    }
  }

  write(record) {
    if (!this.enabled) return null;
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
      renameSync(tmp, this.path);
      return record;
    } catch {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  /**
   * Take ownership for this instance. Refuses to steal a *live* `user` claim
   * held by somebody else, and returns whichever record now applies.
   */
  claim(holder, extra = {}) {
    const current = this.read();
    if (current && !current.stale && current.holder === 'user' && current.by !== this.owner) {
      return current;
    }
    const now = Date.now();
    const same = current && !current.stale && current.by === this.owner;
    return this.write({
      holder,
      by: this.owner,
      pid: process.pid,
      tool: extra.tool || '',
      since: same && current.holder === holder ? current.since : now,
      hb: now,
    });
  }

  /** Refresh the heartbeat when (and only when) this instance is the holder. */
  heartbeat() {
    const current = this.read();
    if (!current || current.stale || current.by !== this.owner) return current;
    return this.write({ ...current, stale: undefined, hb: Date.now() });
  }

  release() {
    const current = this.read();
    if (current && current.by !== this.owner) return current;
    try {
      rmSync(this.path, { force: true });
    } catch {
      /* ignore */
    }
    return null;
  }
}
