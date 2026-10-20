/**
 * Minimal MCP stdio client used by the tests.
 *
 * The bridge in DSH does exactly this handshake, so exercising it here catches
 * protocol-level regressions without needing a full DSH install.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url));

export function createClient(settings = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WSLCU_SETTINGS_JSON: JSON.stringify(settings) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  const notifications = [];
  const stderr = [];

  child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else {
        notifications.push(message);
      }
    }
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, 180000).unref?.();
    });

  return {
    child,
    request,
    notifications,
    stderr: () => stderr.join(''),
    async initialize() {
      const result = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'wslcu-test', version: '0.0.0' },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      return result;
    },
    async callTool(name, args = {}) {
      const result = await request('tools/call', { name, arguments: args });
      const text = result?.content?.find((part) => part.type === 'text')?.text || '{}';
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
      return { result, value: parsed, isError: Boolean(result?.isError) };
    },
    close() {
      return new Promise((resolve) => {
        child.once('exit', resolve);
        child.stdin.end();
        setTimeout(() => child.kill('SIGKILL'), 3000).unref?.();
      });
    },
  };
}
