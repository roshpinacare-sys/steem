import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

export interface RepositoryInventory {
  readonly root: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly files: readonly { path: string; bytes: number; sha256: string }[];
  readonly treeDigest: string;
}

export async function inventoryRepository(root: string): Promise<RepositoryInventory> {
  const canonicalRoot = await realpath(root);
  const files: { path: string; bytes: number; sha256: string }[] = [];
  await walk(canonicalRoot, canonicalRoot, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const treeDigest = createHash('sha256')
    .update(JSON.stringify(files))
    .digest('hex');
  return {
    root: canonicalRoot,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    treeDigest,
  };
}

async function walk(
  root: string,
  current: string,
  output: { path: string; bytes: number; sha256: string }[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const absolute = resolve(current, entry.name);
    const rel = relative(root, absolute);
    if (rel.startsWith(`..${sep}`) || rel === '..') throw new Error('path_escape_detected');
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) throw new Error('symlink_rejected');
    if (stats.isDirectory()) {
      await walk(root, absolute, output);
    } else if (stats.isFile()) {
      const bytes = await readFile(absolute);
      output.push({
        path: rel.replaceAll(sep, '/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
