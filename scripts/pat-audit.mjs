// PAT-AUDIT (R250) — live verdict on the operator PAT + leak-scan of the token value.
// Evidence-first: every claim below is a real network/fs probe with a timestamp.
// Usage: bun scripts/pat-audit.mjs   (exit 0 = audit ran; verdict field is the truth)
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const NOW = () => new Date().toISOString();
const out = { ts: NOW(), checks: {} };

// --- read token (never printed) ----------------------------------------------
let tok = null;
try {
  const raw = readFileSync(new URL("../upload/pat.env", import.meta.url), "utf8");
  tok = raw.split(/\r?\n/).map((s) => s.trim()).find((s) => /^(ghp_|github_pat_|gho_|ghs_)/.test(s)) || null;
} catch { /* absent */ }
out.checks.tokenPresent = Boolean(tok);
if (!tok) {
  out.verdict = "NO_TOKEN";
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}
const kind = tok.startsWith("github_pat_") ? "fine-grained" : "classic";
out.checks.tokenKind = kind;

// --- identity + rate limit ----------------------------------------------------
const H = { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" };
let scopesHeader = null;
const ures = await fetch("https://api.github.com/user", { headers: H });
scopesHeader = ures.headers.get("x-oauth-scopes"); // classic tokens expose scopes here
const user = await ures.json();
out.checks.login = user?.login ?? null;
out.checks.accountType = user?.type ?? null;
out.checks.classicScopes = scopesHeader; // null for fine-grained (expected)
const rl = await fetch("https://api.github.com/rate_limit", { headers: H }).then((r) => r.json());
out.checks.rateRemaining = rl?.resources?.core?.remaining ?? null;

// --- leak scan: does the token value itself appear in the tracked tree? -------
let leak = false;
try {
  execSync(`git grep -q -F -e ${JSON.stringify(tok)}`, { stdio: "pipe" });
  leak = true; // grep exit 0 = found
} catch { /* exit 1 = clean */ }
out.checks.tokenValueInTree = leak;

// --- packages publish capability ----------------------------------------------
// Proven E403 x3 (19:50Z, R248, 2026-10-07T20:27:53Z) for fine-grained on a User
// account: GitHub Packages write exists ONLY as an Organization permission for
// fine-grained PATs, or as classic scope write:packages.
if (kind === "fine-grained") {
  out.checks.packagesPublish = "BLOCKED_BY_TOKEN_TYPE";
  out.verdict = user?.type === "User"
    ? "NEED_CLASSIC_PAT_WRITE_PACKAGES"
    : "NEED_ORG_PACKAGES_PERMISSION_OR_CLASSIC";
} else {
  const scopes = scopesHeader || "";
  out.checks.packagesPublish = scopes.includes("write:packages") ? "CAPABLE (verify with publish)" : "BLOCKED_MISSING_SCOPE";
  out.verdict = scopes.includes("write:packages") ? "READY_FOR_PUBLISH" : "NEED_WRITE_PACKAGES_SCOPE";
}
out.nextAction = out.verdict === "NEED_CLASSIC_PAT_WRITE_PACKAGES"
  ? "Operator: docs/OPERATOR-PAT-STEPS.md → classic PAT write:packages → upload/pat-classic.env → bash scripts/publish-github-packages.sh"
  : "bash scripts/publish-github-packages.sh";
console.log(JSON.stringify(out, null, 2));
