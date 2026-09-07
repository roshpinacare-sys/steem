export interface AdvisoryAuditInput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}
export interface AdvisoryAuditResult {
  readonly status: 'passed' | 'failed' | 'environment-blocked';
  readonly total: number | null;
  readonly vulnerabilities: Readonly<Record<string, number>>;
  readonly blocker?: string;
  readonly rawDigestEligible: boolean;
}
export function classifyNpmAudit(input: AdvisoryAuditInput): AdvisoryAuditResult {
  let parsed: unknown;
  try { parsed = JSON.parse(input.stdout); } catch { parsed = undefined; }
  const metadata = isRecord(parsed) && isRecord(parsed.metadata) ? parsed.metadata : undefined;
  const vulnerabilities = metadata !== undefined && isRecord(metadata.vulnerabilities) ? numericRecord(metadata.vulnerabilities) : undefined;
  const total = vulnerabilities?.total;
  if (typeof total === 'number' && total > 0) return { status: 'failed', total, vulnerabilities: vulnerabilities ?? {}, rawDigestEligible: true };
  if (input.exitCode === 0 && typeof total === 'number') return { status: 'passed', total, vulnerabilities: vulnerabilities ?? {}, rawDigestEligible: true };
  const detail = [input.error, input.stderr.trim(), isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : undefined].filter((value): value is string => Boolean(value)).join(' | ');
  return { status: 'environment-blocked', total: null, vulnerabilities: vulnerabilities ?? {}, blocker: detail || `npm_audit_unavailable:exit=${input.exitCode ?? 'null'}`, rawDigestEligible: input.stdout.trim() !== '' };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function numericRecord(value: Record<string, unknown>): Record<string, number> { const result: Record<string, number> = {}; for (const [key, item] of Object.entries(value)) if (typeof item === 'number' && Number.isFinite(item) && item >= 0) result[key] = item; return result; }
