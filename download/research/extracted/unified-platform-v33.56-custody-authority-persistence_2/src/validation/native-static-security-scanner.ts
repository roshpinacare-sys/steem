import { sha256 } from '../contracts/crypto.js';
import type { SarifEvidence, SarifFinding } from './security-evidence-import.js';

export interface SourceRecord { readonly path: string; readonly content: string; }
export interface NativeSecurityScanResult {
  readonly sarif: SarifEvidence;
  readonly scannedFiles: number;
  readonly ruleCounts: Readonly<Record<string, number>>;
  readonly status: 'PASS' | 'BLOCK';
  readonly reportDigest: string;
}

const RULES: readonly { id: string; level: SarifFinding['level']; pattern: RegExp }[] = [
  { id: 'native/no-eval', level: 'error', pattern: /\beval\s*\(/g },
  { id: 'native/no-function-constructor', level: 'error', pattern: /\bnew\s+Function\s*\(/g },
  { id: 'native/no-shell-true', level: 'error', pattern: /\bshell\s*:\s*true\b/g },
  { id: 'native/no-tls-verification-disable', level: 'error', pattern: /\brejectUnauthorized\s*:\s*false\b/g },
  { id: 'native/no-private-key-literal', level: 'error', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: 'native/no-workflow-write-all', level: 'error', pattern: /^\s*permissions\s*:\s*write-all\s*$/gm },
  { id: 'native/no-unpinned-action', level: 'warning', pattern: /\buses\s*:\s*[^\s#]+@(?![0-9a-f]{40}\b)[^\s#]+/g },
];

export function scanSourceRecords(records: readonly SourceRecord[], identity: { sourceDigest: string; artifactDigest: string }): NativeSecurityScanResult {
  if (!/^[0-9a-f]{64}$/.test(identity.sourceDigest) || !/^[0-9a-f]{64}$/.test(identity.artifactDigest)) throw new Error('scan_identity_invalid');
  const findings: SarifFinding[] = [];
  const counts: Record<string, number> = {};
  for (const row of [...records].sort((a,b)=>a.path.localeCompare(b.path))) {
    if (!row.path.trim()) throw new Error('scan_path_required');
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(row.content)) !== null) {
        const before = row.content.slice(0, match.index);
        const line = before.split('\n').length;
        const lineText = row.content.split('\n')[line-1] ?? '';
        if (rule.id === 'native/no-private-key-literal' && (/pattern\s*:/.test(lineText) || /\/-----BEGIN/.test(lineText) || /new RegExp/.test(lineText))) continue;
        const fingerprint = sha256({ ruleId: rule.id, path: row.path, line, match: match[0] });
        findings.push({ ruleId: rule.id, level: rule.level, fingerprint, suppressed: false });
        counts[rule.id] = (counts[rule.id] ?? 0) + 1;
        if (match[0].length === 0) rule.pattern.lastIndex++;
      }
    }
  }
  findings.sort((a,b)=>a.ruleId.localeCompare(b.ruleId)||a.fingerprint.localeCompare(b.fingerprint));
  const sarif: SarifEvidence = {
    sarifVersion:'2.1.0', toolName:'Unified Platform Native Static Scanner', toolVersion:'32.10',
    sourceDigest:identity.sourceDigest, artifactDigest:identity.artifactDigest,
    trustedTool:true, observed:true, complete:true, findings,
  };
  const status = findings.some((row)=>row.level==='error'&&!row.suppressed) ? 'BLOCK' as const : 'PASS' as const;
  const material = { status, scannedFiles: records.length, ruleCounts: Object.fromEntries(Object.entries(counts).sort()), sarif };
  return { ...material, reportDigest: sha256(material) };
}
