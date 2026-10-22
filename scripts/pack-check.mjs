#!/usr/bin/env node
/**
 * Pre-publish gate: fail the pack if the repository leaks something that must
 * not become public, or if a required file is missing.
 *
 * Run via `npm run prepack` (also runs when you `npm pack`).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'reference', 'artifacts']);
const TEXT_EXT = new Set(['.md', '.js', '.mjs', '.json', '.yml', '.yaml', '.sh', '.css', '.html', '.txt']);
const FORBIDDEN = [
  { pattern: /gh[pousr]_[A-Za-z0-9]{16,}/, why: 'GitHub token' },
  { pattern: /sk-[A-Za-z0-9]{20,}/, why: 'API key' },
  { pattern: /宋晔桐/, why: 'account holder name' },
  { pattern: /D:\\文档\\/, why: 'absolute Windows path from the author machine' },
  { pattern: /\/mnt\/d\/文档\//, why: 'absolute WSL path from the author machine' },
  { pattern: /password\s*[:=]\s*['"][^'"]{6,}['"]/, why: 'hard-coded password' },
];

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const problems = [];
for (const file of await walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!TEXT_EXT.has(path.extname(file))) continue;
  // The scanner names the patterns it looks for; do not scan itself.
  if (rel === 'scripts/pack-check.mjs') continue;
  const content = await readFile(file, 'utf8');
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(content)) problems.push(`${rel}: contains ${why}`);
  }
}

for (const required of [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'mcp/server.mjs',
  'web/viewer.html',
  'README.md',
  'LICENSE',
]) {
  try {
    await stat(path.join(ROOT, required));
  } catch {
    problems.push(`missing required file: ${required}`);
  }
}

// --- plugin manifest -------------------------------------------------------
try {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'dsh-plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    problems.push(`dsh-plugin.json version ${manifest.version} != package.json ${pkg.version}`);
  }
  if (!pkg.files.includes('dsh-plugin.json')) {
    problems.push('dsh-plugin.json is not listed in package.json files[]');
  }
  if (manifest.facets?.host?.entry !== 'lib/index.js') {
    problems.push('dsh-plugin.json host entry is not lib/index.js');
  }
  const section = (manifest.contributes?.['x-dsh-tui'] ?? []).find((entry) => entry.kind === 'SettingsSection');
  if (!section) {
    problems.push('dsh-plugin.json has no x-dsh-tui SettingsSection');
  } else if (!Array.isArray(section.spec?.fields) || section.spec.fields.length < 8) {
    problems.push('dsh-plugin.json SettingsSection has fewer than 8 fields');
  }
} catch (error) {
  problems.push(`dsh-plugin.json: ${error.message}`);
}
if (problems.length) {
  console.error('pack-check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// Syntax-check every shipped module. A stray apostrophe in a string is the
// kind of typo that only shows up when the server is spawned at runtime, so it
// has to fail the pack instead — it did once (an unescaped `input's` inside a
// single-quoted description) and every layer failed at once.
const targets = [
  ...(await walk(path.join(ROOT, 'mcp'))).filter((f) => f.endsWith('.mjs')),
  ...(await walk(path.join(ROOT, 'lib'))).filter((f) => /\.(mjs|js)$/.test(f)),
];
for (const file of new Set(targets)) {
  try {
    await run(process.execPath, ['--check', file]);
  } catch (error) {
    const first = String(error.stderr || error.message || '').split('\n').find((l) => l.trim()) || 'unknown error';
    problems.push(`syntax error in ${path.relative(ROOT, file)}: ${first.trim()}`);
  }
}

// --- plugin manifest -------------------------------------------------------
try {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'dsh-plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    problems.push(`dsh-plugin.json version ${manifest.version} != package.json ${pkg.version}`);
  }
  if (!pkg.files.includes('dsh-plugin.json')) {
    problems.push('dsh-plugin.json is not listed in package.json files[]');
  }
  if (manifest.facets?.host?.entry !== 'lib/index.js') {
    problems.push('dsh-plugin.json host entry is not lib/index.js');
  }
  const section = (manifest.contributes?.['x-dsh-tui'] ?? []).find((entry) => entry.kind === 'SettingsSection');
  if (!section) {
    problems.push('dsh-plugin.json has no x-dsh-tui SettingsSection');
  } else if (!Array.isArray(section.spec?.fields) || section.spec.fields.length < 8) {
    problems.push('dsh-plugin.json SettingsSection has fewer than 8 fields');
  }
} catch (error) {
  problems.push(`dsh-plugin.json: ${error.message}`);
}
if (problems.length) {
  console.error('pack-check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('pack-check ok');
