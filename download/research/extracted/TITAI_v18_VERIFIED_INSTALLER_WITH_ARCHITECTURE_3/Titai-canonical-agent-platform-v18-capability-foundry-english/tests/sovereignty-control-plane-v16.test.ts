import { describe, expect, it } from "vitest";
import { createSovereigntyControlPlaneSnapshot } from "@/lib/sovereignty/control-plane";

describe("v16 sovereignty control plane", () => {
  it("keeps unavailable operational evidence blocking by default", () => {
    const snapshot = createSovereigntyControlPlaneSnapshot();
    expect(snapshot.readiness.realLocalModelBenchmark).toBe("block");
    expect(snapshot.readiness.browserAccessibility).toBe("block");
    expect(snapshot.readiness.hardwareEnergyMeasurement).toBe("block");
    expect(snapshot.blockers).toContain("real_local_model_not_executed");
  });

  it("recognizes implemented offline and isolated execution evidence", () => {
    const snapshot = createSovereigntyControlPlaneSnapshot();
    expect(snapshot.readiness.realMigrationRehearsal).toBe("pass");
    expect(snapshot.readiness.localRetrievalFallback).toBe("pass");
    expect(snapshot.readiness.portableKeyCustody).toBe("pass");
    expect(snapshot.readiness.multiNodeExecution).toBe("block");
    expect(snapshot.readiness.fullSuiteCleanExit).toBe("pass");
  });

  it("does not promote unknown evidence to pass", () => {
    const snapshot = createSovereigntyControlPlaneSnapshot({ evidence: { zeroKeyWorkflow: true } });
    expect(snapshot.readiness.zeroKeyWorkflow).toBe("pass");
    expect(snapshot.readiness.realLocalModelBenchmark).toBe("unknown");
    expect(snapshot.assessment.evidenceUnknown).toContain("realLocalModelBenchmark");
  });
});
