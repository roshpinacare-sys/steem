/**
 * Dry-Run Mode — wraps the pipeline commit/push step so that when
 * --dry-run flag is passed, all destructive operations are skipped
 * and a detailed simulation report is emitted instead.
 *
 * Extended in Pass 67: VirusTotal file hash reputation checks can be attached
 * to a dry-run report via `setVirusTotalFindings()`. When VT_API_KEY is set,
 * callers may scan SBOM package hashes and record findings here for inclusion
 * in the full report.
 */
import { log as logger } from './logger.js';
import type { VirusTotalFinding } from './integrations/virustotal.js';

export type { VirusTotalFinding };

export interface DryRunReport {
  mode: 'dry-run';
  timestamp: string;
  wouldCommit: boolean;
  wouldPush: boolean;
  simulatedActions: SimulatedAction[];
  summary: string;
  /** VirusTotal hash reputation findings for packages in scope.
   *  Present only when VT_API_KEY was set and findings were recorded. */
  virusTotalFindings?: VirusTotalFinding[];
}

export interface SimulatedAction {
  action: string;
  target: string;
  skippedReason: string;
}

export interface DryRunEnv {
  DRY_RUN?: string;
}

let _isDryRun = false;
const _simulatedActions: SimulatedAction[] = [];
let _virusTotalFindings: VirusTotalFinding[] | undefined;

export function initDryRun(args: string[], env: DryRunEnv = process.env as DryRunEnv): void {
  _isDryRun = args.includes('--dry-run') || env.DRY_RUN === 'true';
  if (_isDryRun) {
    logger.info('DRY-RUN mode activated — no commits or pushes will occur');
  }
}

export function isDryRun(): boolean {
  return _isDryRun;
}

export function dryRunSkip(action: string, target: string): boolean {
  if (!_isDryRun) return false;
  const entry: SimulatedAction = {
    action,
    target,
    skippedReason: 'dry-run flag active',
  };
  _simulatedActions.push(entry);
  logger.info('[DRY-RUN] Skipping action', { action, target });
  return true;
}

/**
 * Attach VirusTotal hash reputation findings to the next `getDryRunReport()`
 * call. Call this after `scanHashesWithVirusTotal()` completes. If findings
 * contains flagged packages, a warning is emitted.
 *
 * Only has an effect when dry-run mode is active.
 */
export function setVirusTotalFindings(findings: VirusTotalFinding[]): void {
  if (!_isDryRun) return;
  _virusTotalFindings = findings;
  const flagged = findings.filter((f) => f.flagged);
  if (flagged.length > 0) {
    logger.warn('[DRY-RUN] VirusTotal flagged packages as potentially malicious', {
      flagged: flagged.map((f) => `${f.packageName}@${f.packageVersion}`),
    });
  } else {
    logger.info('[DRY-RUN] VirusTotal scan: no malicious packages detected', {
      checked: findings.length,
    });
  }
}

export function getDryRunReport(): DryRunReport {
  const report: DryRunReport = {
    mode: 'dry-run',
    timestamp: new Date().toISOString(),
    wouldCommit: _simulatedActions.some((a) => a.action === 'git-commit'),
    wouldPush: _simulatedActions.some((a) => a.action === 'git-push'),
    simulatedActions: [..._simulatedActions],
    summary: `${_simulatedActions.length} action(s) were skipped in dry-run mode`,
  };

  if (_virusTotalFindings !== undefined) {
    report.virusTotalFindings = [..._virusTotalFindings];
  }

  return report;
}

/** Reset all dry-run state — only for tests. */
export function _resetDryRun(): void {
  _isDryRun = false;
  _simulatedActions.length = 0;
  _virusTotalFindings = undefined;
}
