/**
 * Who owns the pointer: the agent, or the human?
 *
 * The state machine is deliberately tiny and synchronous — it is consulted on
 * every input call, so it must never block on I/O.
 *
 *   idle  --input tool-->  agent  --(no touch for holdMs)-->  idle
 *   any   --takeover-->    user   --release------------->  idle
 *
 * While `user` owns the desktop, every mutating tool throws USER_IN_CONTROL.
 * Observation tools (snapshot / windows / health) keep working: the model must
 * be able to look at what the human is doing without fighting for the pointer.
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
  constructor({ holdMs = 3000, now = () => Date.now() } = {}) {
    this.holdMs = Math.max(200, Number(holdMs) || 3000);
    this.now = now;
    this.state = 'idle';
    this.tool = '';
    this.since = this.now();
    this.listeners = new Set();
    this.agentUntil = 0;
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

  /** Current observable state, after applying the hold timer. */
  get() {
    if (this.state === 'agent' && this.now() >= this.agentUntil) {
      this.state = 'idle';
      this.tool = '';
      this.since = this.now();
    }
    return {
      state: this.state,
      tool: this.tool,
      since: this.since,
      holdMs: this.holdMs,
      remainingMs: this.state === 'agent' ? Math.max(0, this.agentUntil - this.now()) : 0,
    };
  }

  /** Called right before a mutating tool runs; throws when the human owns it. */
  assertAgentMayAct(tool) {
    if (this.state === 'user') {
      throw new ControlError(
        USER_IN_CONTROL,
        `The human is in control of the desktop (tool: ${tool}). Do not fight for the pointer; ask them to hand it back, or wait.`,
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
    this.emit();
  }

  /** Human takes over (`true`) or hands back (`false`). */
  setUserActive(active) {
    this.state = active ? 'user' : 'idle';
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
      this.emit();
    }
    return this.get();
  }
}
