/**
 * L1 — MCP protocol conformance.
 *
 * Verifies the exact handshake dsh-mcp-client performs: initialize,
 * notifications/initialized, tools/list, and one tools/call per read-only tool.
 */

import assert from 'node:assert/strict';
import { createClient } from './helpers/mcp-client.mjs';

const SETTINGS = {
  display: ':98',
  viewerPort: 6084,
  vncPort: 5902,
  webPort: 6082,
  stateDir: '/tmp/wslcu-test',
  agentStateHoldMs: 800,
};

const EXPECTED = [
  'health', 'desktop_up', 'desktop_down', 'bootstrap', 'snapshot', 'windows',
  'wait_window', 'click', 'move', 'drag', 'scroll', 'type_text', 'key',
  'takeover', 'exec',
];

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

const client = createClient(SETTINGS);
try {
  const init = await client.initialize();
  check('initialize', () => {
    assert.equal(init.serverInfo.name, 'wslcu');
    assert.ok(init.capabilities.tools, 'tools capability missing');
    return `${init.serverInfo.name}@${init.serverInfo.version} protocol=${init.protocolVersion}`;
  });

  const list = await client.request('tools/list');
  check('tools/list count', () => {
    assert.ok(Array.isArray(list.tools));
    assert.ok(list.tools.length >= EXPECTED.length, `expected >=${EXPECTED.length}, got ${list.tools.length}`);
    return `${list.tools.length} tools`;
  });
  check('tools/list names', () => {
    const names = new Set(list.tools.map((tool) => tool.name));
    const missing = EXPECTED.filter((name) => !names.has(name));
    assert.deepEqual(missing, [], `missing: ${missing.join(', ')}`);
    return EXPECTED.join(', ');
  });
  check('tools/list schemas', () => {
    for (const tool of list.tools) {
      assert.ok(tool.description && tool.description.length > 10, `${tool.name} has no description`);
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} inputSchema is not an object`);
    }
    return 'all schemas are objects with descriptions';
  });

  const health = await client.callTool('health');
  check('tools/call health', () => {
    assert.equal(health.isError, false);
    assert.equal(health.value.ok, true);
    assert.ok(['wsl', 'local'].includes(health.value.transport));
    assert.match(health.value.viewerUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    return `transport=${health.value.transport} viewer=${health.value.viewerUrl}`;
  });

  const windows = await client.callTool('windows');
  check('tools/call windows', () => {
    assert.equal(windows.isError, false);
    assert.ok(Array.isArray(windows.value.windows));
    return `${windows.value.windows.length} windows on ${SETTINGS.display}`;
  });

  const status = await client.callTool('takeover', { action: 'status' });
  check('tools/call takeover status', () => {
    assert.equal(status.isError, false);
    assert.equal(status.value.state, 'idle');
    return `state=${status.value.state}`;
  });

  const bad = await client.callTool('click', {});
  check('mutating tool rejects empty point', () => {
    assert.equal(bad.isError, true);
    const text = bad.result?.content?.[0]?.text || '';
    assert.match(text, /x\/y|window/i);
    return text.slice(0, 80);
  });
} finally {
  await client.close();
}

const failed = results.filter((row) => !row.ok);
for (const row of results) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}  ${row.detail ?? ''}`);
}
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log('\nL1 OK');
