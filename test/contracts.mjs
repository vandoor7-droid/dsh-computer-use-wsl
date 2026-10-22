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

test('contract: the plugin manifest matches the package and the schema shape', () => {
  const pkg = readJson('../package.json');
  const manifest = readJson('../dsh-plugin.json');
  assert.equal(manifest.manifestVersion, '0.15');
  assert.equal(manifest.id, 'dsh-computer-use-wsl');
  assert.equal(manifest.version, pkg.version, 'manifest version must track package.json');
  assert.ok(fs.existsSync(new URL(`../${manifest.facets.host.entry}`, import.meta.url)), 'host entry is missing');
  for (const key of ['$schema', 'manifestVersion', 'id', 'name', 'version', 'license', 'facets', 'requires', 'permissions', 'contributes', 'subscriptions']) {
    assert.ok(key in manifest, `manifest is missing ${key}`);
  }
  assert.ok(Array.isArray(manifest.contributes['x-dsh-tui']), 'x-dsh-tui must be a list');
});

test('contract: the TUI settings section covers the settings we ship', () => {
  const source = read('../lib/index.js');
  const configKeys = new Set([...source.matchAll(/^ {2}(\w+): z\./gm)].map((m) => m[1]));
  assert.ok(configKeys.size >= 20, `expected the full Config, got ${configKeys.size}`);

  const manifest = readJson('../dsh-plugin.json');
  const section = manifest.contributes['x-dsh-tui'].find((entry) => entry.kind === 'SettingsSection');
  assert.ok(section, 'no SettingsSection contribution');
  assert.equal(section.spec.namespace, 'dsh-computer-use-wsl');

  const paths = section.spec.fields.map((field) => field.path.join('.'));
  for (const field of section.spec.fields) {
    assert.ok(configKeys.has(field.path[0]), `manifest field ${field.path[0]} is not a Config key`);
    assert.ok(['number', 'select', 'boolean', 'text'].includes(field.kind), `bad kind for ${field.path[0]}`);
    assert.ok(field.label, `${field.path[0]} has no label`);
    if (field.kind === 'select') assert.ok(Array.isArray(field.options) && field.options.length > 0);
  }
  for (const required of ['wslMemoryGb', 'wslProcessors', 'wslSwapGb', 'autoMemoryReclaim', 'distro', 'distroDataDir', 'windowsOutputDir', 'idleReleaseMin']) {
    assert.ok(paths.includes(required), `manifest is missing the ${required} field`);
  }
});

test('contract: the badge aligns with the composer card', () => {
  const client = read('../lib/client.js');
  assert.ok(client.includes('--dsh-composer-card-max-width'), 'card width token');
  assert.ok(/max\(0px, \(100% - var\(--dsh-composer-card-max-width/.test(client), 'centring guard');
});

test('contract: the badge honours reduced motion', () => {
  const client = read('../lib/client.js');
  assert.ok(client.includes('prefers-reduced-motion'), 'reduced-motion guard');
});