#!/usr/bin/env node
/**
 * Validate `dsh-plugin.json` against the vendored DSH manifest schema.
 *
 * Offline by default (no network in the gate). `--remote` additionally compares
 * the vendored schema with upstream `main` so schema drift is visible instead of
 * silently rotting.
 *
 *   node scripts/check-manifest.mjs
 *   node scripts/check-manifest.mjs --remote
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'dsh-plugin-0.15.schema.json');
const MANIFEST_PATH = path.join(ROOT, 'dsh-plugin.json');
const UPSTREAM_URL =
  'https://raw.githubusercontent.com/T-Auto/dsh-std/main/packages/manifest/schema/dsh-plugin-0.15.schema.json';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const here = (file) => path.relative(ROOT, file).split(path.sep).join('/');

async function main() {
  const schemaText = await readFile(SCHEMA_PATH, 'utf8');
  const schema = JSON.parse(schemaText);
  const manifest = await readJson(MANIFEST_PATH);
  const pkg = await readJson(path.join(ROOT, 'package.json'));

  const problems = [];

  if (schema.title !== 'DSH Plugin Manifest Community Draft v0.15') {
    problems.push(`unexpected schema title: ${schema.title}`);
  }

  const result = validate(schema, manifest);
  problems.push(...result.errors);

  if (manifest.version !== pkg.version) {
    problems.push(`manifest version ${manifest.version} != package.json ${pkg.version}`);
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes('dsh-plugin.json')) {
    problems.push('dsh-plugin.json is not listed in package.json files[]');
  }
  const entry = manifest.facets && manifest.facets.host && manifest.facets.host.entry;
  if (entry && !existsSync(path.join(ROOT, entry))) {
    problems.push(`facets.host.entry points at a missing file: ${entry}`);
  }
  const tui = manifest.contributes && manifest.contributes['x-dsh-tui'];
  if (!Array.isArray(tui) || tui.length === 0) {
    problems.push('contributes["x-dsh-tui"] must be a non-empty array');
  }

  console.log(`schema   : ${schema.title}`);
  console.log(`schema   : ${here(SCHEMA_PATH)} sha256=${sha256(schemaText)}`);
  console.log(`manifest : ${here(MANIFEST_PATH)} ${manifest.id}@${manifest.version}`);

  if (process.argv.includes('--remote')) {
    try {
      const response = await fetch(UPSTREAM_URL, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const remoteText = await response.text();
      const local = sha256(schemaText);
      const remote = sha256(remoteText);
      if (local === remote) {
        console.log(`upstream : in sync (sha256=${remote})`);
      } else {
        console.log(`upstream : DRIFTED (local=${local} remote=${remote})`);
        problems.push('vendored schema no longer matches upstream main — re-vendor and update schemas/README.md');
      }
    } catch (error) {
      console.log(`upstream : skipped (${error.message})`);
    }
  }

  if (problems.length) {
    console.error('\nmanifest check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('\nmanifest ok');
}

await main();
