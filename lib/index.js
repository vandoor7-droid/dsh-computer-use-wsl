/**
 * DSH host plugin: mount the WSL desktop MCP server through the official
 * bridge, so the model sees `mcp__wslcu__*` tools.
 *
 * No tool is registered natively here on purpose: MCP is the thinner seam, the
 * backend stays a separate process, and a broken backend cannot take DSH down
 * (failOnStartupError defaults to false).
 */

import { fileURLToPath } from 'node:url';
import { normalizeSettings } from './settings.mjs';

export const name = 'wsl-computer-use';
export const inject = ['tools'];

/** Bridge configuration handed to @deepseek-ai/dsh-mcp-client. */
export function bridgeConfig(config = {}) {
  const settings = normalizeSettings(config);
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

export async function apply(ctx, config) {
  const bridge = await import('@deepseek-ai/dsh-mcp-client');
  const connection = ctx.plugin(bridge, bridgeConfig(config));
  await connection;
  ctx.logger?.info?.('wslcu: desktop bridge mounted (tools: mcp__wslcu__*)');
}
