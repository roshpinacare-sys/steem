import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['node_modules', 'dist', '.git', '.cache', 'evidence/generated']);
const rows = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    const rel = relative(root, absolute).replaceAll('\\', '/');
    if ([...excluded].some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
    const stat = statSync(absolute);
    if (stat.isDirectory()) walk(absolute);
    else if (stat.isFile() && !rel.includes('/__pycache__/') && !rel.endsWith('.pyc')) {
      const bytes = readFileSync(absolute);
      rows.push({ path: rel, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
walk(root);
rows.sort((a, b) => a.path.localeCompare(b.path));
const output = join(root, 'evidence', 'generated', 'artifact-manifest.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ version: '33.56', files: rows }, null, 2)}\n`);
console.log(`manifested ${rows.length} files`);
