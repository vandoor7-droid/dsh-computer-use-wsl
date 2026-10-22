/**
 * L3 contracts — the host-only traps that no runtime test can see.
 *
 * Every failure here was a real, shipped bug found while installing the plugin
 * into a live DSH host (see CHANGELOG 0.2.8). They are cheap static checks on
 * purpose: they need no schemastery, no host, and no display, so they run
 * everywhere.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { STATUS_PATH } from '../mcp/wsl-lifecycle.mjs';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

/** Slice out a function body by brace matching (comments/strings are simple here). */
function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `signature not found: ${signature}`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart > start, `no body for: ${signature}`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${signature}`);
}

test('contract: the status route lives under /api/', () => {
  // The host only dispatches /api/* to the route registry; a route registered
  // anywhere else registers fine and then 404s forever.
  assert.equal(STATUS_PATH, '/api/wslcu/status');
  assert.ok(STATUS_PATH.startsWith('/api/'), 'the host only routes /api/*');
});

test('contract: the host plugin registers an exact route', () => {
  const source = read('../lib/index.js');
  assert.match(source, /kind:\s*["']exact["']/, 'host routes must be exact');
  assert.match(source, /path:\s*STATUS_PATH/, 'the route must use the shared constant');
  assert.ok(!source.includes('kind: "prefix"') && !source.includes("kind: 'prefix'"), 'prefix routes never matched');
});

test('contract: apply must not return a value', () => {
  // Cordis collects the plugin body's return value as an effect. Returning the
  // bridge fiber threw `TypeError: Invalid effect` and the whole entry silently
  // refused to activate.
  const body = functionBody(read('../lib/index.js'), 'export async function apply(');
  assert.ok(!/return\s+connection\b/.test(body), 'returning the fiber breaks activation');
  assert.match(body, /return undefined;/, 'apply should end with an explicit undefined');
});

test('contract: the package manifest keeps the shapes the host accepts', () => {
  const pkg = readJson('../package.json');
  const dsh = pkg.dsh ?? {};
  // `engines.dsh` is a semver range string...
  assert.equal(typeof dsh.engines?.dsh, 'string');
  assert.ok(dsh.engines.dsh.length > 0, 'engines.dsh must not be empty');
  // ...and dshReleases is a {version: 'compatible'} map, never an array.
  const releases = dsh.compatibility?.dshReleases;
  assert.ok(releases && typeof releases === 'object', 'compatibility.dshReleases is required');
  assert.ok(!Array.isArray(releases), 'an array here makes the host skip the entry');
  const versions = Object.keys(releases);
  assert.ok(versions.length > 0, 'at least one release must be declared');
  for (const version of versions) {
    assert.equal(releases[version], 'compatible', `${version} must map to "compatible"`);
  }
  assert.ok(versions.some((v) => /^\d+\.\d+\.\d+/.test(v)), 'declare real release versions');
});

test('contract: the bundle patch is shipped and declares the host row', () => {
  const pkg = readJson('../package.json');
  const patchPath = pkg.dsh?.bundle?.patch;
  assert.equal(typeof patchPath, 'string');
  assert.ok(fs.existsSync(new URL(`../${patchPath.replace(/^\.\//, '')}`, import.meta.url)), 'patch file is missing');
  const patch = read(`../${patchPath.replace(/^\.\//, '')}`);
  assert.match(patch, /mcp-dsh-computer-use-wsl/, 'the row id the host mounts');
});

test('contract: the chat-dock badge polls the /api route', () => {
  const client = read('../lib/client.js');
  assert.ok(client.includes("'/api/wslcu/status'"), 'the badge must poll the /api route');
  assert.ok(!client.includes("'/wslcu/status'"), 'the old non-/api path 404s');
  assert.ok(client.includes('conversation.input.dock'), 'the badge slot');
  assert.ok(client.includes('wsl-computer-status'), 'the badge id');
});
