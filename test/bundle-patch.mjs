/**
 * L5 — real composition: our bundle patch is parsed and applied by the SAME
 * code the DSH launcher uses (`@deepseek-ai/cordis-plugin-include`), not by a
 * reimplementation. If this passes here, the shipped `cordis.patch.yml` mounts.
 *
 * It needs a DSH installation, so it skips (exit 0) when none is found:
 *
 *   node test/bundle-patch.mjs                       # repo copy, auto-detected DSH
 *   DSH_MODULES=/opt/node22/lib/node_modules/@deepseek-ai/dsh/node_modules \
 *   WSLCU_PACKAGE_DIR=/root/.dsh-lab/profiles/web/node_modules/dsh-computer-use-wsl \
 *     node test/bundle-patch.mjs                     # the installed artifact
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;

function pass(message) {
  console.log(`PASS  ${message}`);
}

function fail(name, error) {
  failures++;
  console.log(`FAIL  ${name}  ${error instanceof Error ? error.message : error}`);
}

/** A DSH install ships these two next to each other inside its own node_modules. */
function findModules() {
  const candidates = [
    process.env.DSH_MODULES,
    '/opt/node22/lib/node_modules/@deepseek-ai/dsh/node_modules',
    process.execPath.replace(/\/bin\/node$/, '/lib/node_modules/@deepseek-ai/dsh/node_modules'),
    join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/node_modules'),
    join(process.env.DSH_HOME || '', 'profiles/web/node_modules'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (
      existsSync(join(dir, '@deepseek-ai/cordis-plugin-include/package.json')) &&
      existsSync(join(dir, 'js-yaml/package.json'))
    ) {
      return dir;
    }
  }
  return null;
}

async function importPackage(dir, name) {
  const pkg = JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8'));
  const entry = typeof pkg.main === 'string' ? pkg.main : 'index.js';
  return import(pathToFileURL(join(dir, name, entry)).href);
}

const modules = findModules();
if (!modules) {
  console.log('SKIP  no DSH installation found (set DSH_MODULES to one)');
  process.exit(0);
}

const packageDir = process.env.WSLCU_PACKAGE_DIR || repoRoot;
const patchPath = join(packageDir, 'cordis.patch.yml');
const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

const include = await importPackage(modules, '@deepseek-ai/cordis-plugin-include');
const yamlModule = await importPackage(modules, 'js-yaml');
const yaml = yamlModule.default ?? yamlModule;
const { applyEntryPatches, entryListSchema } = include;

// 1. The manifest points at a patch file that actually exists in the package.
try {
  const declared = packageJson.dsh?.bundle?.patch;
  if (!declared) throw new Error('package.json has no dsh.bundle.patch');
  if (!existsSync(join(packageDir, declared))) throw new Error(`${declared} is missing`);
  pass(`dsh.bundle.patch -> ${declared}`);
} catch (error) {
  fail('manifest declares its patch file', error);
}

// 2. The official YAML dialect accepts the file verbatim.
let rows = null;
try {
  rows = yaml.load(readFileSync(patchPath, 'utf8'), { schema: entryListSchema });
  if (!Array.isArray(rows)) throw new Error(`parsed to ${typeof rows}, expected an array`);
  pass(`entryListSchema accepts cordis.patch.yml (${rows.length} row)`);
} catch (error) {
  fail('entryListSchema parses cordis.patch.yml', error);
}

// 3. Applying it the way the launcher does produces our row.
const warnings = [];
let composed = null;
try {
  composed = applyEntryPatches([], rows, (...args) => warnings.push(args.join(' ')));
  const row = composed.find((entry) => entry.id === 'mcp-dsh-computer-use-wsl');
  if (!row) throw new Error('row mcp-dsh-computer-use-wsl not produced');
  if (row.name !== 'dsh-computer-use-wsl') throw new Error(`name is ${row.name}`);
  if (row.config?.mode !== 'full') throw new Error(`config.mode is ${row.config?.mode}`);
  if (warnings.length) throw new Error(`warnings: ${warnings.join('; ')}`);
  pass(`applyEntryPatches mounts ${row.id} -> ${row.name} (config.mode=${row.config.mode})`);
} catch (error) {
  fail('applyEntryPatches composes our row', error);
}

// 4. It composes on top of a shipped bundle layer without touching it.
//    The file uses the root-level `insert` form, which appends to the composed
//    list; a non-insert patch would instead have to match an existing id.
try {
  const base = [
    { id: 'ui-sidebar-browser', name: '@deepseek-ai/dsh-browser' },
    { id: 'tools', name: '@deepseek-ai/dsh-tools' },
  ];
  const before = structuredClone(base);
  const warnings2 = [];
  const mixed = applyEntryPatches(base, rows, (...args) => warnings2.push(args.join(' ')));
  const ids = mixed.map((entry) => entry.id);
  if (!ids.includes('ui-sidebar-browser') || !ids.includes('mcp-dsh-computer-use-wsl')) {
    throw new Error(`unexpected ids: ${ids.join(', ')}`);
  }
  if (warnings2.length) throw new Error(`warnings: ${warnings2.join('; ')}`);
  if (JSON.stringify(base) !== JSON.stringify(before)) throw new Error('base list was mutated');
  pass(`composes with a bundle layer (${ids.length} rows, base untouched)`);
} catch (error) {
  fail('composes with a bundle layer', error);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
