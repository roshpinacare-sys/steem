/**
 * red-team.ts — J2: Adversarial pre-gate agent.
 *
 * Before the gate phase, a lightweight adversarial pass asks: "How could this
 * patch fail in a way nobody asked about?"  This is structurally different
 * from the Reviewer (which checks "does this do what was asked?").
 *
 * The Red-Team agent:
 *   1. Prompts a cheap/fast LLM tier with the diff + objective.
 *   2. Asks for a numbered list of failure scenarios NOT covered by the diff.
 *   3. Returns a structured result the gate can use as an advisory signal.
 *
 * DESIGN INVARIANTS
 * - Never throws; returns a safe default on any error.
 * - Uses the FAST (cheap) LLM tier — never heavy.
 * - Privacy mode: skips external LLM call, returns empty findings.
 * - Advisory only; does NOT block the gate by itself (callers decide weight).
 */

import { aiRoute } from "./ai-router.js";
import type { Telemetry } from "./telemetry.js";
import { log } from "./logger.js";
import type { RouterEnv } from "./ai-router.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedTeamFinding {
  /** Short description of the failure scenario. */
  scenario: string;
  /** Estimated severity: low / medium / high */
  severity: "low" | "medium" | "high";
}

export interface RedTeamResult {
  /** Whether any high-severity findings were produced. */
  hasHighSeverity: boolean;
  findings: RedTeamFinding[];
  /** Raw LLM response text (for audit / rationale bank). */
  rawResponse: string;
}

const EMPTY_RESULT: RedTeamResult = {
  hasHighSeverity: false,
  findings: [],
  rawResponse: "",
};

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(objective: string, diff: string): string {
  const truncatedDiff = diff.slice(0, 6000);
  return `You are a RED TEAM security and reliability analyst. Your job is to find ways the following code change could FAIL or cause HARM that the developer did not intend and that no existing test would catch.

## Objective
${objective}

## Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

Respond with a JSON object matching this exact schema:
{
  "findings": [
    { "scenario": "string — one sentence describing the failure mode", "severity": "low" | "medium" | "high" }
  ]
}

Rules:
- List only genuinely plausible failure scenarios.
- Do NOT repeat issues that are obviously already tested.
- Limit to at most 5 findings.
- If no plausible failures exist, return { "findings": [] }.
- Respond with ONLY the JSON object, no prose.`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseResponse(raw: string): RedTeamFinding[] {
  try {
    const json = JSON.parse(raw) as { findings?: unknown[] };
    if (!Array.isArray(json.findings)) return [];
    return json.findings
      .filter(
        (f): f is { scenario: string; severity: string } =>
          typeof f === "object" &&
          f !== null &&
          typeof (f as Record<string, unknown>).scenario === "string" &&
          typeof (f as Record<string, unknown>).severity === "string",
      )
      .map((f) => ({
        scenario: f.scenario,
        severity: (["low", "medium", "high"].includes(f.severity) ? f.severity : "low") as RedTeamFinding["severity"],
      }));
  } catch (e: unknown) {
    log.warn("red-team: adversarial pass failed; continuing without findings", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the adversarial Red-Team pass on a patch before the gate.
 *
 * @param objective  The original mission objective.
 * @param diff       The generated patch diff.
 * @param env        Router environment (LLM keys).
 * @param telemetry  Optional telemetry service.
 * @returns          A structured list of potential failure scenarios.
 */
export async function runRedTeam(
  objective: string,
  diff: string,
  env: RouterEnv,
  telemetry?: Telemetry,
): Promise<RedTeamResult> {
  if (process.env.QODO_PRIVACY_MODE === "strict") {
    await telemetry?.decision("red-team", "skipped-privacy-mode", {});
    return EMPTY_RESULT;
  }

  const prompt = buildPrompt(objective, diff);

  let rawResponse = "";
  try {
    rawResponse = await aiRoute(
      "red-team-pass",
      "fast", // Always use the cheap tier — adversarial prompt is cheap/simple
      prompt,
      { telemetry, env },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("red-team: LLM call failed; skipping adversarial pass", { error: msg });
    await telemetry?.decision("red-team", "llm-error", { error: msg });
    return EMPTY_RESULT;
  }

  const findings = parseResponse(rawResponse);
  const hasHighSeverity = findings.some((f) => f.severity === "high");

  await telemetry?.decision("red-team", "findings", {
    count: findings.length,
    hasHighSeverity,
    severities: findings.map((f) => f.severity),
  });

  if (findings.length > 0) {
    log.info("red-team: adversarial findings", {
      count: findings.length,
      hasHighSeverity,
      scenarios: findings.map((f) => f.scenario),
    });
  }

  return { hasHighSeverity, findings, rawResponse };
}
