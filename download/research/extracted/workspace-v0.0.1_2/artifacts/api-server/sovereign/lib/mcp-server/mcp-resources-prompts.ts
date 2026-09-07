/**
 * lib/mcp-server/mcp-resources-prompts.ts — MCP resources and prompts for TFA.
 *
 * Resources expose TFA's trust artifacts as readable URIs so AI assistants
 * can retrieve live state without using tools:
 *
 *   tfa://receipt/{executionId}        — ExecutionReceipt by id
 *   tfa://passport/{auditId}           — ActionPassport by auditId
 *   tfa://track-record/{tenantId}      — TrackRecord aggregate for a tenant
 *   tfa://gate-flow/overview           — Static description of TFA gate flow
 *
 * Prompts provide reusable instruction templates for common TFA interactions:
 *
 *   tfa_gate_flow          — Walk the agent through submitting an action to TFA
 *   tfa_audit_review       — Ask TFA to review a recent audit chain
 *   tfa_risk_assessment    — Ask TFA to assess risk before a tool call
 *
 * All resource reads are fail-closed: unknown URI → error, missing data → error.
 * No tenantId auth is enforced here — the TfaMcpServer's caller is responsible
 * for passing the correct tenantId in request params.
 *
 * Zero external dependencies.
 */

// ── MCP primitive types ───────────────────────────────────────────────────────

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

// ── Static resource catalog ───────────────────────────────────────────────────

/** Well-known TFA resource URI prefixes. */
export const TFA_RESOURCE_PREFIXES = {
  receipt:     "tfa://receipt/",
  passport:    "tfa://passport/",
  trackRecord: "tfa://track-record/",
  gateFlow:    "tfa://gate-flow/",
} as const;

/** All static resources (those that don't require a dynamic id). */
export const STATIC_RESOURCES: McpResource[] = [
  {
    uri: "tfa://gate-flow/overview",
    name: "TFA Gate Flow Overview",
    description: "Describes TFA's trust gate pipeline: intent → risk classification → policy → decision → proof. Read this before submitting any action through TFA.",
    mimeType: "text/plain",
  },
  {
    uri: "tfa://gate-flow/risk-classes",
    name: "TFA Risk Classification Taxonomy",
    description: "The 7 canonical ActionRiskClass values (read_only, write_safe, write_destructive, value_moving, irreversible, privacy_sensitive, regulated) with their approval policies.",
    mimeType: "text/plain",
  },
];

// ── Static resource content ───────────────────────────────────────────────────

const GATE_FLOW_OVERVIEW = `
TFA Trust Gate — Pipeline Overview
===================================

TFA (Trust Control Plane) is a server-side gate that every AI agent action
must pass through before execution. It:

1. RECEIVES an ActionIntent from your agent (tenantId, actorId, toolId,
   resourceRef, riskClass, valueMicrounits, nonce, expiry).

2. CLASSIFIES risk server-side using a taxonomy of 7 ActionRiskClass values.
   The client-supplied riskClass is an ADVISORY input; TFA overrides it if
   its server-side classifier disagrees. Fail-closed: unknown action → irreversible.

3. EVALUATES policies: approvalPolicyRouter → ConfidenceGate → custom policies.
   Decision: "allowed" | "approval_required" | "denied".

4. RETURNS an ExecutionReceipt with:
   - decision: "allowed" | "approval_required" | "denied"
   - decisionTrace: signed JSON (tamper-evident)
   - executionId: workflow id (for long-running actions)
   - kid: signing key id (for portable verification via /api/keys/{kid})

5. If "allowed": action runs and an ActionPassport is issued (tamper-evident proof).
   If "approval_required": escalate to human/threshold approval.
   If "denied": stop — do not execute.

Key invariants:
  • NEVER execute a denied action — the receipt is your evidence.
  • ALWAYS pass the receipt's kid + signature to downstream verifiers.
  • Use /api/keys/{kid} to retrieve the public key for offline verification.

API endpoint: POST /api/adapter/run
`.trim();

const GATE_FLOW_RISK_CLASSES = `
TFA ActionRiskClass Taxonomy
=============================

risk_class        approval_policy    description
-----------       ---------------    -----------
read_only         auto               No state change. Safe for auto-approval.
write_safe        auto               Reversible write. Low blast radius.
write_destructive human              Hard-to-reverse write. Requires human sign-off.
value_moving      threshold_escrow   Financial: moves money. Requires escrow + approval.
irreversible      deny               Permanent destructive change. Denied by default.
privacy_sensitive human              Accesses/modifies PII or sensitive data.
regulated         human              Subject to compliance rules. Manual review.

Note: TFA classifies risk SERVER-SIDE. Your agent supplies riskClass as a hint
but TFA's classifier (coding taxonomy + general taxonomy) can override it.
Fail-closed: unmapped actions default to "irreversible" → "deny".
`.trim();

/** Read content for a static TFA resource URI. */
export function readStaticResource(uri: string): McpResourceContent | null {
  switch (uri) {
    case "tfa://gate-flow/overview":
      return { uri, mimeType: "text/plain", text: GATE_FLOW_OVERVIEW };
    case "tfa://gate-flow/risk-classes":
      return { uri, mimeType: "text/plain", text: GATE_FLOW_RISK_CLASSES };
    default:
      return null;
  }
}

// ── Dynamic resource content ──────────────────────────────────────────────────

/** Parse a tfa:// URI into its scheme parts. */
export function parseTfaUri(uri: string): { kind: string; id: string } | null {
  if (!uri.startsWith("tfa://")) return null;
  const rest = uri.slice(6); // strip "tfa://"
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const kind = rest.slice(0, slash);
  const id = rest.slice(slash + 1);
  if (!kind || !id) return null;
  return { kind, id };
}

/** Format an ExecutionReceipt (from any store) as readable resource text. */
export function formatReceiptResource(uri: string, receipt: Record<string, unknown>): McpResourceContent {
  const lines = [
    "TFA ExecutionReceipt",
    "====================",
    `URI:         ${uri}`,
    `executionId: ${receipt.executionId ?? receipt.id ?? "(none)"}`,
    `decision:    ${receipt.decision ?? "(unknown)"}`,
    `tenantId:    ${receipt.tenantId ?? "(unknown)"}`,
    `actorId:     ${receipt.actorId ?? "(unknown)"}`,
    `toolId:      ${receipt.toolId ?? "(unknown)"}`,
    `issuedAt:    ${receipt.issuedAt ?? "(unknown)"}`,
    `kid:         ${receipt.kid ?? "(none — verify via hmac)"}`,
  ];
  if (receipt.decisionTrace) {
    lines.push(`\ndecisionTrace (first 200 chars):\n  ${String(receipt.decisionTrace).slice(0, 200)}`);
  }
  return { uri, mimeType: "text/plain", text: lines.join("\n") };
}

/** Format an ActionPassport as readable resource text. */
export function formatPassportResource(uri: string, passport: Record<string, unknown>): McpResourceContent {
  const lines = [
    "TFA ActionPassport",
    "==================",
    `URI:         ${uri}`,
    `auditId:     ${(passport.audit as any)?.id ?? passport.auditId ?? "(none)"}`,
    `tenantId:    ${(passport.audit as any)?.tenantId ?? "(unknown)"}`,
    `toolId:      ${(passport.audit as any)?.toolId ?? passport.toolId ?? "(unknown)"}`,
    `decision:    ${(passport.audit as any)?.decision ?? "(unknown)"}`,
    `issuedAt:    ${passport.issuedAt ?? "(unknown)"}`,
    `kid:         ${passport.kid ?? "(none)"}`,
    `hash:        ${passport.hash ?? "(none)"}`,
    "",
    "This passport is a tamper-evident proof of the action's gate result.",
    "Verify offline: node scripts/verify-passport.mjs <passport-json>",
  ];
  return { uri, mimeType: "text/plain", text: lines.join("\n") };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export const TFA_PROMPTS: McpPrompt[] = [
  {
    name: "tfa_gate_flow",
    description: "Walk through submitting an action to TFA and interpreting the response. Use this before calling tfa_check_action or tfa_request_action.",
    arguments: [
      { name: "toolId", description: "The tool/action you want to run (e.g. 'file.write', 'db.migrate')", required: true },
      { name: "resourceRef", description: "The resource to be acted upon", required: false },
    ],
  },
  {
    name: "tfa_audit_review",
    description: "Review TFA's audit chain for a tenant to understand what actions were taken, approved, or denied.",
    arguments: [
      { name: "tenantId", description: "Tenant whose audit chain to review", required: true },
    ],
  },
  {
    name: "tfa_risk_assessment",
    description: "Ask TFA to assess the risk of a proposed action before committing to it.",
    arguments: [
      { name: "toolId", description: "Tool/action being assessed", required: true },
      { name: "valueMicrounits", description: "Monetary value in micro-cents (0 for non-financial)", required: false },
    ],
  },
];

/** Generate a rendered prompt message for a given prompt name + args. */
export function renderPrompt(
  name: string,
  args: Record<string, string>,
): McpPromptMessage[] | null {
  switch (name) {
    case "tfa_gate_flow": {
      const toolId = args.toolId ?? "(tool not specified)";
      const resourceRef = args.resourceRef ?? "(no resource specified)";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to run the action "${toolId}" on resource "${resourceRef}".

Before executing, please:
1. Call tfa_check_action to assess risk (simulate without side effects).
2. If the simulated decision is "denied", explain why and stop.
3. If "approval_required", ask me to confirm before proceeding.
4. If "allowed", call tfa_request_action to submit to TFA.
5. Show me the ExecutionReceipt (decision, decisionTrace, kid).
6. If approved, proceed with the actual tool call.

Always show the TFA decision before taking any action.`,
          },
        },
      ];
    }
    case "tfa_audit_review": {
      const tenantId = args.tenantId ?? "(tenant not specified)";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please review the TFA audit chain for tenant "${tenantId}".

1. Call GET /api/audit/events?tenantId=${tenantId} (or tfa_get_audit_chain if available).
2. Summarise the last 10 actions: toolId, decision (allowed/denied/approval_required), issuedAt.
3. Highlight any "denied" or "approval_required" events and explain what policy triggered them.
4. Check for any anomalies: repeated denials, unusual value_moving operations, irreversible actions.
5. Report the audit chain length and the latest hash for tamper-evidence.`,
          },
        },
      ];
    }
    case "tfa_risk_assessment": {
      const toolId = args.toolId ?? "(tool not specified)";
      const value = args.valueMicrounits ?? "0";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Risk assessment request for action "${toolId}" (valueMicrounits=${value}).

1. Call tfa_check_action with toolId="${toolId}" and valueMicrounits=${value}.
2. Report the simulated riskClass (server-assigned, not client-supplied).
3. Report the approval_policy that would apply (auto/human/threshold_escrow/deny).
4. If riskClass is "write_destructive", "irreversible", or "value_moving" — highlight the risk clearly.
5. Recommend: proceed / escalate to human / do not proceed.`,
          },
        },
      ];
    }
    default:
      return null;
  }
}
