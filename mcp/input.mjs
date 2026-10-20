/**
 * Pointer and keyboard input via xdotool.
 *
 * Every method here is part of the *mutating* surface: the caller must have
 * asked `ControlState.assertAgentMayAct` first, and must call `touch` so the
 * viewer keeps showing "DSH 操作中" while the action runs.
 */

import { sh } from './transport.mjs';

const BUTTONS = { left: 1, middle: 2, right: 3 };

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export class Input {
  constructor({ transport, desktop }) {
    this.transport = transport;
    this.desktop = desktop;
  }

  async script(body, { timeoutMs = 20000 } = {}) {
    const full = `export DISPLAY=${sh(this.desktop.display)}\nunset WAYLAND_DISPLAY WAYLAND_SOCKET\nXDG_SESSION_TYPE=x11\n${body}\n`;
    const result = await this.transport.run(full, { timeoutMs });
    if (result.code !== 0) {
      throw new Error(`input failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`);
    }
    return result;
  }

  async move({ x, y }) {
    await this.script(`xdotool mousemove --sync ${num(x)} ${num(y)}`);
    return { x: num(x), y: num(y) };
  }

  async click({ x, y, button = 'left', count = 1 }) {
    const btn = BUTTONS[String(button)] || BUTTONS.left;
    const repeat = Math.max(1, Math.min(3, num(count, 1)));
    await this.script(
      [
        x !== undefined && y !== undefined ? `xdotool mousemove --sync ${num(x)} ${num(y)}` : '',
        `sleep 0.05`,
        `xdotool click --repeat ${repeat} --delay 60 ${btn}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return { x: num(x), y: num(y), button, count: repeat };
  }

  async drag({ from, to, button = 'left' }) {
    const btn = BUTTONS[String(button)] || BUTTONS.left;
    await this.script(
      [
        `xdotool mousemove --sync ${num(from?.x)} ${num(from?.y)}`,
        `sleep 0.05`,
        `xdotool mousedown ${btn}`,
        `sleep 0.08`,
        `xdotool mousemove --sync ${num(to?.x)} ${num(to?.y)}`,
        `sleep 0.08`,
        `xdotool mouseup ${btn}`,
      ].join('\n'),
    );
    return { from, to, button };
  }

  async scroll({ x, y, deltaY = 0, deltaX = 0 }) {
    const dy = num(deltaY);
    const dx = num(deltaX);
    const lines = [];
    if (x !== undefined && y !== undefined) lines.push(`xdotool mousemove --sync ${num(x)} ${num(y)}`);
    if (dy) {
      const button = dy > 0 ? 5 : 4; // 5 = wheel down, 4 = wheel up
      const times = Math.min(30, Math.max(1, Math.round(Math.abs(dy) / 120) || 1));
      lines.push(`xdotool click --repeat ${times} --delay 40 ${button}`);
    }
    if (dx) {
      const button = dx > 0 ? 7 : 6; // 7 = wheel right, 6 = wheel left
      const times = Math.min(30, Math.max(1, Math.round(Math.abs(dx) / 120) || 1));
      lines.push(`xdotool click --repeat ${times} --delay 40 ${button}`);
    }
    if (!lines.length) return { scrolled: false };
    await this.script(lines.join('\n'));
    return { scrolled: true, deltaX: dx, deltaY: dy };
  }

  /**
   * Type text.
   *
   * `auto` (default) picks the path that actually works: xdotool's synthetic
   * keys for ASCII (works in every toolkit, including xterm), and the
   * clipboard for anything containing non-ASCII, which no keysym mapping
   * survives.
   *
   * The clipboard path writes BOTH selections. Paste chords differ by toolkit —
   * Electron/Chromium/GTK/Qt use ctrl+v, xterm uses Shift+Insert, and the
   * middle button pastes PRIMARY everywhere — so `pasteChord: "middle"` is the
   * universal fallback and is verified to carry CJK into xterm.
   */
  async typeText({ text, method = 'auto', pasteChord = 'ctrl+v' }) {
    const value = String(text ?? '');
    if (!value) return { typed: 0, method };
    const ascii = !/[^\x00-\x7F]/.test(value);
    const useClipboard = method === 'clipboard' || (method !== 'xtest' && !ascii);

    if (!useClipboard) {
      await this.script(`xdotool type --clearmodifiers --delay 25 ${sh(value)}`, { timeoutMs: 60000 });
      return { typed: value.length, method: 'xtest', ascii };
    }

    const middle = String(pasteChord || '').toLowerCase() === 'middle';
    const chord = middle
      ? 'middle'
      : String(pasteChord || 'ctrl+v')
          .split('+')
          .map((k) => k.trim())
          .filter(Boolean)
          .join('+');
    const script = [
      'OLD_C="$(xclip -o -selection clipboard 2>/dev/null || true)"',
      'OLD_P="$(xclip -o -selection primary 2>/dev/null || true)"',
      // xclip daemonizes to serve the selection and would keep our stdout pipe
      // open forever, so every invocation must detach stdout/stderr. Do NOT
      // redirect stdin: the data arrives through the pipe.
      `printf '%s' ${sh(value)} | xclip -selection clipboard -i >/dev/null 2>&1`,
      `printf '%s' ${sh(value)} | xclip -selection primary -i >/dev/null 2>&1`,
      'sleep 0.12',
      middle ? 'xdotool click 2' : `xdotool key --clearmodifiers ${sh(chord)}`,
      'sleep 0.18',
      `if [ -n "$OLD_C" ]; then printf '%s' "$OLD_C" | xclip -selection clipboard -i >/dev/null 2>&1; fi`,
      `if [ -n "$OLD_P" ]; then printf '%s' "$OLD_P" | xclip -selection primary -i >/dev/null 2>&1; fi`,
    ].join('\n');
    await this.script(script, { timeoutMs: 60000 });
    return { typed: value.length, method: 'clipboard', chord, ascii };
  }

  /** Press a chord such as ["ctrl","shift","p"]. */
  async key({ keys }) {
    const list = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k).trim()).filter(Boolean);
    if (!list.length) throw new Error('key requires at least one key');
    const chord = list.join('+');
    await this.script(`xdotool key --clearmodifiers ${sh(chord)}`);
    return { chord };
  }
}

export function createInput(options) {
  return new Input(options);
}
