import { describe, expect, it } from "vitest";
import { SovereignNetworkGuard, evaluateNetworkRequest } from "@/lib/sovereignty/network-policy";

describe("sovereign network policy", () => {
  it("blocks remote traffic in air-gap mode and records the attempt", () => {
    const guard = new SovereignNetworkGuard("air_gapped");
    expect(() => guard.authorize({ url: "https://api.example.com/v1", actor: "agent-a" })).toThrow("network_blocked_air_gap");
    const evidence = guard.getEvidence();
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.allowed).toBe(false);
  });

  it("allows an explicitly approved localhost endpoint only", () => {
    expect(evaluateNetworkRequest({ mode: "air_gapped", url: "http://127.0.0.1:11434", actor: "local-model", allowLocalhost: true }).allowed).toBe(true);
    expect(evaluateNetworkRequest({ mode: "local_only", url: "https://example.com", actor: "agent" }).allowed).toBe(false);
  });
});
