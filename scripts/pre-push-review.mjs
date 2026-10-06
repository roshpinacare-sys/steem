#!/usr/bin/env node
// pre-push-review.mjs — sovereign review gate (r167, pattern from vercel-labs/openreview)
//
// Reviews the pending git diff through OUR OWN llm-bridge (port 3048, z-ai backend),
// using the openreview skills pattern: skill INDEX (name+description) is shown to the
// model first; full skill bodies are loaded lazily only for the skills the model picks.
//
// Verdicts: pass | block | error
// Exit codes: 0 = pass or error (fail-open, recorded — autonomy never deadlocks, REV-6)
//             1 = block (blocker-severity findings present)
//
// Usage: node scripts/pre-push-review.mjs [--source staged|worktree|last-commit|push-range]
//        [--range REMOTE_SHA LOCAL_SHA]  (used by .git/hooks/pre-push, r171)
// Output: sovereign/review-gate/last-review.json (schema review-gate-v1)

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const SKILLS_DIR = join(ROOT, "sovereign/knowledge/review-skills");
const OUT_PATH = join(ROOT, "sovereign/review-gate/last-review.json");
const BRIDGE = "http://127.0.0.1:3048/v1/chat/completions";
const DIFF_CAP = 64000;
const CALL_TIMEOUT_MS = 120000;

const args = process.argv.slice(2);
const srcIdx = args.indexOf("--source");
const SOURCE = srcIdx >= 0 ? args[srcIdx + 1] : "staged";
const rangeIdx = args.indexOf("--range");
const RANGE = rangeIdx >= 0 ? [args[rangeIdx + 1], args[rangeIdx + 2]] : null;

function collectPushRange([remoteSha, localSha]) {
  // New-branch push (all-zero remote) -> nothing to review here.
  if (!localSha || !remoteSha || /^0+$/.test(remoteSha)) return { stat: "", diff: "", source: "push-range" };
  // The remote sha may be unknown locally when server-side bots (weave-anchor CI)
  // moved the branch after our last fetch: fetch quietly, then compute.
  try {
    gitStrict(["fetch", "origin", "main", "--quiet"]);
  } catch {
    /* offline: range computation below will error loudly into verdict=error */
  }
  try {
    gitStrict(["cat-file", "-e", `${remoteSha}^{commit}`]);
  } catch {
    throw new Error(`push-range: remote sha ${remoteSha.slice(0, 7)} not resolvable locally (fetch failed?)`);
  }
  const stat = gitStrict(["diff", "--stat", `${remoteSha}..${localSha}`]);
  const diff = gitStrict(["diff", `${remoteSha}..${localSha}`]);
  return { stat, diff, source: "push-range" };
}

function git(diffArgs) {
  try {
    return execFileSync("git", diffArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return "";
  }
}

// r172: like git() but LOUD — a failed range computation must be recorded as
// verdict=error, never silently dressed up as "no-diff" (REV-3 verdict-or-record).
function gitStrict(diffArgs) {
  return execFileSync("git", diffArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

function collectDiff(source) {
  let diff = "";
  let stat = "";
  if (source === "last-commit") {
    stat = git(["show", "--stat", "--format=", "HEAD"]);
    diff = git(["show", "--format=", "HEAD"]);
  } else if (source === "worktree") {
    stat = git(["diff", "--stat"]);
    diff = git(["diff"]);
  } else {
    stat = git(["diff", "--cached", "--stat"]);
    diff = git(["diff", "--cached"]);
    if (!diff.trim()) {
      stat = git(["diff", "--stat"]);
      diff = git(["diff"]);
      source = "worktree";
    }
  }
  return { stat, diff, source };
}

function loadSkillIndex() {
  const skills = [];
  for (const dir of readdirSync(SKILLS_DIR)) {
    const p = join(SKILLS_DIR, dir, "SKILL.md");
    let raw;
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const name = (fm[1].match(/^name:\s*(.+)$/m) ?? [])[1]?.trim();
    const description = (fm[1].match(/^description:\s*(.+)$/m) ?? [])[1]?.trim();
    if (!name || !description) continue;
    const body = raw.slice(fm[0].length).trim();
    skills.push({ name, description, body });
  }
  return skills;
}

async function bridgeCall(messages, maxTokens = 1200) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(BRIDGE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0.2 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("bridge empty content");
    return { content, tookMs: Date.now() - t0, usage: data?.usage ?? null };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`no JSON object in: ${text.slice(0, 200)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

// r172 efficiency: a diff that touches NO code files cannot violate code laws.
// Short-circuit with zero LLM calls (state/ledger/doc churn bypasses the gate).
const CODE_EXT = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "sh", "bash", "go", "rs", "rb",
  "java", "kt", "c", "cc", "cpp", "h", "hpp", "cs", "swift", "php", "sql",
  "css", "scss", "html", "vue", "svelte", "prisma", "graphql", "ipynb",
]);

function diffTouchesCode(diff) {
  const files = [];
  for (const m of diff.matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)) {
    const path = (m[2] ?? m[1]).trim();
    const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
    files.push({ path, ext });
  }
  return files.some((f) => CODE_EXT.has(f.ext) || !f.path.includes("."));
}

// r189 root-fix for the hallucination class: the reviewer was reading 24K of a 620K diff —
// 90% state-JSON churn — and inventing findings about file tails it never saw ("missing
// newline", "missing 'use client'" at nonexistent lines). Code files only, wider cap:
// the reviewer now sees REAL code coverage; state churn was already out-of-scope by law.
function codeOnlyDiff(diff) {
  const blocks = diff.split(/^diff --git /m).filter((b) => b.trim().length > 0);
  const kept = blocks.filter((b) => {
    const m = b.match(/^a\/(.+?) b\/(.+?)(?:\n|$)/);
    if (!m) return false;
    const path = (m[2] ?? m[1]).trim();
    const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
    return CODE_EXT.has(ext) || !path.includes(".");
  });
  return kept.map((b) => "diff --git " + b).join("");
}

async function main() {
  const t0 = Date.now();
  let stat, diff, effSource;
  try {
    ({ stat, diff, source: effSource } = RANGE
      ? collectPushRange(RANGE)
      : collectDiff(SOURCE));
  } catch (e) {
    // Range computation failed: record verdict=error (fail-open, REV-6), never silent-pass.
    const result = {
      schema: "review-gate-v1",
      at: new Date().toISOString(),
      source: RANGE ? "push-range" : SOURCE,
      diffChars: 0,
      diffStat: "",
      skillsAvailable: [],
      skillsLoaded: [],
      verdict: "error",
      findings: [],
      reason: `range-compute-fail-open: ${e.message}`,
      evidence: { model: "sovereign-zai", bridge: BRIDGE.replace("http://", ""), llmCalls: 0, totalTookMs: Date.now() - t0 },
    };
    mkdirSync(join(ROOT, "sovereign/review-gate"), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + "\n");
    console.log(`REVIEW-GATE: ERROR (recorded, fail-open) — ${e.message}`);
    process.exit(0);
  }
  const skills = loadSkillIndex();

  const result = {
    schema: "review-gate-v1",
    at: new Date().toISOString(),
    source: effSource,
    diffChars: diff.length,
    diffStat: stat.trim().slice(0, 2000),
    skillsAvailable: skills.map((s) => s.name),
    skillsLoaded: [],
    verdict: "error",
    findings: [],
    reason: "",
    evidence: { model: "sovereign-zai", bridge: BRIDGE.replace("http://", ""), totalTookMs: 0 },
  };

  if (!diff.trim()) {
    result.verdict = "pass";
    result.reason = "no-diff";
    result.evidence.totalTookMs = Date.now() - t0;
    mkdirSync(join(ROOT, "sovereign/review-gate"), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + "\n");
    console.log(`REVIEW-GATE: pass (no-diff) → ${OUT_PATH}`);
    process.exit(0);
  }

  // r172 short-circuit: no code files in diff → zero LLM calls.
  if (!diffTouchesCode(diff)) {
    result.verdict = "pass";
    result.reason = "no-code-diff (state/doc/config churn) — 0 LLM calls";
    result.evidence.llmCalls = 0;
    result.evidence.totalTookMs = Date.now() - t0;
    mkdirSync(join(ROOT, "sovereign/review-gate"), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + "\n");
    console.log(`REVIEW-GATE: pass (no-code-diff, 0 LLM calls) → ${OUT_PATH}`);
    process.exit(0);
  }

  const diffCode = codeOnlyDiff(diff);
  const diffCapped =
    diffCode.length > DIFF_CAP
      ? diffCode.slice(0, DIFF_CAP) + `\n... [code-diff truncated, full ${diffCode.length} chars (of ${diff.length} raw incl. state churn); run git diff for the rest]`
      : diffCode;

  // Phase 1 — lazy skill selection (openreview loadSkill pattern)
  const indexList = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  let picked = [];
  try {
    const p1 = await bridgeCall([
      {
        role: "system",
        content:
          "You are the skill router of a sovereign code-review gate. Given a diff and a skill index, choose which skills' full instructions the reviewer needs. Reply with ONLY a JSON object: {\"skills\": [\"name1\", ...]} — empty array if none apply.",
      },
      {
        role: "user",
        content: `Skill index:\n${indexList}\n\nDiff to review (source: ${effSource}):\n${diffCapped.slice(0, 6000)}`,
      },
    ]);
    result.evidence.phase1TookMs = p1.tookMs;
    if (p1.usage) result.evidence.phase1Tokens = p1.usage;
    const parsed = extractJson(p1.content);
    if (Array.isArray(parsed.skills)) picked = parsed.skills.map(String);
  } catch (e) {
    result.reason = `phase1-fail-open: ${e.message}`;
  }

  const chosen = skills.filter((s) => picked.some((p) => p.toLowerCase() === s.name.toLowerCase()));
  // Fail-open fallback: if router picked nothing valid, use all skills (index still shown).
  const active = chosen.length > 0 ? chosen : [];
  result.skillsLoaded = active.map((s) => s.name);

  const skillBodies = active
    .map((s) => `### SKILL: ${s.name}\n${s.body}`)
    .join("\n\n")
    .slice(0, 14000);

  // Phase 2 — verdict
  try {
    const p2 = await bridgeCall(
      [
        {
          role: "system",
          content:
            'You are a sovereign pre-push code-review gate. Review the diff against the loaded skills. Rules: cite file:line for every finding; for each finding give problem, why it matters, and a concrete fix; never nitpick style or formatting; severity is "blocker" only for violations that break runtime, security, or a rule marked [BLOCKER]; otherwise "major" or "minor". If no real issues: verdict=pass with empty findings. Reply with ONLY a JSON object: {"verdict": "pass"|"block", "findings": [{"file": "...", "line": 0, "severity": "blocker"|"major"|"minor", "problem": "...", "why": "...", "fix": "..."}]}',
        },
        {
          role: "user",
          content: `${skillBodies ? `Loaded skills:\n${skillBodies}\n\n` : ""}CODE-ONLY diff (state/doc churn stripped; source: ${effSource}):\n${stat}\n${diffCapped}`,
        },
      ],
      2400
    );
    result.evidence.phase2TookMs = p2.tookMs;
    if (p2.usage) result.evidence.phase2Tokens = p2.usage;
    const verdict = extractJson(p2.content);
    if (verdict.verdict === "block" || verdict.verdict === "pass") result.verdict = verdict.verdict;
    if (Array.isArray(verdict.findings)) result.findings = verdict.findings.slice(0, 20);
    if (typeof verdict.reason === "string") result.reason = verdict.reason;
  } catch (e) {
    result.verdict = "error";
    result.reason = `phase2-fail-open: ${e.message}`;
  }

  if (result.verdict === "block" && !result.findings.some((f) => f.severity === "blocker")) {
    result.verdict = "pass";
    result.reason = (result.reason ? result.reason + "; " : "") + "downgraded: block without blocker findings";
  }

  result.evidence.totalTookMs = Date.now() - t0;
  result.evidence.llmCalls = 2;
  mkdirSync(join(ROOT, "sovereign/review-gate"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + "\n");

  const tag = result.verdict.toUpperCase();
  console.log(`REVIEW-GATE: ${tag} (${result.findings.length} findings, skills=[${result.skillsLoaded.join(",")||"none"}], ${result.evidence.totalTookMs}ms) → ${OUT_PATH}`);
  for (const f of result.findings) {
    console.log(`  [${f.severity}] ${f.file}:${f.line ?? "?"} — ${f.problem}`);
  }
  process.exit(result.verdict === "block" ? 1 : 0);
}

main().catch((e) => {
  console.error(`REVIEW-GATE: fatal ${e.message}`);
  process.exit(3);
});
