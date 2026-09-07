import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryRepository } from '../src/capabilities/repository-inventory.js';

test('repository inventory traverses nested files while excluding generated trees and non-files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'inventory-v28-'));
  try {
    mkdirSync(join(root, 'nested'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'root.txt'), 'root');
    writeFileSync(join(root, 'nested', 'child.txt'), 'child');
    writeFileSync(join(root, '.git', 'ignored'), 'ignored');
    writeFileSync(join(root, 'node_modules', 'ignored'), 'ignored');
    writeFileSync(join(root, 'dist', 'ignored'), 'ignored');
    execFileSync('mkfifo', [join(root, 'named-pipe')]);
    const inventory = await inventoryRepository(root);
    assert.equal(inventory.fileCount, 2);
    assert.deepEqual(inventory.files.map((file) => file.path), ['nested/child.txt', 'root.txt']);
    assert.equal(inventory.totalBytes, 9);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repository inventory rejects symlinks and missing roots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'inventory-symlink-v28-'));
  try {
    symlinkSync('/etc/passwd', join(root, 'escape'));
    await assert.rejects(inventoryRepository(root), /symlink_rejected/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  await assert.rejects(inventoryRepository(join(tmpdir(), 'missing-inventory-v28')), /ENOENT/);
});
