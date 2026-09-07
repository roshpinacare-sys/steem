import { describe, expect, it } from "vitest";
import { computeOperationalMetrics } from "@/lib/observability/metrics";
import { evaluatePilotReadiness } from "@/lib/release/pilot-readiness";

const healthyMetrics = computeOperationalMetrics({
  runs: [], approvalStatuses: [], outboxStatuses: [], durableJobStatuses: [],
  now: new Date("2026-07-11T00:00:00Z"),
});

const allReleaseFacts = {
  buildPassed: true,
  nativeTestsPassed: true,
  browserE2ePassed: true,
  accessibilityPassed: true,
  extractedPackagePassed: true,
  durableRestartPassed: true,
  approvalRestartPassed: true,
  tenantIsolationPassed: true,
  backupRestorePassed: true,
  criticalSecurityPassed: true,
  openCriticalFindings: 0,
};

describe("pilot readiness", () => {
  it("remains development-only when release evidence is unknown", () => {
    const result = evaluatePilotReadiness(healthyMetrics);
    expect(result.classification).toBe("DEVELOPMENT ONLY");
    expect(result.gates.some((gate) => gate.state === "unknown")).toBe(true);
  });

  it("blocks on reconciliation debt even when release evidence passes", () => {
    const metrics = computeOperationalMetrics({
      runs: [], approvalStatuses: [], outboxStatuses: [],
      durableJobStatuses: ["needs_reconciliation"],
    });
    const result = evaluatePilotReadiness(metrics, allReleaseFacts);
    expect(result.classification).toBe("DEVELOPMENT ONLY");
    expect(result.gates.find((gate) => gate.id === "runtime_reconciliation")?.state).toBe("block");
  });

  it("allows controlled pilot classification only when all hard evidence is present", () => {
    const result = evaluatePilotReadiness(healthyMetrics, allReleaseFacts);
    expect(result.classification).toBe("CONTROLLED INTERNAL PILOT");
    expect(result.blockers).toBe(0);
    expect(result.score).toBe(100);
  });
});
