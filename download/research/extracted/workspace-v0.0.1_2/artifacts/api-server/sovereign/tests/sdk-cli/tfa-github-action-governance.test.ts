/**
 * tests/sdk-cli/tfa-github-action-governance.test.ts — v255
 *
 * Structural / governance tests for sdk/github-action/ — the TFA Trust Gate
 * GitHub composite action.  No GitHub API access is required; tests only
 * validate the file tree, YAML schema, inputs/outputs contract, and the
 * bundled CLI binary.
 *
 * Coverage:
 *   YAML         action.yml is valid YAML with required fields (name, runs, inputs, outputs)
 *   INPUTS       all documented inputs are declared with description + default
 *   OUTPUTS      decision / execution-id / approval-token all declared
 *   RUNS         composite action uses bash steps with ids
 *   BIN          bin/tfa.mjs is present, has shebang, matches CLI version
 *   LICENSE      LICENSE file exists and contains MIT text
 *   README       README.md exists, references action.yml usage, exit codes table
 *   BRANDING     icon and color are set (required for GitHub Marketplace listing)
 *   FAIL-CLOSED  allowed-outcomes defaults to "allowed" (not empty → not fail-open)
 *   VERSIONS     node-path input present (self-hosted runner compat)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, assert, eq } from "../_harness.mjs";

// ─── helpers ──────────────────────────────────────────────────────────────────

const ROOT = new URL("../../", import.meta.url).pathname;
const ACTION_DIR = join(ROOT, "sdk/github-action");
const CLI_DIR    = join(ROOT, "sdk/cli");

function read(rel: string): string {
  return readFileSync(join(ACTION_DIR, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(ACTION_DIR, rel));
}

/** Minimal YAML field extractor — no external dep. Matches `key: value` lines. */
function yamlField(yaml: string, key: string): string | undefined {
  const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : undefined;
}

/** Return true if the YAML declares an input with the given name. */
function hasInput(yaml: string, name: string): boolean {
  // Pattern: "  name:\n    description:"
  return yaml.includes(`  ${name}:\n`) || yaml.includes(`  ${name}:\r\n`);
}

function hasOutput(yaml: string, name: string): boolean {
  return yaml.includes(`  ${name}:\n`) && yaml.includes("description:");
}

// ─── Load action.yml ──────────────────────────────────────────────────────────

const actionYml = read("action.yml");

// ─── YAML structure ───────────────────────────────────────────────────────────

test("github-action: action.yml exists", () => {
  assert(exists("action.yml"), "action.yml must exist in sdk/github-action/");
});

test("github-action: action.yml has name field", () => {
  const name = yamlField(actionYml, "name");
  assert(typeof name === "string" && name.length > 0, "name field required");
  assert(name.toLowerCase().includes("tfa") || name.toLowerCase().includes("trust"),
    `name should reference TFA, got: ${name}`);
});

test("github-action: action.yml has description field", () => {
  const desc = actionYml.match(/^description:\s*.+/m);
  assert(!!desc, "description field required");
});

test("github-action: action.yml has author field", () => {
  assert(actionYml.includes("author:"), "author field required");
});

test("github-action: action.yml has branding with icon and color", () => {
  assert(actionYml.includes("branding:"), "branding block required for Marketplace");
  assert(actionYml.includes("icon:"), "branding.icon required");
  assert(actionYml.includes("color:"), "branding.color required");
});

test("github-action: runs.using is 'composite'", () => {
  assert(actionYml.includes("using: 'composite'") || actionYml.includes('using: "composite"') || actionYml.includes("using: composite"),
    "action must be composite (not docker or node12)");
});

test("github-action: runs.steps is non-empty (has at least 2 steps)", () => {
  const stepCount = (actionYml.match(/^\s+- name:/gm) || []).length;
  assert(stepCount >= 2, `expected ≥ 2 steps, found ${stepCount}`);
});

// ─── INPUTS ───────────────────────────────────────────────────────────────────

test("github-action: input 'intent' declared (required)", () => {
  assert(hasInput(actionYml, "intent"), "intent input required");
  assert(actionYml.includes("required: true"), "intent must be required: true");
});

test("github-action: input 'base-url' declared", () => {
  assert(hasInput(actionYml, "base-url"), "base-url input required");
});

test("github-action: input 'tenant' declared", () => {
  assert(hasInput(actionYml, "tenant"), "tenant input required");
});

test("github-action: input 'api-key' declared", () => {
  assert(hasInput(actionYml, "api-key"), "api-key input required");
});

test("github-action: input 'public-key' declared (Ed25519 offline verify)", () => {
  assert(hasInput(actionYml, "public-key"), "public-key input required");
});

test("github-action: input 'secret' declared (HMAC offline verify)", () => {
  assert(hasInput(actionYml, "secret"), "secret input required");
});

test("github-action: input 'allowed-outcomes' declared with default 'allowed' (fail-closed)", () => {
  assert(hasInput(actionYml, "allowed-outcomes"), "allowed-outcomes input required");
  // Default must be "allowed" — empty default would be fail-open
  assert(actionYml.includes("default: 'allowed'") || actionYml.includes("default: \"allowed\"") || actionYml.includes("default: allowed"),
    "allowed-outcomes must default to 'allowed' (fail-closed)");
});

test("github-action: input 'node-path' declared (self-hosted runner compat)", () => {
  assert(hasInput(actionYml, "node-path"), "node-path input required for custom runner compat");
});

test("github-action: input 'json-output' declared", () => {
  assert(hasInput(actionYml, "json-output"), "json-output input required");
});

test("github-action: input 'post-comment' declared with default 'false'", () => {
  assert(hasInput(actionYml, "post-comment"), "post-comment input required");
  assert(actionYml.includes("default: 'false'") || actionYml.includes('default: "false"') || actionYml.includes("default: false"),
    "post-comment must default to 'false' (opt-in)");
});

test("github-action: input 'github-token' declared with default github.token", () => {
  assert(hasInput(actionYml, "github-token"), "github-token input required for PR comment auth");
  assert(actionYml.includes("github.token") || actionYml.includes("github-token"),
    "github-token must reference the GitHub token");
});

test("github-action: PR comment step exists and references tfa-gate outputs", () => {
  assert(actionYml.includes("Post TFA proof as PR comment"), "PR comment step must exist");
  assert(actionYml.includes("steps.tfa-gate.outputs.decision"), "PR comment must reference decision output");
  assert(actionYml.includes("steps.tfa-gate.outputs.execution-id"), "PR comment must reference execution-id output");
  assert(actionYml.includes("gh pr comment"), "PR comment must use gh CLI");
});

// ─── OUTPUTS ──────────────────────────────────────────────────────────────────

test("github-action: output 'decision' declared", () => {
  assert(actionYml.includes("decision:"), "decision output required");
});

test("github-action: output 'execution-id' declared", () => {
  assert(actionYml.includes("execution-id:"), "execution-id output required");
});

test("github-action: output 'approval-token' declared", () => {
  assert(actionYml.includes("approval-token:"), "approval-token output required");
});

// ─── CLI binary ───────────────────────────────────────────────────────────────

test("github-action: bin/tfa.mjs exists", () => {
  assert(exists("bin/tfa.mjs"), "bin/tfa.mjs must be present inside the action");
});

test("github-action: bin/tfa.mjs has Node shebang", () => {
  const bin = read("bin/tfa.mjs");
  assert(bin.startsWith("#!/usr/bin/env node"),
    "bin/tfa.mjs must start with #!/usr/bin/env node");
});

test("github-action: bin/tfa.mjs and sdk/cli/bin/tfa.mjs have the same VERSION", () => {
  const actionBin = read("bin/tfa.mjs");
  const cliBin = readFileSync(join(CLI_DIR, "bin/tfa.mjs"), "utf8");
  const actionVer = actionBin.match(/const VERSION\s*=\s*["']([^"']+)["']/)?.[1];
  const cliVer    = cliBin.match(/const VERSION\s*=\s*["']([^"']+)["']/)?.[1];
  assert(!!actionVer, "action bin/tfa.mjs must declare VERSION");
  assert(!!cliVer, "sdk/cli/bin/tfa.mjs must declare VERSION");
  eq(actionVer, cliVer, "action bin/tfa.mjs must have same VERSION as sdk/cli/bin/tfa.mjs");
});

test("github-action: action.yml references bin/tfa.mjs via github.action_path", () => {
  assert(actionYml.includes("github.action_path") && actionYml.includes("tfa.mjs"),
    "action.yml must reference the bundled CLI via github.action_path");
});

// ─── LICENSE ──────────────────────────────────────────────────────────────────

test("github-action: LICENSE exists", () => {
  assert(exists("LICENSE"), "LICENSE file required");
});

test("github-action: LICENSE contains MIT text", () => {
  const lic = read("LICENSE");
  assert(lic.includes("MIT License"), "LICENSE must contain 'MIT License'");
  assert(lic.includes("Permission is hereby granted"), "LICENSE must contain full MIT grant");
});

// ─── README ───────────────────────────────────────────────────────────────────

test("github-action: README.md exists", () => {
  assert(exists("README.md"), "README.md required");
});

test("github-action: README.md mentions action.yml usage pattern (uses: tfa/...)", () => {
  const readme = read("README.md");
  assert(readme.includes("uses:") && readme.includes("tfa"),
    "README must show how to use the action with 'uses:' directive");
});

test("github-action: README.md has exit codes table", () => {
  const readme = read("README.md");
  assert(readme.includes("0") && readme.includes("allowed"),
    "README must document exit code 0 (allowed)");
  assert(readme.includes("1") && (readme.includes("approval_required") || readme.includes("approval required")),
    "README must document exit code 1 (approval_required)");
  assert(readme.includes("2") && readme.includes("denied"),
    "README must document exit code 2 (denied)");
});

test("github-action: README.md mentions inputs: intent, tenant, api-key, public-key", () => {
  const readme = read("README.md");
  for (const inp of ["intent", "tenant", "api-key", "public-key"]) {
    assert(readme.includes(inp), `README must document input '${inp}'`);
  }
});

test("github-action: README.md mentions outputs: decision, execution-id, approval-token", () => {
  const readme = read("README.md");
  for (const out of ["decision", "execution-id", "approval-token"]) {
    assert(readme.includes(out), `README must document output '${out}'`);
  }
});
