/**
 * DSH host plugin: mount the WSL desktop MCP server through the official
 * bridge, so the model sees `mcp__wslcu__*` tools.
 *
 * No tool is registered natively here on purpose: MCP is the thinner seam, the
 * backend stays a separate process, and a broken backend cannot take DSH down
 * (failOnStartupError defaults to false).
 *
 * Two host-side additions live here as well:
 *   - `Config`: the declarative settings schema. Every field is `.volatile()`,
 *     so the host renders the form on the PLUGIN page and a change takes effect
 *     without reloading the plugin (values arrive as live refs; always read them
 *     through `derefConfig`).
 *   - `/wslcu/status`: one JSON endpoint merging the live desktop state, the
 *     released marker and the distro's running state into the badge the chat
 *     dock renders. It runs server-side so the browser never reaches the VNC
 *     viewer across origins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { normalizeSettings, DEFAULTS } from './settings.mjs';
import { settingsFilePath, buildStatus } from '../mcp/wsl-lifecycle.mjs';

export const name = 'wsl-computer-use';
export const inject = ['tools'];

/* ------------------------------------------------------------- settings */

/**
 * Declarative settings surface (DSH >= 0.1.7): volatile fields render on the
 * plugin page and update live via `loader/volatile-update`. Defaults here must
 * match lib/settings.mjs, or the form shows one value and runs another.
 */
export const Config = z.object({
  /* --- WSL 性能分配（写入 %USERPROFILE%\.wslconfig，影响全部 WSL 发行版） --- */
  wslMemoryGb: z.number().min(1).max(128).step(1).default(4)
    .description('WSL2 虚拟机内存上限（GB）。写入 .wslconfig 的 [wsl2] memory，重启 WSL 后生效。')
    .volatile(),
  wslProcessors: z.number().min(1).max(64).step(1).default(2)
    .description('WSL2 逻辑处理器数。写入 [wsl2] processors，重启 WSL 后生效。')
    .volatile(),
  wslSwapGb: z.number().min(0).max(256).step(1).default(2)
    .description('WSL2 交换区大小（GB，0 = 不分配 swap 文件）。')
    .volatile(),
  autoMemoryReclaim: z.union(['disabled', 'gradual', 'dropcache']).default('disabled')
    .description('WSL2 空闲内存回收策略：disabled 关闭 / gradual 渐进 / dropcache 直接回收缓存。')
    .volatile(),

  /* --- 系统位置 --- */
  distroDataDir: z.string().default('')
    .description('发行版虚拟磁盘(vhdx)应存放的 Windows 目录；留空 = WSL 默认位置。只有调用 wsl_move_distro 时才会真正搬迁数据。')
    .volatile(),
  windowsOutputDir: z.string().default('')
    .description('插件产物（截图/导出/备份）在 Windows 侧的落盘目录；留空 = LOCALAPPDATA\\wslcu\\output。')
    .volatile(),

  /* --- 资源释放 --- */
  idleReleaseMin: z.number().min(0).max(1440).step(1).default(30)
    .description('超过 N 分钟没有任何 mcp__wslcu__* 调用就终止本发行版以释放 vmmem 内存（0 = 不释放）；下次调用会自动冷启动。')
    .volatile(),

  /* --- 桌面与传输（沿用既有字段） --- */
  transport: z.union(['', 'wsl', 'local']).default('')
    .description('留空 = 自动（Windows 走 WSL，Linux 走本地），也可强制 wsl / local。')
    .volatile(),
  distro: z.string().default('')
    .description('WSL 发行版名称；留空 = 默认发行版。')
    .volatile(),
  user: z.string().default('')
    .description('WSL 内的运行用户；留空 = 发行版默认用户。')
    .volatile(),
  display: z.string().default(':99')
    .description('桌面使用的 X display。')
    .volatile(),
  resolution: z.string().default('1280x960')
    .description('桌面分辨率（宽x高）。')
    .volatile(),
  vncPort: z.number().min(1).max(65535).step(1).default(5900).description('x11vnc 端口。').volatile(),
  webPort: z.number().min(1).max(65535).step(1).default(6080).description('websockify(noVNC) 端口。').volatile(),
  viewerPort: z.number().min(1).max(65535).step(1).default(6081).description('查看器端口（含 /state）。').volatile(),
  bindHost: z.string().default('127.0.0.1').description('websockify 绑定地址，默认只绑本机回环。').volatile(),
  agentStateHoldMs: z.number().min(200).max(600000).step(100).default(3000)
    .description('最后一次操作后查看器继续显示「DSH 操作中」的毫秒数。').volatile(),
  screenshotDir: z.string().default('').description('Linux 侧截图目录；留空 = ~/.cache/wslcu/shots。').volatile(),
  stateDir: z.string().default('').description('Linux 侧运行时目录；留空 = /tmp/wslcu。').volatile(),
  startHeldByUser: z.boolean().default(false).description('启动时由人持有指针（DSH 需等待「交还给 DSH」）。').volatile(),
  allowExec: z.boolean().default(false).description('允许模型在发行版内执行任意 shell 命令。').volatile(),
  failOnStartupError: z.boolean().default(false)
    .description('后端启动失败时让挂载失败（默认只记录日志，不影响 DSH 本身）。').volatile(),
  toolCallTimeoutMs: z.number().min(1000).max(3600000).step(1000).default(60000)
    .description('单次工具调用超时（毫秒）。').volatile(),
});

/** True when the value is a live volatile reference rather than plain data. */
function isLiveRef(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.get === 'function';
}

/**
 * Read every known key through its volatile ref.
 * Volatile-only changes deliver new refs in place, so this must run at use
 * time — never cache the result across operations.
 */
export function derefConfig(raw = {}) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const value = raw?.[key];
    out[key] = isLiveRef(value) ? value.get() : value;
  }
  return out;
}

/* --------------------------------------------------------------- bridge */

/** Bridge configuration handed to @deepseek-ai/dsh-mcp-client. */
export function bridgeConfig(config = {}) {
  const settings = normalizeSettings(derefConfig(config));
  return {
    serverName: 'wslcu',
    transport: 'stdio',
    command: process.execPath,
    args: [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      WSLCU_SETTINGS_JSON: JSON.stringify(settings),
    },
    toolCallTimeoutMs: settings.toolCallTimeoutMs,
    failOnStartupError: settings.failOnStartupError,
  };
}

/**
 * Publish the current settings for the running MCP process.
 * The bridge env is fixed at spawn time, so hot updates travel through this
 * file; mcp/server.mjs re-reads it (mtime-checked) before each tool call.
 */
export function publishSettings(config = {}) {
  const settings = normalizeSettings(derefConfig(config));
  const file = settingsFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    /* a read-only profile must not break the mount */
  }
  return settings;
}

/* --------------------------------------------------------- status route */

/**
 * Normalized badge payload for the current (possibly volatile) config.
 * The merge lives in mcp/wsl-lifecycle.mjs so it stays unit-testable.
 */
export async function statusOf(configInput = {}, probe = {}) {
  return buildStatus(normalizeSettings(derefConfig(configInput)), probe);
}

function writeJson(res, status, body) {
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
  } catch {
    /* client went away */
  }
}

/** Register `/wslcu/status` on the host web server (no-op when absent). */
function registerStatusRoute(ctx, getConfig) {
  try {
    const webServer = ctx.get?.('webServer');
    if (!webServer || typeof webServer.register !== 'function') return undefined;
    return webServer.register({
      kind: 'prefix',
      path: '/wslcu',
      handler: async (req, res) => {
        const url = String(req.url || '');
        if (!url.startsWith('/wslcu/status')) {
          writeJson(res, 404, { error: 'not-found' });
          return;
        }
        if (req.method && req.method !== 'GET') {
          writeJson(res, 405, { error: 'method-not-allowed' });
          return;
        }
        try {
          writeJson(res, 200, await statusOf(getConfig()));
        } catch (error) {
          writeJson(res, 500, { error: String(error?.message || error) });
        }
      },
    });
  } catch {
    return undefined; // host without a web server: the badge is simply absent
  }
}

/* ----------------------------------------------------------------- apply */

export async function apply(ctx, config) {
  const bridge = await import('@deepseek-ai/dsh-mcp-client');
  const connection = ctx.plugin(bridge, bridgeConfig(config));
  await connection;

  publishSettings(config);

  // Hot path: a volatile edit re-publishes the settings file the MCP process
  // polls, so idleReleaseMin / locations change without restarting the bridge.
  try {
    ctx.on?.('loader/volatile-update', () => {
      try {
        publishSettings(config);
      } catch {
        /* ignore: the next tool call still uses the last good file */
      }
    });
  } catch {
    /* older host without the event: settings still apply on the next mount */
  }

  const disposeRoute = registerStatusRoute(ctx, () => config);
  if (disposeRoute) {
    try {
      ctx.effect?.(() => () => {
        try {
          disposeRoute();
        } catch {
          /* already gone */
        }
      });
    } catch {
      /* ignore */
    }
  }

  ctx.logger?.info?.('wslcu: desktop bridge mounted (tools: mcp__wslcu__*)');
}