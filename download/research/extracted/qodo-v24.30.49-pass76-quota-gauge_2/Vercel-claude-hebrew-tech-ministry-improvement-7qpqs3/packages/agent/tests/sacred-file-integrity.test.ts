/**
 * Unit tests for sacred-file-integrity.ts (HARD-TASKS-BACKLOG.md item #14).
 * Uses an isolated tmp workspace with a tiny stand-in file set rather than
 * the real SACRED_FILES list, so these tests don't depend on this repo's
 * own current file contents.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sacred from '../src/services/sacred-file-integrity.js';

describe('sacred-file-integrity', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'qodo-sacred-'));
    mkdirSync(join(workspace, 'packages/agent/src/validators'), { recursive: true });
    mkdirSync(join(workspace, 'packages/agent/src/services'), { recursive: true });
    mkdirSync(join(workspace, 'packages/agent/src/schemas'), { recursive: true });
    // Write real content to every path SACRED_FILES expects, since the
    // module's file list is fixed rather than injectable.
    for (const rel of sacred.SACRED_FILES) {
      const abs = join(workspace, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, `// stub content for ${rel}\n`);
    }
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('reports every file as unbaselined when no manifest exists yet', () => {
    const result = sacred.verifySacredFiles(workspace);
    expect(result.ok).toBe(true); // unbaselined is not the same as drifted/missing
    expect(result.drifted).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.unbaselined.length).toBe(sacred.SACRED_FILES.length);
  });

  it('generates a manifest and verifies clean with no drift', () => {
    sacred.generateSacredManifest(workspace);
    const result = sacred.verifySacredFiles(workspace);
    expect(result.ok).toBe(true);
    expect(result.drifted).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.unbaselined).toEqual([]);
  });

  it('detects drift when a sacred file changes after baselining', () => {
    sacred.generateSacredManifest(workspace);
    const target = sacred.SACRED_FILES[0];
    writeFileSync(join(workspace, target), '// tampered content\n');

    const result = sacred.verifySacredFiles(workspace);
    expect(result.ok).toBe(false);
    expect(result.drifted).toEqual([target]);
    expect(result.missing).toEqual([]);
  });

  it('detects a missing sacred file after baselining', () => {
    sacred.generateSacredManifest(workspace);
    const target = sacred.SACRED_FILES[1];
    rmSync(join(workspace, target));

    const result = sacred.verifySacredFiles(workspace);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([target]);
  });

  it('is stable across repeated verification with no changes (no false positives)', () => {
    sacred.generateSacredManifest(workspace);
    const first = sacred.verifySacredFiles(workspace);
    const second = sacred.verifySacredFiles(workspace);
    expect(first).toEqual(second);
    expect(second.ok).toBe(true);
  });

  it('verifyAndAuditSacredFiles appends an audit entry only when drift is found', () => {
    sacred.generateSacredManifest(workspace);

    // Clean run: no audit file should be created.
    sacred.verifyAndAuditSacredFiles(workspace, 'test-run-1');
    expect(() => readFileSync(join(workspace, '.audit-log.ndjson'), 'utf8')).toThrow();

    // Introduce drift, then verify an audit entry is appended.
    const target = sacred.SACRED_FILES[0];
    writeFileSync(join(workspace, target), '// tampered\n');
    sacred.verifyAndAuditSacredFiles(workspace, 'test-run-2');

    const auditContents = readFileSync(join(workspace, '.audit-log.ndjson'), 'utf8').trim();
    const lastEntry = JSON.parse(auditContents.split('\n').pop()!);
    expect(lastEntry.event).toBe('sacred-file-drift-detected');
    expect(lastEntry.payload.drifted).toEqual([target]);
  });
});
