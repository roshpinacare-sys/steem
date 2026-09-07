/**
 * tests/adapter/agent-provenance.test.ts — v312.
 * Vendor-neutral agent provenance — the cross-vendor audit-trail wedge.
 *
 *   NORMALIZE   vendor aliases (grok→xai, claude→anthropic, copilot→github...) map correctly.
 *   FINGERPRINT same identity → identical provenanceId; any field change → different id.
 *   PRESERVE    unknown vendor → "custom" but vendorRaw kept (no information loss).
 *   FAIL-CLOSED missing vendor/agentId throws.
 */
import { test, assert, eq } from "../_harness.mjs";
import { normalizeAgentProvenance, normalizeVendor, sameAgent, ProvenanceError } from "../../lib/adapter/agent-provenance.ts";

test("normalizes vendor aliases across the major AI players", () => {
  eq(normalizeVendor("Grok"), "xai");
  eq(normalizeVendor("Cursor"), "cursor");
  eq(normalizeVendor("Claude Code"), "anthropic");
  eq(normalizeVendor("GitHub Copilot"), "github");
  eq(normalizeVendor("ChatGPT"), "openai");
  eq(normalizeVendor("Bedrock AgentCore"), "aws");
  eq(normalizeVendor("openai gpt-5"), "openai", "falls back to head token");
});

test("fingerprint is deterministic and identity-specific", () => {
  const a = normalizeAgentProvenance({ vendor: "xAI", agentId: "agent-7", product: "cursor", model: "grok-build-1" });
  const b = normalizeAgentProvenance({ vendor: "xAI", agentId: "agent-7", product: "cursor", model: "grok-build-1" });
  eq(a.provenanceId, b.provenanceId, "same identity → same fingerprint");
  assert(sameAgent(a, b), "sameAgent true");
  const c = normalizeAgentProvenance({ vendor: "xAI", agentId: "agent-8", product: "cursor", model: "grok-build-1" });
  assert(!sameAgent(a, c), "different agentId → different fingerprint");
  eq(a.vendor, "xai");
});

test("cross-vendor: same enterprise, different vendors → distinct, both normalized", () => {
  const x = normalizeAgentProvenance({ vendor: "xAI", agentId: "a1" });
  const o = normalizeAgentProvenance({ vendor: "OpenAI", agentId: "a1" });
  const an = normalizeAgentProvenance({ vendor: "Anthropic", agentId: "a1" });
  eq(x.vendor, "xai"); eq(o.vendor, "openai"); eq(an.vendor, "anthropic");
  assert(!sameAgent(x, o) && !sameAgent(o, an), "same agentId across vendors stays distinct");
});

test("preserve: unknown vendor → custom but keeps the raw label", () => {
  const p = normalizeAgentProvenance({ vendor: "AcmeBot-9000", agentId: "a1" });
  eq(p.vendor, "custom");
  eq(p.vendorRaw, "AcmeBot-9000", "raw label preserved for audit");
});

test("fail-closed: missing vendor or agentId throws", () => {
  for (const bad of [{ vendor: "", agentId: "a1" }, { vendor: "xai", agentId: "" }, { agentId: "a1" } as any, null as any]) {
    let threw = false;
    try { normalizeAgentProvenance(bad); } catch (e) { threw = e instanceof ProvenanceError || e instanceof Error; }
    assert(threw, `bad input ${JSON.stringify(bad)} throws`);
  }
});
