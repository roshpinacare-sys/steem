#!/usr/bin/env node
/**
 * fire-drill.mjs — exec37 · lane 37-b · THE FIRE-DRILL (the Agents-Die Test).
 *
 * LAW PROVENANCE — PLAN-2026-Q4-giants-alignment.md (Autonomy 010d283):
 * §0 Agents-Die Test criterion 4 "נבנה-מחדש-מ-git" (rebuildable from bare
 * clones — the only criterion never tested, DR score 0/4 measured 17:30Z),
 * §2 G3 (fire-drill: "clone → selftest → watchtower → signature; measured
 * and documented"), §3 lane D (scope: fire-drill.mjs NEW in steem),
 * §4 P0. R-CLAIM: R360-CANDIDATE rebuild-drill — registration belongs to
 * the registry lanes (grep-before-write, fleet law #21 / R337 CAS); this
 * lane NEVER self-registers.
 *
 * WHAT IT PROVES (end-to-end, from a throwaway clone of the origin):
 *   (1) CLONE    — a fresh shallow clone of the origin builds from git alone
 *                  (PAT read from the fleet-pat file, embedded ONE-TIME in
 *                  the https URL, never logged — every captured string is
 *                  scrubbed of the token and of URL credentials).
 *   (2) SELFTEST — `node mini-services/saos-engine/selftest.mjs` runs GREEN
 *                  inside the clone (durationMs measured; the engine's own
 *                  rebuild procedure is honored: if the clone's engine
 *                  package.json exists and @noble is missing, the CI's own
 *                  fallback `npm i --no-save @noble/hashes @noble/secp256k1`
 *                  runs first — sovereign-cycle.yml line 43 is the law).
 *   (3) EVIDENCE — the CLONE's own evidence.mjs verifySelftestEvidence
 *                  classifies the clone's state pair; the drill requires
 *                  SUITE-RAN + honest:true (R354 execution-evidence: a
 *                  verdict without positive execution evidence is NO-EVIDENCE).
 *   (4) WATCH    — the CLONE's own surface-watch.mjs runSurfaceWatch produces
 *                  a sealed verdict against the clone's state (repairMode
 *                  "observe": a throwaway clone never executes repairs —
 *                  self-heal belongs to the REAL watchtower on the REAL
 *                  repo; drills measure, they do not double-fire repairs).
 *                  Full network targets are the default; when the caller
 *                  injects a local-only target list (selftest fixtures) or
 *                  network is unavailable, the step DEGRADES HONESTLY:
 *                  {ok:false, skipped:true, reason:"requires-live-network"}.
 *
 * DR SCORE (the honest rule): drScore = {passed: count of ok:true steps,
 * total: 4}. SKIPPED ≠ PASSED — a skipped step is never counted, so the
 * score reports the truth even when a step was unmeasurable. Verdict
 * DRILL-PASS iff every step ok (verdict DRILL-FAIL otherwise). Exit code
 * 0 iff DRILL-PASS.
 *
 * OUTPUTS: state/fire-drill-latest.json via evidence.mjs writeJsonAtomic
 * (atomic tmp+rename) + ONE typed receipt (watch-upgrades.mjs makeReceipt,
 * kind MEASUREMENT, scope private — the fail-closed default) appended to
 * state/watch-receipts.jsonl (R357 typed-receipts, R341 atomic append,
 * R340 readback inside appendReceiptLedger). Fixture runs point stateRoot
 * at a TEMP dir — the selftest must never write the real ledger
 * (readback-proven byte-size law, section 51).
 *
 * CLI:  node fire-drill.mjs                 → drill the real origin
 *       node fire-drill.mjs --repo <path>   → drill a LOCAL fixture repo
 *                                             (bare or normal; the selftest
 *                                             seam — zero real network)
 *
 * Zero npm deps (node:fs/path/child_process/os/crypto/url only; the two
 * sibling imports evidence.mjs + watch-upgrades.mjs are pure builtins too).
 * Zero keys in the code (the PAT is read at runtime, never echoed, never
 * written to any file/receipt/report). Zero brokers, zero value moved,
 * zero broadcasts. Paper/infra layer only: the drill measures; the only
 * things it writes are its own report + one receipt.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeJsonAtomic } from "./evidence.mjs";
import { makeReceipt, appendReceiptLedger, readReceipts } from "./watch-upgrades.mjs";

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ENGINE_DIR, "..", "..");
const DEFAULT_REPORT_REL = path.join("mini-services", "saos-engine", "state", "fire-drill-latest.json");
const DEFAULT_ORIGIN_URL = "https://github.com/roshpinacare-sys/steem.git";
const DEFAULT_PAT_FILE = process.env.FIRE_DRILL_PAT_FILE || "/home/z/my-project/.runtime/fleet-pat";
export const DRILL_STEPS = Object.freeze(["clone", "selftest", "evidence", "watch"]);
export const DRILL_VERSION = 1;

/* ── sanitization — the PAT never survives into any string that leaves ──── */

export function sanitizeLine(line, secrets = []) {
  let out = String(line ?? "");
  for (const s of secrets) {
    const str = String(s ?? "");
    if (str.length >= 6) out = out.split(str).join("***");
  }
  // URL credentials: scheme://user:pass@host → scheme://***@host
  out = out.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^@/\s]+@/g, (m) => {
    const i = m.indexOf("://");
    return m.slice(0, i + 3) + "***@";
  });
  return out;
}

export function deepSanitize(obj, secrets = []) {
  if (typeof obj === "string") return sanitizeLine(obj, secrets);
  if (Array.isArray(obj)) return obj.map((x) => deepSanitize(x, secrets));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = deepSanitize(obj[k], secrets);
    return out;
  }
  return obj;
}

function resolveSecrets({ pat, patFile, sourceUrl }) {
  const secrets = [];
  if (typeof pat === "string" && pat.length >= 6) secrets.push(pat);
  if (!pat && patFile) {
    try {
      const raw = fs.readFileSync(patFile, "utf8").trim();
      if (raw.length >= 6) secrets.push(raw);
    } catch { /* no PAT file → unauthenticated clone attempt (honest) */ }
  }
  // any credential already embedded in a URL is a secret too
  const m = String(sourceUrl ?? "").match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^@/\s]+)@/);
  if (m) for (const part of m[1].split(":")) if (part.length >= 6) secrets.push(part);
  return secrets;
}

function buildCloneUrl(repoUrl, pat) {
  const url = String(repoUrl ?? "");
  if (!pat) return url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^@/\s]+@/, "https://");
  if (url.startsWith("https://") && !url.includes("@")) return url.replace("https://", `https://x-access-token:${pat}@`);
  return url; // local paths / file:// / already-credentialed URLs pass through
}

const tail = (s, n) => {
  const str = String(s ?? "");
  return str.length <= n ? str : str.slice(str.length - n);
};
const hex = (s) => /^[0-9a-f]+$/.test(String(s ?? ""));

/* ── the four steps ──────────────────────────────────────────────────────── */

function stepClone(opts, secrets, ctx) {
  const started = Date.now();
  const parent = path.join(os.tmpdir(), `fire-drill-${randomBytes(6).toString("hex")}`);
  const cloneDir = path.join(parent, "clone");
  const src = opts.repoPath
    ? "file://" + path.resolve(opts.repoPath)
    : buildCloneUrl(opts.repoUrl ?? DEFAULT_ORIGIN_URL, ctx.pat);
  const args = ["clone", "--depth", "1", ...(opts.branch ? ["--branch", String(opts.branch)] : []), src, cloneDir];
  const r = spawnSync("git", args, { encoding: "utf8", timeout: opts.cloneTimeoutMs ?? 180000 });
  const ok = r.status === 0 && fs.existsSync(path.join(cloneDir, ".git"));
  let originHead = null;
  if (ok) {
    try { originHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cloneDir, encoding: "utf8" }).trim(); } catch { originHead = null; }
  }
  ctx.parent = parent;
  ctx.cloneDir = cloneDir;
  return {
    name: "clone",
    ok,
    skipped: false,
    durationMs: Date.now() - started,
    detail: {
      source: opts.repoPath ? path.resolve(opts.repoPath) : sanitizeLine(src, secrets),
      branch: opts.branch ?? null,
      shallow: true,
      originHead,
      ...(ok ? {} : { error: tail(sanitizeLine(`${r.stderr ?? ""}\n${r.stdout ?? ""}`, secrets), 400) || `git-exit-${r.status}` }),
    },
  };
}

function engineNpmSubstep(cloneDir, opts, secrets) {
  /* the sovereignty's own rebuild law (sovereign-cycle.yml): the engine's
   * two @noble deps are installed by `bun install` (primary) or the npm
   * fallback — in a bare clone node_modules is absent, so the drill runs
   * the fallback BEFORE the selftest. Skipped when not needed (fixtures). */
  const engineDir = path.join(cloneDir, "mini-services", "saos-engine");
  const pkg = path.join(engineDir, "package.json");
  const nobleDir = path.join(engineDir, "node_modules", "@noble");
  if (opts.allowNpmInstall === false || !fs.existsSync(pkg) || fs.existsSync(nobleDir)) {
    return { needed: false, ran: false, ok: true, tool: null, durationMs: 0 };
  }
  const started = Date.now();
  let r = spawnSync("npm", ["i", "--no-save", "--no-audit", "--no-fund", "@noble/hashes", "@noble/secp256k1"], { cwd: engineDir, encoding: "utf8", timeout: opts.npmTimeoutMs ?? 240000 });
  let tool = "npm";
  if (r.status !== 0 && r.error) { // npm binary missing → the CI's primary tool
    r = spawnSync("bun", ["install"], { cwd: engineDir, encoding: "utf8", timeout: opts.npmTimeoutMs ?? 240000 });
    tool = "bun";
  }
  const ok = r.status === 0 && fs.existsSync(nobleDir);
  const out = { needed: true, ran: true, ok, tool, durationMs: Date.now() - started };
  if (!ok) out.error = tail(sanitizeLine(`${r.stderr ?? ""}\n${r.stdout ?? ""}`, secrets), 300) || `${tool}-exit-${r.status}`;
  return out;
}

function stepSelftest(opts, secrets, ctx) {
  const started = Date.now();
  if (!ctx.cloneDir || !fs.existsSync(ctx.cloneDir)) {
    return { name: "selftest", ok: false, skipped: true, durationMs: 0, detail: { reason: "dependency:clone-unavailable" } };
  }
  const npmInstall = engineNpmSubstep(ctx.cloneDir, opts, secrets);
  const selftestFile = path.join(ctx.cloneDir, "mini-services", "saos-engine", "selftest.mjs");
  if (!fs.existsSync(selftestFile)) {
    return { name: "selftest", ok: false, skipped: false, durationMs: Date.now() - started, detail: { npmInstall, error: "selftest.mjs-missing-in-clone" } };
  }
  if (npmInstall.needed && !npmInstall.ok) {
    return { name: "selftest", ok: false, skipped: false, durationMs: Date.now() - started, detail: { npmInstall, error: "engine-deps-install-failed (rebuild gap)" } };
  }
  const r = spawnSync(process.execPath, [selftestFile], { cwd: ctx.cloneDir, encoding: "utf8", timeout: opts.selftestTimeoutMs ?? 300000 });
  const out = `${r.stdout ?? ""}`;
  const m = out.match(/SELFTEST (\d+)\/(\d+) (PASS|FAIL)/);
  const ok = r.status === 0;
  return {
    name: "selftest",
    ok,
    skipped: false,
    durationMs: Date.now() - started,
    detail: {
      npmInstall,
      exitCode: r.status,
      selftestLine: m ? `${m[1]}/${m[2]} ${m[3]}` : null,
      tail: tail(sanitizeLine(out, secrets), 1200),
    },
  };
}

async function stepEvidence(opts, ctx) {
  const started = Date.now();
  if (!ctx.cloneDir || !fs.existsSync(ctx.cloneDir)) {
    return { name: "evidence", ok: false, skipped: true, durationMs: 0, detail: { reason: "dependency:clone-unavailable" } };
  }
  try {
    /* import the CLONE's own evidence.mjs — the drill must test the clone's
     * code, never the runner's copy (the clone verifies itself). */
    const mod = await import(pathToFileURL(path.join(ctx.cloneDir, "mini-services", "saos-engine", "evidence.mjs")).href);
    const stateDir = path.join(ctx.cloneDir, "mini-services", "saos-engine", "state");
    const res = mod.verifySelftestEvidence({
      verdictPath: path.join(stateDir, "selftest-last-run.json"),
      markerPath: path.join(stateDir, "selftest-run-marker.json"),
    });
    const ok = res.evidence === "SUITE-RAN" && res.honest === true;
    return { name: "evidence", ok, skipped: false, durationMs: Date.now() - started, detail: { ...res, module: "clone:evidence.mjs" } };
  } catch (e) {
    return { name: "evidence", ok: false, skipped: false, durationMs: Date.now() - started, detail: { error: tail(String(e?.message ?? e), 200) } };
  }
}

async function stepWatch(opts, ctx) {
  const started = Date.now();
  if (!ctx.cloneDir || !fs.existsSync(ctx.cloneDir)) {
    return { name: "watch", ok: false, skipped: true, durationMs: 0, detail: { reason: "dependency:clone-unavailable" } };
  }
  let sw = null;
  try {
    sw = await import(pathToFileURL(path.join(ctx.cloneDir, "mini-services", "saos-engine", "surface-watch.mjs")).href);
  } catch (e) {
    return { name: "watch", ok: false, skipped: false, durationMs: Date.now() - started, detail: { error: `surface-watch-import-failed: ${tail(String(e?.message ?? e), 160)}` } };
  }
  const now = opts.now ?? new Date().toISOString();
  const targets = Array.isArray(opts.watchTargets) && opts.watchTargets.length ? opts.watchTargets : sw.probeTargets(now);
  const needsNet = targets.some((t) => !(t && t.kind === "statefile" && t.source === "local"));
  const networkAvailable = opts.networkAvailable != null ? !!opts.networkAvailable : typeof fetch === "function";
  if (needsNet && !networkAvailable) {
    /* the honest skip: unmeasurable is NEVER a pass and never a fabricated
     * verdict — it is recorded as skipped (which is never counted as passed). */
    return { name: "watch", ok: false, skipped: true, durationMs: Date.now() - started, detail: { reason: "requires-live-network", targets: targets.length } };
  }
  try {
    const w = await sw.runSurfaceWatch({
      stateDir: path.join(ctx.cloneDir, "mini-services", "saos-engine", "state"),
      now,
      repairMode: "observe", // a throwaway clone measures; it never repairs
      targets,
      ...(opts.watchTimeoutMs ? { timeoutMs: opts.watchTimeoutMs } : {}),
      ...(opts.watchFetchImpl ? { fetchImpl: opts.watchFetchImpl } : {}),
    });
    const ok = w.surfaceWatch === "SURFACES-OK";
    /* per-target honesty: the sealed doc in the clone carries the judged
     * targets — surface the non-OK ones (id/verdict/reason) in the detail */
    let nonOk = null;
    try {
      const sealed = JSON.parse(fs.readFileSync(path.join(ctx.cloneDir, "mini-services", "saos-engine", "state", "surface-watch-latest.json"), "utf8"));
      nonOk = (Array.isArray(sealed.targets) ? sealed.targets : []).filter((t) => t.verdict && t.verdict !== "OK").map((t) => ({ id: t.id, verdict: t.verdict, reason: t.reason }));
    } catch { nonOk = null; }
    return {
      name: "watch",
      ok,
      skipped: false,
      durationMs: Date.now() - started,
      detail: { verdict: w.surfaceWatch, targets: w.surfaceTargets, ok: w.surfaceOK, degraded: w.surfaceDegraded, down: w.surfaceDown, repairMode: w.repairMode, fileWritten: w.fileWritten, nonOk },
    };
  } catch (e) {
    return { name: "watch", ok: false, skipped: false, durationMs: Date.now() - started, detail: { error: tail(String(e?.message ?? e), 200) } };
  }
}

/* ── the drill ───────────────────────────────────────────────────────────── */

export async function runFireDrill(opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const stateRoot = opts.stateRoot ?? REPO_ROOT;
  const reportPath = opts.reportPath ?? path.join(stateRoot, DEFAULT_REPORT_REL);
  const ledgerRepoRoot = opts.ledgerRepoRoot ?? stateRoot;
  const sourceUrl = opts.repoPath ? null : (opts.repoUrl ?? DEFAULT_ORIGIN_URL);
  const pat = opts.pat ?? (opts.repoPath ? null : readPat(opts.patFile ?? DEFAULT_PAT_FILE));
  const ctx = { pat }; // the clone step builds its ONE-TIME credentialed URL from ctx.pat
  const secrets = resolveSecrets({ pat, patFile: opts.patFile ?? DEFAULT_PAT_FILE, sourceUrl });

  const steps = [];
  steps.push(stepClone(opts, secrets, ctx));
  steps.push(stepSelftest(opts, secrets, ctx));
  steps.push(await stepEvidence(opts, ctx));
  steps.push(await stepWatch(opts, ctx));

  const passed = steps.filter((s) => s.ok === true).length;
  const total = steps.length;
  const verdict = passed === total ? "DRILL-PASS" : "DRILL-FAIL";
  const runId = randomBytes(16).toString("hex");

  const report = deepSanitize({
    at: now,
    drillVersion: DRILL_VERSION,
    verdict,
    drScore: { passed, total },
    runId,
    originHead: steps[0]?.detail?.originHead ?? null,
    source: opts.repoPath ? path.resolve(opts.repoPath) : sanitizeLine(sourceUrl ?? "", secrets),
    branch: opts.branch ?? null,
    steps: steps.map(({ name, ok, skipped, durationMs, detail }) => ({ name, ok, skipped, durationMs, detail })),
    verdictRule: "DRILL-PASS iff all 4 steps ok:true; skipped ≠ passed (fail-closed honesty); exit 0 iff DRILL-PASS",
    lawSource: "PLAN-2026-Q4-giants-alignment.md §0 criterion-4 (rebuild-from-git) · §2 G3 · §3 lane D · §4 P0 · R360-CANDIDATE rebuild-drill (registry pending — never self-registered)",
  }, secrets);

  let reportWritten = null;
  try { reportWritten = writeJsonAtomic(reportPath, report); } catch (e) { reportWritten = { written: false, error: tail(String(e?.message ?? e), 200), path: reportPath }; }

  const receipt = makeReceipt({
    kind: "MEASUREMENT",
    scope: "private", // fail-closed default — sharing is an explicit act
    subject: `fire-drill ${verdict}`,
    at: now,
    body: {
      runId,
      drillVersion: DRILL_VERSION,
      verdict,
      drScore: { passed, total },
      originHead: report.originHead,
      steps: steps.map(({ name, ok, skipped, durationMs }) => ({ name, ok, skipped, durationMs })),
    },
  });
  const receiptAppend = appendReceiptLedger(ledgerRepoRoot, receipt);
  const receiptReadback = readReceipts(ledgerRepoRoot, { kind: "MEASUREMENT" });
  const receiptIsLast = receiptReadback.ok && receiptReadback.receipts.length > 0 &&
    receiptReadback.receipts[receiptReadback.receipts.length - 1].body?.runId === runId;

  let cleanupOk = true;
  if (ctx.parent) {
    try { fs.rmSync(ctx.parent, { recursive: true, force: true }); } catch { cleanupOk = false; }
    try { cleanupOk = !fs.existsSync(ctx.parent); } catch { cleanupOk = false; }
  }

  return deepSanitize({
    verdict, drScore: { passed, total }, runId, originHead: report.originHead,
    steps, exitCode: verdict === "DRILL-PASS" ? 0 : 1,
    reportPath, reportWritten,
    receipt: { kind: receipt.kind, subject: receipt.subject, at: receipt.at, body: receipt.body },
    receiptAppend, receiptIsLast, cleanupOk,
  }, secrets);
}

function readPat(patFile) {
  try { return fs.readFileSync(patFile, "utf8").trim() || null; } catch { return null; }
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function printSummary(r) {
  const line = (s) => console.log(sanitizeLine(s, [])); // results are already sanitized at construction
  line(`FIRE-DRILL ${r.verdict} drScore=${r.drScore.passed}/${r.drScore.total} runId=${r.runId} originHead=${r.originHead ?? "null"}`);
  for (const s of r.steps) line(`  step ${s.name}: ok=${s.ok} skipped=${s.skipped} durationMs=${s.durationMs}`);
  line(`  report: ${r.reportPath} (written=${!!(r.reportWritten && r.reportWritten.written)})`);
  line(`  receipt: kind=${r.receipt.kind} appended=${r.receiptAppend.ok} readback-last=${r.receiptIsLast}`);
  if (!r.cleanupOk) line(`  WARN: temp drill dir cleanup failed (leftover tmp)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const opts = {};
  const i = argv.indexOf("--repo");
  if (i !== -1 && argv[i + 1]) opts.repoPath = argv[i + 1];
  const b = argv.indexOf("--branch");
  if (b !== -1 && argv[b + 1]) opts.branch = argv[b + 1];
  runFireDrill(opts)
    .then((r) => { printSummary(r); process.exit(r.exitCode); })
    .catch((e) => { console.error(`FIRE-DRILL-ERROR ${sanitizeLine(String(e?.message ?? e), [])}`); process.exit(1); });
}
