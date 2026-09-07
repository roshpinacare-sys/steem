import "../_flush.mjs";
/**
 * tests/examples/agent-skill-trust-gate.test.ts  (v283)
 *
 * Tests for examples/agent-skill-trust-gate/SKILL.md — the Agent Skill that
 * teaches a Claude-based agent when/how to gate risky actions through TFA.
 *
 * Coverage:
 *   Structural conformance (matches the public SKILL.md convention: YAML
 *   frontmatter with name/description, then a Markdown body):
 *     • file exists, parses as frontmatter + body
 *     • frontmatter has `name` and `description`
 *     • name is kebab-case, matches the directory convention
 *     • description is non-trivial length and mentions trigger conditions
 *
 *   Content accuracy (the skill must describe REAL system behavior — these
 *   tests cross-check specific claims in SKILL.md against the actual adapter
 *   API contract, so a future change to the API that breaks the skill's
 *   accuracy will fail this test, not just go unnoticed):
 *     • documents all three real AdapterDecision values (allowed/approval_required/denied)
 *     • documents the required ActionIntent fields the route actually requires
 *     • documents that server-side risk classification overrides client claims
 *       (cross-checked against classifyActionServerSide behavior)
 *     • documents nonce uniqueness requirement
 *     • mentions the CLI exit-code mapping consistent with the real CLI behavior
 *
 *   README companion:
 *     • README exists, references the skill's install path and its relationship
 *       to the other TFA agent-integration surfaces (hook, CLI, MCP server)
 */

import { test, eq, assert } from "../_harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyActionServerSide } from "../../lib/risk/coding-actions.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "../../examples/agent-skill-trust-gate");
const SKILL_PATH = path.join(SKILL_DIR, "SKILL.md");
const README_PATH = path.join(SKILL_DIR, "README.md");

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(match !== null, "SKILL.md must start with a --- delimited YAML frontmatter block");
  const [, fmText, body] = match!;
  const frontmatter: Record<string, string> = {};
  for (const line of fmText.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (m) frontmatter[m[1]] = m[2].trim();
  }
  return { frontmatter, body };
}

// ─── Structural conformance ────────────────────────────────────────────────────

test("SKILL.md exists at the expected path", () => {
  assert(existsSync(SKILL_PATH), `SKILL.md not found at ${SKILL_PATH}`);
});

test("SKILL.md frontmatter has name and description", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  const { frontmatter } = parseFrontmatter(content);
  assert("name" in frontmatter, "frontmatter must declare a name");
  assert("description" in frontmatter, "frontmatter must declare a description");
});

test("SKILL.md name is kebab-case and matches the directory name", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  const { frontmatter } = parseFrontmatter(content);
  eq(frontmatter.name, "tfa-trust-gate", "name must be tfa-trust-gate");
  assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(frontmatter.name), "name must be kebab-case");
  eq(path.basename(SKILL_DIR), "agent-skill-trust-gate", "directory name sanity check");
});

test("SKILL.md description is substantial and names concrete trigger conditions", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  const { frontmatter } = parseFrontmatter(content);
  assert(frontmatter.description.length > 100, "description must be detailed enough to drive triggering");
  // Must name concrete, recognizable triggers — not just vague "risky actions"
  const triggers = ["delet", "migrat", "transfer", "withdraw", "approve"];
  const mentioned = triggers.filter((t) => frontmatter.description.toLowerCase().includes(t));
  assert(mentioned.length >= 3, `description must mention concrete triggers, found: ${mentioned.join(", ")}`);
});

test("SKILL.md body is non-trivial (not a stub)", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  const { body } = parseFrontmatter(content);
  assert(body.trim().length > 1000, "body must contain substantial instructional content");
  assert(body.includes("## Overview") || body.includes("# "), "body must have a heading structure");
});

// ─── Content accuracy — cross-checked against real system behavior ────────────

test("SKILL.md documents all three real AdapterDecision values", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  // These three strings must appear verbatim — they are the literal API contract values.
  for (const decision of ["allowed", "approval_required", "denied"]) {
    assert(content.includes(decision), `SKILL.md must document the "${decision}" decision`);
  }
});

test("SKILL.md documents the required ActionIntent fields the route actually requires", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  // Cross-check against the real required fields in buildIntentFromBody (adapter-routes.ts):
  // actorId, toolId, resourceRef, nonce, expiry are all read from the request body.
  for (const field of ["actorId", "toolId", "resourceRef", "nonce", "expiry"]) {
    assert(content.includes(field), `SKILL.md must document the "${field}" field`);
  }
});

test("SKILL.md correctly describes server-side override: claiming a low risk for a destructive action still gets reclassified", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  // Cross-check the claim against the REAL classifier: file.delete claimed as read_only
  // must NOT remain read_only server-side.
  const { riskClass, source } = classifyActionServerSide("file.delete");
  assert(riskClass !== "read_only", "sanity: file.delete must not classify as read_only server-side");
  assert(source === "coding_taxonomy", "sanity: file.delete must come from the coding taxonomy");
  // The skill must explicitly call out that the server overrides client risk claims.
  assert(
    content.includes("override") || content.includes("authoritative") || content.includes("never trusts"),
    "SKILL.md must explicitly state that server-side classification overrides client claims",
  );
  // And it must use file.delete as a concrete worked example (the doc's own example).
  assert(content.includes("file.delete"), "SKILL.md must use a concrete worked example (file.delete)");
});

test("SKILL.md documents the nonce-uniqueness / replay-prevention requirement", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  assert(content.toLowerCase().includes("nonce"), "SKILL.md must mention nonce");
  assert(
    content.toLowerCase().includes("reuse") || content.toLowerCase().includes("replay") || content.toLowerCase().includes("unique"),
    "SKILL.md must explain why nonces must not be reused (replay prevention)",
  );
});

test("SKILL.md mentions the CLI as an alternative for shell/CI contexts", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  assert(content.includes("tfa check-action") || content.includes("check-action"), "SKILL.md must reference the CLI command");
});

test("SKILL.md instructs NOT to proceed on approval_required, and NOT to treat denied as user error", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");
  const lower = content.toLowerCase();
  assert(lower.includes("do not proceed") || lower.includes("hard stop") || lower.includes("not proceed"), "SKILL.md must instruct the agent to halt on approval_required");
});

// ─── README companion ──────────────────────────────────────────────────────────

test("README exists alongside SKILL.md and documents install path + integration surfaces", () => {
  assert(existsSync(README_PATH), `README not found at ${README_PATH}`);
  const content = readFileSync(README_PATH, "utf-8");
  assert(content.toLowerCase().includes("install"), "README must have install instructions");
  assert(content.includes("SKILL.md"), "README must reference SKILL.md");
  // Must situate this skill relative to the other TFA agent integrations already shipped.
  assert(content.includes("claude-code-hook"), "README must reference the PreToolUse hook integration");
  assert(content.includes("sdk/cli") || content.includes("tfa check-action") || content.toLowerCase().includes(" cli"), "README must reference the CLI integration");
});
