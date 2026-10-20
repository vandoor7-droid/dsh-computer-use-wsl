/**
 * Screen capture.
 *
 * dsh-mcp-client drops MCP image content blocks, so the only reliable channel
 * is a file path the host can open — every capture returns one.
 */

import { sh } from './transport.mjs';

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

export class Capture {
  constructor({ transport, settings, desktop }) {
    this.transport = transport;
    this.settings = settings;
    this.desktop = desktop;
  }

  /** Capture the whole display (or a window) and return a host-visible path. */
  async snapshot({ window, region, saveAs } = {}) {
    const dir = this.desktop.shotDir;
    const name = `${saveAs || `shot-${stamp()}`}`.replace(/[^\w.-]+/g, '_');
    const file = `${dir}/${name}.png`;
    const target = window ? `-window ${sh(String(window))}` : '-window root';
    const lines = [
      `mkdir -p ${sh(dir)}`,
      `export DISPLAY=${sh(this.desktop.display)}`,
      `if command -v import >/dev/null 2>&1; then import ${target} ${sh(file)}; else magick import ${target} ${sh(file)}; fi`,
    ];
    if (region) lines.push(`convert ${sh(file)} -crop ${sh(region)} +repage ${sh(file)}`);
    lines.push(
      `W=$(identify -format '%w' ${sh(file)} 2>/dev/null || echo 0)`,
      `H=$(identify -format '%h' ${sh(file)} 2>/dev/null || echo 0)`,
      `S=$(stat -c%s ${sh(file)} 2>/dev/null || echo 0)`,
      `M=$(identify -format '%[fx:mean]' ${sh(file)} 2>/dev/null || echo 0)`,
      'echo "W=$W"',
      'echo "H=$H"',
      'echo "S=$S"',
      'echo "M=$M"',
      `echo "FILE=${file}"`,
    );
    const script = lines.join('\n');
    const result = await this.transport.run(script, { timeoutMs: 30000 });
    const kv = {};
    for (const line of String(result.stdout).split(/\r?\n/)) {
      const match = /^([A-Z]+)=(.*)$/.exec(line.trim());
      if (match) kv[match[1]] = match[2];
    }
    if (result.code !== 0 || !kv.S || Number(kv.S) === 0) {
      throw new Error(`snapshot failed: ${(result.stderr || result.stdout || '').trim().slice(0, 500)}`);
    }
    const hostPath = await this.transport.toHostPath(kv.FILE);
    const mean = Number(kv.M) || 0;
    return {
      path: hostPath,
      linuxPath: kv.FILE,
      width: Number(kv.W) || 0,
      height: Number(kv.H) || 0,
      bytes: Number(kv.S) || 0,
      // A mean below 2% almost always means "X is up but the screen is black".
      blank: mean < 0.02,
      mean: Number(mean.toFixed(4)),
      hint: 'Open this PNG with read_image; MCP image blocks are dropped by the bridge.',
    };
  }
}

export function createCapture(options) {
  return new Capture(options);
}
