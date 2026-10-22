#!/usr/bin/env node
/**
 * Reverse check ("mutation rehearsal"): break the implementation on purpose and
 * prove the test suite notices.
 *
 * A green suite only means something if it can go red. Each mutation below is a
 * real bug we have either shipped or nearly shipped; the entry names the layer
 * that must catch it. Every mutation is applied to a backup-protected copy and
 * restored in a `finally`, so an interrupted run leaves a `.rehearsal/` folder
 * with the original bytes and prints the command to recover.
 *
 *   node scripts/reverse-check.mjs            # refuse to run on a dirty tree
 *   node scripts/reverse-check.mjs --allow-dirty
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rehearsalDir = path.join(repoRoot, '.rehearsal');
const allowDirty = process.argv.includes('--allow-dirty');

const LAYERS = {
  L0: { label: 'L0 unit', args: ['--test', 'test/unit.test.mjs'] },
  L1: { label: 'L1 mcp handshake', args: ['test/mcp-handshake.mjs'] },
  L3: { label: 'L3 contracts', args: ['--test', 'test/contracts.mjs'] },
  L6: { label: 'L6 client module', args: ['test/client-module.mjs'] },
};

const MUTATIONS = [
  {
    id: 'idle-release-never-fires',
    file: 'mcp/wsl-lifecycle.mjs',
    find: 'return Number(now) - last > minutes * 60000;',
    replace: 'return false;',
    layer: 'L0',
    expect: 'idle release',
  },
  {
    id: 'vm-knobs-ignore-settings',
    file: 'mcp/wsl-lifecycle.mjs',
    find: 'processors: String(settings.wslProcessors),',
    replace: "processors: '1',",
    layer: 'L0',
    expect: 'settings map onto VM knobs',
  },
  {
    id: 'badge-agent-looks-idle',
    file: 'mcp/wsl-lifecycle.mjs',
    find: "if (state === 'agent') return 'agent';",
    replace: "if (state === 'agent') return 'idle';",
    layer: 'L0',
    expect: 'five states',
  },
  {
    id: 'clamp-dropped',
    file: 'lib/settings.mjs',
    find: 'out[key] = Math.min(max, Math.max(min, out[key]));',
    replace: 'out[key] = Number(out[key]);',
    layer: 'L0',
    expect: 'clamp instead of exploding',
  },
  {
    id: 'status-forgets-release-marker',
    file: 'mcp/wsl-lifecycle.mjs',
    find: 'releasedAt: marker?.releasedAt,',
    replace: 'releasedAt: null,',
    layer: 'L0',
    expect: 'payload merges viewer state',
  },
  {
    id: 'route-outside-api',
    file: 'mcp/wsl-lifecycle.mjs',
    find: "export const STATUS_PATH = '/api/wslcu/status';",
    replace: "export const STATUS_PATH = '/wslcu/status';",
    layer: 'L3',
    expect: 'status route lives under',
  },
  {
    id: 'apply-returns-the-fiber',
    file: 'lib/index.js',
    find: 'return undefined;',
    replace: 'return connection;',
    layer: 'L3',
    expect: 'apply must not return',
  },
  {
    id: 'manifest-releases-as-array',
    file: 'package.json',
    find: '"dshReleases": { "0.2.0-rc.2": "compatible", "0.2.1-rc.2": "compatible" }',
    replace: '"dshReleases": ["0.2.0-rc.2"]',
    layer: 'L3',
    expect: 'manifest keeps the shapes',
  },
  {
    id: 'badge-slot-renamed',
    file: 'lib/client.js',
    find: "ctx.slots.inject('conversation.input.dock'",
    replace: "ctx.slots.inject('conversation.input.dock.broken'",
    layer: 'L6',
    expect: 'chat-dock status badge',
  },
  {
    id: 'tool-renamed',
    file: 'mcp/server.mjs',
    find: "name: 'wsl_release',",
    replace: "name: 'wsl_release_broken',",
    layer: 'L1',
    expect: 'wsl_release',
  },
  {
    id: 'manifest-version-drift',
    file: 'dsh-plugin.json',
    find: '"version": "0.3.2",',
    replace: '"version": "0.0.0",',
    layer: 'L3',
    expect: 'the plugin manifest matches',
  },
  {
    id: 'badge-alignment-dropped',
    file: 'lib/client.js',
    find: 'calc(max(0px, (100% - var(--dsh-composer-card-max-width, 712px)) / 2))',
    replace: '0px',
    layer: 'L3',
    expect: 'aligns with the composer',
  },
  {
    id: 'reduced-motion-dropped',
    file: 'lib/client.js',
    find: "window.matchMedia('(prefers-reduced-motion: reduce)')",
    replace: "window.matchMedia('(prefers-anything: reduce)')",
    layer: 'L3',
    expect: 'honours reduced motion',
  },
];

function sh(args, timeout = 240000) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function gitStatus() {
  const out = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (out.status !== 0) return { ok: false, text: out.stderr || 'git failed' };
  return { ok: true, text: (out.stdout || '').trim() };
}

function fail(message) {
  console.log('\nFAIL: ' + message);
  process.exit(1);
}

const dirty = gitStatus();
if (!dirty.ok) fail('git is unavailable: ' + dirty.text);
if (dirty.text && !allowDirty) {
  fail(
    'the working tree is dirty; commit or stash first so a restore can be verified\n'
      + dirty.text.split('\n').slice(0, 8).map((line) => '  ' + line).join('\n'),
  );
}

fs.mkdirSync(rehearsalDir, { recursive: true });

const rows = [];
let unexpected = 0;

for (const mutation of MUTATIONS) {
  const file = path.join(repoRoot, mutation.file);
  const original = fs.readFileSync(file, 'utf8');
  const hits = original.split(mutation.find).length - 1;
  if (hits !== 1) {
    rows.push({ ...mutation, result: `SKIP (find matched ${hits}x)` });
    continue;
  }

  const backup = path.join(rehearsalDir, mutation.file.replace(/[\\/]/g, '__') + '.bak');
  fs.writeFileSync(backup, original);

  const layer = LAYERS[mutation.layer];
  let red = false;
  let note = '';
  try {
    fs.writeFileSync(file, original.replace(mutation.find, mutation.replace));
    const run = sh(layer.args);
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    red = run.status !== 0;
    if (!red) {
      note = 'still green';
    } else if (mutation.expect && !output.includes(mutation.expect)) {
      note = 'red, but the expected test name was not in the output';
      unexpected += 1;
    }
  } finally {
    fs.writeFileSync(file, original);
  }

  const restored = fs.readFileSync(file, 'utf8');
  if (restored !== original) {
    fail(`${mutation.file} was not restored; original bytes are in ${backup}`);
  }
  if (red) fs.rmSync(backup, { force: true });

  rows.push({ ...mutation, result: red ? 'RED' : 'GREEN', note });
}

const pad = (value, width) => String(value).padEnd(width);
console.log('\nRESULT  LAYER     MUTATION                        EXPECTED TEST');
console.log('-'.repeat(96));
for (const row of rows) {
  const result = row.result === 'RED' ? 'PASS  ' : row.result === 'GREEN' ? 'FAIL  ' : 'SKIP  ';
  console.log(
    `${result}  ${pad(row.layer ?? '-', 9)} ${pad(row.id ?? '-', 31)} ${row.expect ?? row.result}`
      + (row.note ? `\n        └─ ${row.note}` : ''),
  );
}

const survivors = rows.filter((row) => row.result === 'GREEN');
const skipped = rows.filter((row) => String(row.result).startsWith('SKIP'));

console.log('-'.repeat(96));
console.log(
  `${MUTATIONS.length - skipped.length - survivors.length}/${MUTATIONS.length} mutations turned the suite red`
    + (unexpected ? `, ${unexpected} on an unexpected test` : ''),
);

if (skipped.length) {
  console.log('\nSkipped mutations (the anchor text moved — update scripts/reverse-check.mjs):');
  for (const row of skipped) console.log(`  - ${row.id}: ${row.result}`);
}
if (survivors.length) {
  console.log('\nThese mutations were NOT caught — the suite has a blind spot:');
  for (const row of survivors) console.log(`  - ${row.id} (${row.layer}: ${row.expect})`);
}

const leftovers = fs.readdirSync(rehearsalDir).filter((name) => name.endsWith('.bak'));
if (leftovers.length === 0) {
  fs.rmSync(rehearsalDir, { recursive: true, force: true });
} else {
  console.log(`\nBackups kept in ${rehearsalDir}:`);
  for (const name of leftovers) {
    const file = name.replace(/__/g, '/').replace(/\.bak$/, '');
    console.log(`  - git checkout -- ${file}`);
  }
}

const after = gitStatus();
if (after.ok && after.text) {
  console.log('\nWARNING: the working tree changed during the run:\n' + after.text);
}

process.exit(survivors.length ? 1 : 0);
