/**
 * Who owns the pointer: the agent, or the human?
 *
 *   idle  --input tool-->  agent  --(no touch for holdMs)-->  idle
 *   any   --takeover-->    user   --release------------->  idle
 *
 * While `user` owns the desktop, every mutating tool throws USER_IN_CONTROL.
 * Observation tools (snapshot / windows / health / control_state) keep working:
 * the model must be able to see who holds the pointer without fighting for it.
 *
 * Ownership is also written to the shared ControlFile, so a second instance
 * driving the same desktop sees the same answer instead of silently bypassing
 * the human's takeover.
 */

export const USER_IN_CONTROL = 'USER_IN_CONTROL';

export class ControlError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ControlError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export class ControlState {
  constructor({ holdMs = 3000, now = () => Date.now(), store = null } = {}) {
    this.holdMs = Math.max(200, Number(holdMs) || 3000);
    this.now = now;
    this.state = 'idle';
    this.tool = '';
    this.since = this.now();
    this.listeners = new Set();
    this.agentUntil = 0;
    this.store = store;
    this.by = store?.owner || '';
    this.lastReported = 'idle';
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.get();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* a broken viewer must never break the tool path */
      }
    }
  }

  /** Live record written by any instance, or null when absent/stale. */
  shared() {
    if (!this.store) return null;
    const record = this.store.read();
    return record && !record.stale ? record : null;
  }

  /** Current observable state, after applying the hold timer and shared state. */
  get() {
    if (this.state === 'agent' && this.now() >= this.agentUntil) {
      this.state = 'idle';
      this.tool = '';
      this.since = this.now();
    }

    const shared = this.shared();
    // Somebody else holds it for the human: that wins over local bookkeeping.
    if (shared && shared.holder === 'user' && shared.by !== this.by) {
      return {
        state: 'user',
        tool: '',
        since: Number(shared.since) || this.since,
        by: shared.by,
        holdMs: this.holdMs,
        remainingMs: 0,
        shared: true,
      };
    }

    // Somebody else is driving: show it, otherwise every instance but the one
    // actually moving the pointer reports 「空闲」 while the desktop is busy.
    // Only while the hold window is still open — the shared record outlives the
    // action (it stays until STALE_MS), so a plain `holder === 'agent'` check
    // would keep the badge lit long after the last click.
    const sharedAgentFresh =
      shared && shared.holder === 'agent' && shared.by !== this.by && this.now() < Number(shared.hb || 0) + this.holdMs;
    if (sharedAgentFresh) {
      return {
        state: 'agent',
        tool: shared.tool || '',
        since: Number(shared.since) || this.since,
        by: shared.by,
        holdMs: this.holdMs,
        remainingMs: Math.max(0, Number(shared.hb || 0) + this.holdMs - this.now()),
        shared: true,
      };
    }

    return {
      state: this.state,
      tool: this.tool,
      since: this.since,
      by: shared?.by || this.by,
      holdMs: this.holdMs,
      remainingMs: this.state === 'agent' ? Math.max(0, this.agentUntil - this.now()) : 0,
      shared: Boolean(shared),
    };
  }

  /** Called right before a mutating tool runs; throws when the human owns it. */
  assertAgentMayAct(tool) {
    const shared = this.shared();
    const humanOwns = (shared && shared.holder === 'user') || this.state === 'user';
    if (humanOwns) {
      const by = shared?.by && shared.by !== this.by ? ` (held by ${shared.by})` : '';
      throw new ControlError(
        USER_IN_CONTROL,
        `The human is in control of the desktop${by} (tool: ${tool}). Do not fight for the pointer; ask them to hand it back, or wait.`,
        { state: this.get() },
      );
    }
  }

  /** Mark the agent as acting; keeps the "DSH 操作中" badge alive. */
  touch(tool) {
    this.state = 'agent';
    this.tool = tool;
    const now = this.now();
    if (this.agentUntil === 0) this.since = now;
    this.agentUntil = now + this.holdMs;
    this.store?.claim('agent', { tool });
    this.emit();
  }

  /** Human takes over (`true`) or hands back (`false`). */
  setUserActive(active) {
    if (active) {
      const record = this.store?.claim('user');
      // Another live instance already holds it: mirror that instead of stealing.
      if (record && record.by && record.by !== this.by && record.holder === 'user') {
        return this.get();
      }
      this.state = 'user';
    } else {
      this.store?.release();
      this.state = 'idle';
    }
    this.tool = '';
    this.since = this.now();
    this.agentUntil = 0;
    this.emit();
    return this.get();
  }

  /** Periodic sweep so viewers see `idle` even when no tool is called. */
  tick() {
    if (this.state === 'agent' && this.now() >= this.agentUntil) {
      this.state = 'idle';
      this.tool = '';
      this.since = this.now();
    }
    if (this.state !== 'idle') this.store?.heartbeat();
    // Emit whenever the *reported* state changes, including when a shared
    // `agent` record from another instance expires and the badge must go back
    // to 空闲 without any local action happening.
    const reported = this.get();
    if (reported.state !== this.lastReported) {
      this.lastReported = reported.state;
      this.emit();
    }
    return reported;
  }
}
