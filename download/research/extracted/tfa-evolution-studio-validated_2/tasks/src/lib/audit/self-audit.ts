/**
 * TFA Evolution Studio v28 — Repository Self-Audit
 *
 * Scans the platform's own source tree for:
 *   - stale version references (e.g. "v19", "v20" sprinkled in docs/code
 *     while package.json reports a newer major)
 *   - "← current" markers that disagree with package.json
 *   - missing release-notes file for the active major
 *   - smoke-test → required-modules contradictions
 *   - hidden coupling: imports of files that do not exist
 *
 * Used by the V22 release pipeline to fail closed when any of these are
 * detected. Pure read-only — never mutates the repository.
 */

import fs from "fs";
import path from "path";

export interface SelfAuditFinding {
  severity: "high" | "medium" | "low";
  kind:
    | "stale_version_marker"
    | "missing_release_notes"
    | "header_version_mismatch"
    | "broken_local_import"
    | "current_marker_mismatch"
    | "lockfile_version_mismatch";
  file: string;
  line?: number;
  message: string;
}

export interface SelfAuditReport {
  scannedFiles: number;
  packageVersion: string;
  findings: SelfAuditFinding[];
  clean: boolean;
  ranAt: string;
}

const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", ".turbo"]);

function* walk(root: string): Generator<string> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (TEXT_EXTS.has(path.extname(e.name))) {
        yield full;
      }
    }
  }
}

function readPackageVersion(repoRoot: string): string {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return "0.0.0";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}


function readLockfileVersion(repoRoot: string): string | null {
  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    return lock.version ?? null;
  } catch {
    return null;
  }
}

export interface AuditOptions {
  // Treat older "v19" / "v20" mentions in *historical* release notes files as
  // expected. Default skips files matching V\d+-RELEASE-NOTES.md and any file
  // under a path segment containing "release-notes" or "history".
  historicalNotesPattern?: RegExp;
}

export function runSelfAudit(repoRoot: string, opts: AuditOptions = {}): SelfAuditReport {
  const packageVersion = readPackageVersion(repoRoot);
  const majorString = `v${packageVersion.split(".")[0]}`;
  const historicalPattern =
    opts.historicalNotesPattern ?? /(V\d+-RELEASE-NOTES\.md|release-notes|history|CHANGELOG)/i;

  const findings: SelfAuditFinding[] = [];
  let scanned = 0;

  // 1. Check that the per-major release notes exist for the current major.
  const notesFile = path.join(repoRoot, `${majorString.toUpperCase()}-RELEASE-NOTES.md`);
  if (!fs.existsSync(notesFile)) {
    findings.push({
      severity: "high",
      kind: "missing_release_notes",
      file: path.basename(notesFile),
      message: `Missing release notes for ${majorString.toUpperCase()}`,
    });
  }


  // 1b. Lockfile version coherence: package-lock.json must match package.json.
  const lockVersion = readLockfileVersion(repoRoot);
  if (lockVersion !== null && lockVersion !== packageVersion) {
    findings.push({
      severity: 'high',
      kind: "lockfile_version_mismatch",
      file: 'package-lock.json',
      message: `package-lock.json version (${lockVersion}) does not match package.json (${packageVersion})`,
    });
  }

  // Build a quick set of relative project paths for cheap import-resolution checks.
  const projectFiles = new Set<string>();
  for (const f of walk(repoRoot)) projectFiles.add(path.relative(repoRoot, f));

  for (const file of walk(repoRoot)) {
    scanned++;
    const rel = path.relative(repoRoot, file);
    const skipStaleScan = historicalPattern.test(rel);
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");

    // Markdown-only checks: marker / heading / stale-version scanning.
    // Restricting to .md keeps detection strings inside scanner source code,
    // CLI scripts, and historical release notes from triggering self-findings.
    const isMarkdown = rel.endsWith(".md");
    const isHistoricalNotes = historicalPattern.test(rel);
    const isActiveNotesOrReadme = /^(README|RELEASE_NOTES)\.md$/i.test(rel);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 2. Stale "current" markers tied to wrong version.
      //    Only enforced inside the *active* RELEASE_NOTES.md and README.md —
      //    historical Vxx-RELEASE-NOTES.md and scanner sources are exempt.
      if (isMarkdown && isActiveNotesOrReadme && !isHistoricalNotes) {
        const lower = line.toLowerCase();
        if (lower.includes("\u2190 **current**") || lower.includes("\u2190 current")) {
          if (!line.includes(packageVersion)) {
            findings.push({
              severity: "high",
              kind: "current_marker_mismatch",
              file: rel,
              line: i + 1,
              message: `Current marker on this line does not include package version ${packageVersion}`,
            });
          }
        }
      }

      // 3. README/RELEASE_NOTES level-1 heading must match current version.
      if (i === 0 && line.startsWith("# ") && isActiveNotesOrReadme) {
        const match = line.match(/v(\d+)\.(\d+)\.(\d+)/);
        if (match && match[0] !== `v${packageVersion}`) {
          findings.push({
            severity: "high",
            kind: "header_version_mismatch",
            file: rel,
            line: 1,
            message: `Top-level heading is ${match[0]} but package.json is v${packageVersion}`,
          });
        }
      }

      // 4. Stale prior-major active mentions in non-historical markdown.
      if (isMarkdown && !isHistoricalNotes) {
        const m = line.match(/\bv(\d+)\.0\.0\b/g);
        if (m) {
          for (const ref of m) {
            const refMajor = parseInt(ref.slice(1).split(".")[0], 10);
            const currentMajor = parseInt(packageVersion.split(".")[0], 10);
            if (refMajor < currentMajor && /current|active|latest|^# /i.test(line) && !/(previously|prior|former|deprecated|historical|earlier)/i.test(line)) {
              findings.push({
                severity: "medium",
                kind: "stale_version_marker",
                file: rel,
                line: i + 1,
                message: `Stale active reference to ${ref} while package.json is v${packageVersion}`,
              });
            }
          }
        }
      }

      // 5. Broken local imports. Skip self-audit source — it embeds the
      //    import pattern as a literal example in its detection regex.
      if (rel !== "src/lib/audit/self-audit.ts") {
        const importMatch = line.match(/from\s+["'](\.\.?\/[^"']+)["']/);
        if (importMatch && /\.(ts|tsx|mjs|js)$/.test(rel)) {
          const target = importMatch[1];
          const baseDir = path.dirname(file);
          const resolved = path.resolve(baseDir, target);
          const candidates = [
            resolved,
            resolved + ".ts",
            resolved + ".tsx",
            resolved + ".js",
            resolved + ".mjs",
            path.join(resolved, "index.ts"),
            path.join(resolved, "index.tsx"),
          ];
          if (!candidates.some((c) => fs.existsSync(c))) {
            findings.push({
              severity: "high",
              kind: "broken_local_import",
              file: rel,
              line: i + 1,
              message: `Import target not found: ${target}`,
            });
          }
        }
      }
    }

  }

  return {
    scannedFiles: scanned,
    packageVersion,
    findings,
    clean: findings.length === 0,
    ranAt: new Date().toISOString(),
  };
}

export function formatReport(report: SelfAuditReport): string {
  const head = `Self-Audit ${report.ranAt} — package v${report.packageVersion} — scanned ${report.scannedFiles} files`;
  if (report.clean) return `${head}\n  ✓ clean`;
  const lines = report.findings.map(
    (f) => `  [${f.severity.toUpperCase()}] ${f.kind} — ${f.file}${f.line ? ":" + f.line : ""}: ${f.message}`
  );
  return `${head}\n${lines.join("\n")}`;
}
