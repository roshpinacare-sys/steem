#!/usr/bin/env node
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { inspectBinaryArtifactV32_14 } from '../dist/src/binary/proof-carrying-binary-v32_14.js';
import { parseStrictJsonV32_12 } from '../dist/src/validation/strict-json-v32_12.js';

const [artifactArg, policyArg, outputArg] = process.argv.slice(2);
if (!artifactArg || !policyArg || !outputArg) throw new Error('usage: inspect-binary-v32_14 <artifact> <policy.json> <manifest.json>');
const artifact = resolve(artifactArg); const output = resolve(outputArg);
if (existsSync(output)) unlinkSync(output);
const parse = (path) => parseStrictJsonV32_12(readFileSync(path, 'utf8'));
const policy = parse(resolve(policyArg));
const manifest = inspectBinaryArtifactV32_14(basename(artifact), readFileSync(artifact), policy);
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const temp = `${output}.tmp-${process.pid}`;
writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
renameSync(temp, output);
console.log(JSON.stringify({ status: manifest.verdict === 'REJECT' ? 'rejected' : 'passed', verdict: manifest.verdict, artifact: manifest.artifactName, contentDigest: manifest.contentDigest, manifest: output }, null, 2));
if (manifest.verdict === 'REJECT') process.exitCode = 2;
