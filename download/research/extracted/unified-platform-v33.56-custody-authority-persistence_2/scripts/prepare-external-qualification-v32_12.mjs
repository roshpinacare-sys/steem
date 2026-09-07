#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseStrictJsonV32_12 } from '../dist/src/validation/strict-json-v32_12.js';

const manifestPath = process.argv[2];
const outputDirectory = process.argv[3];
if (!manifestPath || !outputDirectory) {
  console.error('usage: prepare-external-qualification-v32_12.mjs <manifest.json> <run-directory>');
  process.exit(64);
}
try {
  const manifest = parseStrictJsonV32_12(readFileSync(resolve(manifestPath), 'utf8'));
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.schemaVersion !== '32.12' || typeof manifest.gateId !== 'string') throw new Error('qualification_manifest_invalid');
  const out = resolve(outputDirectory); mkdirSync(out, { recursive: true });
  const plan = {
    schemaVersion: '32.12', gateId: manifest.gateId, status: 'not_executed', evidenceClass: 'SIMULATED', synthetic: true,
    challengeNonce: randomBytes(32).toString('base64url'), preparedAt: new Date().toISOString(), manifestPath: resolve(manifestPath),
    requiredAction: 'Replace this preparation record with independently collected OBSERVED evidence. This file cannot satisfy production policy.',
  };
  const target = join(out, `${basename(manifest.gateId)}-preparation.json`); writeFileSync(target, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ status: 'prepared-not-executed', path: target }, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exit(2);
}
