/**
 * TFA Evolution Studio v28 — Project IR (Intermediate Representation)
 *
 * Parses a project ZIP into a canonical IR for analysis and transformation.
 * IR captures: file tree, imports, dependencies, entry points, and metadata.
 */

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { ensureDir } from "@/lib/paths";

export interface ProjectIR {
  projectName: string;
  rootDir: string;
  files: IRFile[];
  entryPoints: string[];
  dependencies: string[];
  devDependencies: string[];
  metadata: Record<string, unknown>;
}

export interface IRFile {
  relPath: string;
  absPath: string;
  size: number;
  extension: string;
  imports: string[];
  exports: string[];
  contentHash: string;
}

function hashContent(content: string): string {
  // Simple stable hash for content deduplication
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return "h" + Math.abs(hash).toString(36);
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  // Match ES module imports and CommonJS requires
  const esmRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"];?/g;
  const cjsRegex = /require\(['"]([^'"]+)['"]\)/g;
  let m: RegExpExecArray | null;
  while ((m = esmRegex.exec(content)) !== null) imports.push(m[1]);
  while ((m = cjsRegex.exec(content)) !== null) imports.push(m[1]);
  return [...new Set(imports)];
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const namedRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  const defaultRegex = /export\s+default\s+(?:function\s+)?(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = namedRegex.exec(content)) !== null) exports.push(m[1]);
  while ((m = defaultRegex.exec(content)) !== null) exports.push(m[1]);
  return [...new Set(exports)];
}

export function parseZipToIR(zipPath: string, extractDir: string): ProjectIR {
  ensureDir(extractDir);

  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP not found: ${zipPath}`);
  }

    // archives (path traversal entries, empty archives, missing root folder)
  // that previously caused silent corrupt IR or confusing mid-extraction errors.
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error(`ZIP is empty: ${zipPath}`);
  }
  const resolvedExtract = path.resolve(extractDir);
  for (const entry of entries) {
    const entryPath = path.resolve(resolvedExtract, entry.entryName);
    if (!entryPath.startsWith(resolvedExtract + path.sep) && entryPath !== resolvedExtract) {
      throw new Error(
        `ZIP contains path traversal entry: "${entry.entryName}". Extraction aborted.`
      );
    }
  }

  zip.extractAllTo(extractDir, true);

  const files: IRFile[] = [];
  const entryPoints: string[] = [];
  const dependencies: string[] = [];
  const devDependencies: string[] = [];

  function walk(dir: string, relBase: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else {
        const ext = path.extname(entry.name);
        const content = fs.readFileSync(abs, "utf-8");
        const file: IRFile = {
          relPath: rel,
          absPath: abs,
          size: fs.statSync(abs).size,
          extension: ext,
          imports: extractImports(content),
          exports: extractExports(content),
          contentHash: hashContent(content),
        };
        files.push(file);

        if (entry.name === "package.json") {
          try {
            const pkg = JSON.parse(content);
            if (pkg.dependencies) dependencies.push(...Object.keys(pkg.dependencies));
            if (pkg.devDependencies) devDependencies.push(...Object.keys(pkg.devDependencies));
            if (pkg.main) entryPoints.push(pkg.main);
            if (pkg.exports) entryPoints.push(...Object.keys(pkg.exports));
          } catch {
            // ignore malformed package.json
          }
        }
        if (entry.name === "index.ts" || entry.name === "index.js" || entry.name === "page.tsx") {
          entryPoints.push(rel);
        }
      }
    }
  }

  walk(extractDir, "");

  return {
    projectName: path.basename(extractDir),
    rootDir: extractDir,
    files,
    entryPoints: [...new Set(entryPoints)],
    dependencies: [...new Set(dependencies)],
    devDependencies: [...new Set(devDependencies)],
    metadata: {
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      parsedAt: new Date().toISOString(),
    },
  };
}
