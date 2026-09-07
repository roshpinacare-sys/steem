import type { OperationalMetrics } from "@/lib/observability/metrics";

export type ReadinessState = "pass" | "warn" | "block" | "unknown";

export interface ReadinessGate {
  id: string;
  label: string;
  state: ReadinessState;
  evidence: string;
  nextAction?: string;
}

export interface PilotReadiness {
  classification: "REJECTED" | "DEVELOPMENT ONLY" | "CONTROLLED INTERNAL PILOT";
  score: number;
  blockers: number;
  warnings: number;
  gates: ReadinessGate[];
}

export interface ReleaseEvidenceFacts {
  buildPassed?: boolean;
  nativeTestsPassed?: boolean;
  browserE2ePassed?: boolean;
  accessibilityPassed?: boolean;
  extractedPackagePassed?: boolean;
  durableRestartPassed?: boolean;
  approvalRestartPassed?: boolean;
  tenantIsolationPassed?: boolean;
  backupRestorePassed?: boolean;
  criticalSecurityPassed?: boolean;
  openCriticalFindings?: number;
}

function boolGate(
  id: string,
  label: string,
  value: boolean | undefined,
  evidence: string,
  nextAction: string,
): ReadinessGate {
  if (value === true) return { id, label, state: "pass", evidence };
  if (value === false) return { id, label, state: "block", evidence, nextAction };
  return { id, label, state: "unknown", evidence, nextAction };
}

export function evaluatePilotReadiness(
  metrics: OperationalMetrics,
  release: ReleaseEvidenceFacts = {},
): PilotReadiness {
  const gates: ReadinessGate[] = [
    {
      id: "runtime_reconciliation",
      label: "No unresolved reconciliation debt",
      state: metrics.durableJobs.needsReconciliation === 0 ? "pass" : "block",
      evidence: `${metrics.durableJobs.needsReconciliation} durable job(s) require reconciliation.`,
      nextAction: "Resolve or explicitly abandon every ambiguous side effect before pilot use.",
    },
    {
      id: "runtime_outbox",
      label: "No failed durable publications",
      state: metrics.outbox.failed === 0 ? "pass" : "block",
      evidence: `${metrics.outbox.failed} outbox item(s) are failed.`,
      nextAction: "Reconcile failed outbox items and prove duplicate-safe publication.",
    },
    {
      id: "runtime_approvals",
      label: "No expired unresolved approvals",
      state: metrics.approvals.expired === 0 ? "pass" : "warn",
      evidence: `${metrics.approvals.expired} approval(s) expired.`,
      nextAction: "Review expired decisions and verify that no workflow resumed without authority.",
    },
    boolGate("build", "Production build", release.buildPassed, release.buildPassed === true ? "Production build evidence passed." : "No bound passing production-build evidence.", "Run the production build and bind its output hash to the release."),
    boolGate("native_tests", "Native persistence tests", release.nativeTestsPassed, release.nativeTestsPassed === true ? "SQLite-native suites passed." : "SQLite-native suites are not proven for this artifact.", "Run all native persistence suites in an approved environment."),
    boolGate("browser_e2e", "Browser end-to-end workflow", release.browserE2ePassed, release.browserE2ePassed === true ? "Browser E2E passed." : "No passing browser E2E evidence is bound to this release.", "Run the pilot workflow in a real browser with backend persistence."),
    boolGate("accessibility", "Accessibility gate", release.accessibilityPassed, release.accessibilityPassed === true ? "Accessibility evidence passed." : "Accessibility remains unproven in a browser.", "Run automated and manual accessibility checks including keyboard and zoom."),
    boolGate("durable_restart", "Step-level restart recovery", release.durableRestartPassed, release.durableRestartPassed === true ? "Restart recovery passed." : "Step-level restart recovery is not fully proven on the active runner.", "Prove crash/restart recovery for the selected pilot workflow."),
    boolGate("approval_restart", "Approval continuation after restart", release.approvalRestartPassed, release.approvalRestartPassed === true ? "Durable approval continuation passed." : "Approval continuation after restart is not proven.", "Persist approval waits and prove restart-safe resolution and expiry."),
    boolGate("tenant_isolation", "Tenant isolation", release.tenantIsolationPassed, release.tenantIsolationPassed === true ? "Tenant-isolation suite passed." : "Tenant isolation is not fully proven.", "Run positive and negative cross-tenant tests at every storage boundary."),
    boolGate("backup_restore", "Clean-target restore", release.backupRestorePassed, release.backupRestorePassed === true ? "Clean-target restore passed." : "Restore evidence is not bound to this release.", "Create an encrypted backup and restore it into a clean target."),
    boolGate("critical_security", "Critical security gates", release.criticalSecurityPassed, release.criticalSecurityPassed === true ? "Critical security tests passed." : "Critical security status is incomplete.", "Run capability, SSRF, authorization, secret, and tamper tests."),
    boolGate("extracted_package", "Extracted artifact validation", release.extractedPackagePassed, release.extractedPackagePassed === true ? "Extracted ZIP validation passed." : "The final archive has not yet been revalidated after extraction.", "Extract the final ZIP and rerun release gates against that copy."),
    {
      id: "critical_findings",
      label: "No open critical finding in pilot scope",
      state: release.openCriticalFindings === undefined ? "unknown" : release.openCriticalFindings === 0 ? "pass" : "block",
      evidence: release.openCriticalFindings === undefined ? "Open-critical count is not bound to this release." : `${release.openCriticalFindings} critical finding(s) remain open.`,
      nextAction: "Close or explicitly remove affected workflows from pilot scope.",
    },
  ];

  const blockers = gates.filter((gate) => gate.state === "block").length;
  const unknowns = gates.filter((gate) => gate.state === "unknown").length;
  const warnings = gates.filter((gate) => gate.state === "warn").length + unknowns;
  const weights: Record<ReadinessState, number> = { pass: 1, warn: 0.55, unknown: 0.25, block: 0 };
  const score = Math.round(100 * gates.reduce((sum, gate) => sum + weights[gate.state], 0) / gates.length);
  const classification = blockers > 0 || unknowns > 0
    ? "DEVELOPMENT ONLY"
    : warnings > 0
      ? "CONTROLLED INTERNAL PILOT"
      : "CONTROLLED INTERNAL PILOT";
  return { classification, score, blockers, warnings, gates };
}
