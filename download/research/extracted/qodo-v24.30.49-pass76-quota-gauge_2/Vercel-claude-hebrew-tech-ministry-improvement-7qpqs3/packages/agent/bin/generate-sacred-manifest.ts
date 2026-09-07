#!/usr/bin/env node
/**
 * generate-sacred-manifest.ts — (re)baselines .sacred-manifest.json from the
 * current on-disk contents of SACRED_FILES.
 *
 * Intentionally a manual, explicit step (not something the pipeline runs on
 * its own) — run this after a reviewed, intentional change to one of
 * SACRED_FILES lands, so the manifest always reflects a human-approved
 * state rather than silently absorbing drift. See
 * src/services/sacred-file-integrity.ts and HARD-TASKS-BACKLOG.md item #14.
 *
 * Usage: npx tsx bin/generate-sacred-manifest.ts
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSacredManifest, SACRED_FILES } from "../src/services/sacred-file-integrity.js";

// Anchor to the repo root from this file's location (packages/agent/bin/..)
// so `npm run sacred:generate` works regardless of the caller's cwd.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = generateSacredManifest(workspaceRoot);
const written = Object.keys(manifest.files).length;

console.log(`Sacred manifest written: ${written}/${SACRED_FILES.length} file(s) hashed.`);
if (written < SACRED_FILES.length) {
  console.warn("Some SACRED_FILES entries were not found on disk — see warnings above.");
  process.exitCode = 1;
}
