import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export type SecurityFindingKind = 'PROMPT_INJECTION' | 'SECRET_CANDIDATE' | 'DEPENDENCY_RISK' | 'SYMLINK' | 'OVERSIZED_TEXT';

export interface SecurityFinding {
  readonly kind: SecurityFindingKind;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly file: string;
  readonly ruleId: string;
  readonly summary: string;
}

const INJECTION_RULES = [
  { id: 'PI-IGNORE', pattern: /ignore\s+(all|any|the|previous|prior)\s+(instructions?|rules?|policy)/i, summary: 'Repository text attempts to override governing instructions.' },
  { id: 'PI-EXFIL', pattern: /(exfiltrat|send|upload|post).{0,80}(secret|credential|token|environment|private key)/i, summary: 'Repository text requests possible data exfiltration.' },
  { id: 'PI-DISABLE', pattern: /(disable|delete|remove|skip).{0,50}(test|security|audit|review|guard)/i, summary: 'Repository text requests weakening validation.' },
  { id: 'PI-HIDDEN', pattern: /(system prompt|developer message|hidden instruction|act as root|bypass authorization)/i, summary: 'Repository text contains authority-confusion language.' },
] as const;

const SECRET_RULES = [
  { id: 'SEC-PRIVATE-KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, summary: 'Private-key material candidate detected.' },
  { id: 'SEC-AWS', pattern: /AKIA[0-9A-Z]{16}/, summary: 'AWS access-key identifier candidate detected.' },
  { id: 'SEC-TOKEN', pattern: /(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/i, summary: 'Credential-like assignment detected.' },
] as const;

export async function scanRepositorySecurity(root: string, maxTextBytes = 512_000): Promise<readonly SecurityFinding[]> {
  const absoluteRoot = resolve(root);
  const findings: SecurityFinding[] = [];
  await walk(absoluteRoot, async (absolutePath) => {
    const rel = normalizeRelative(absoluteRoot, absolutePath);
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      findings.push({ kind: 'SYMLINK', severity: 'high', file: rel, ruleId: 'FS-SYMLINK', summary: 'Symbolic link requires explicit boundary review.' });
      return;
    }
    if (!stat.isFile()) return;
    if (stat.size > maxTextBytes) {
      if (isLikelyText(rel)) findings.push({ kind: 'OVERSIZED_TEXT', severity: 'low', file: rel, ruleId: 'TEXT-SIZE', summary: 'Text-like file exceeded bounded scan size.' });
      return;
    }
    if (!isLikelyText(rel)) return;
    const content = await readFile(absolutePath, 'utf8').catch(() => '');
    for (const rule of INJECTION_RULES) {
      if (rule.pattern.test(content)) findings.push({ kind: 'PROMPT_INJECTION', severity: 'high', file: rel, ruleId: rule.id, summary: rule.summary });
    }
    for (const rule of SECRET_RULES) {
      if (rule.pattern.test(content)) findings.push({ kind: 'SECRET_CANDIDATE', severity: 'critical', file: rel, ruleId: rule.id, summary: rule.summary });
    }
    if (rel === 'package.json') {
      try {
        const packageJson = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        for (const [name, version] of Object.entries({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
          if (version === '*' || version === 'latest' || version.startsWith('http:')) {
            findings.push({ kind: 'DEPENDENCY_RISK', severity: 'high', file: rel, ruleId: 'DEP-UNPINNED', summary: `Dependency ${name} uses an unsafe or unpinned locator.` });
          }
        }
      } catch {
        findings.push({ kind: 'DEPENDENCY_RISK', severity: 'medium', file: rel, ruleId: 'DEP-PARSE', summary: 'package.json could not be parsed.' });
      }
    }
  });
  return findings.sort((a, b) => `${a.file}:${a.ruleId}`.localeCompare(`${b.file}:${b.ruleId}`));
}

async function walk(directory: string, visit: (path: string) => Promise<void>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, visit);
    else await visit(path);
  }
}

function normalizeRelative(root: string, path: string): string {
  const rel = relative(root, path);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('scan_path_escape');
  return rel.split(sep).join('/');
}

function isLikelyText(path: string): boolean {
  return /(?:^|\/)(?:README|SECURITY|CONTRIBUTING|CLAUDE|AGENTS)(?:\.[^/]*)?$|\.(?:md|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|jsx|css|html|xml|sql|sh|py|rs|c|h|cpp|java|go)$/i.test(path);
}
