/* SAOS PORTFOLIO-SNAPSHOT (exec34, lane 34-d) — git-as-memory weights of
 * the paper economy.
 *
 * LAW PROVENANCE — owner's exec34 git-as-memory portfolio-snapshot
 * directive: the sovereignty's portfolio is computed from ITS OWN paper
 * ledger (mini-services/saos-dex/state/grids.json + ledger.json — R328
 * lineage, DECISIONS #12/#17) and committed back into git as memory,
 * every beat. NEVER brokers, NEVER external price APIs, NEVER keys —
 * registry number pending (R343+). This is the paper/analysis layer:
 * zero broadcasts, zero value movement, zero chain connectivity. The
 * snapshot is chart-ready flat JSON (Supercharts-pattern visual layer)
 * and sealed with the SAME signature convention as surface-watch's
 * signWatchDoc: "sig:" + first 8 hex of sha256 over the canonical
 * (sorted-key) JSON of the doc without its sig field.
 *
 * DETERMINISM CONTRACT (no clock beyond the passed `now`, no randomness,
 * no network, no env reads):
 *   - grid stacks: each plan leg (asks + bids) contributes its quote-
 *     currency notional to the QUOTE asset (leg.notionalQuote) and the
 *     base-side value qty×price to the BASE asset (fallback: the leg's
 *     notionalQuote when qty/price are unusable). Malformed stacks/legs
 *     are SKIPPED and counted, never fabricated.
 *   - ledger credit: the fleet-native CREDIT paper currency gets the sum
 *     of credit.minted[].amount (fallback: credit.supply when minted is
 *     absent/empty). Backing/collateral rows are provenance, not working
 *     notional — honestly out of scope.
 *   - weights = assetNotional / total rounded to 6 decimals, sorted desc
 *     with an asset-ascending tiebreak; a deterministic largest-remainder
 *     fixup keeps the ROUNDED weights summing to 1 (asserted |Σ−1| ≤ 1e-6
 *     or fail-closed WEIGHT-SUM-FAIL — never a fabricated sum).
 *   - the all-zero economy is honest: verdict EMPTY-ECONOMY, weights [],
 *     never NaN.
 *
 * Zero deps: node:fs, node:path, node:crypto, node:child_process,
 * node:util only. The state write is ATOMIC (tmp + rename, the
 * surface-watch writeAtomic convention) and PROVEN by a parse-back
 * readback (R340). The commit loop is repo-local git, one file only,
 * never pushed from here (pushing stays in lane/CI hands).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const SNAPSHOT_IDENTITY = "exec34-engine-lane@agents.roshpinacare-sys";
export const SNAPSHOT_LAW_SOURCE =
  "exec34 git-as-memory portfolio-snapshot directive: deterministic weights from the sovereignty's OWN saos-dex paper ledger " +
  "(grids.json + ledger.json — R328 lineage, DECISIONS #12/#17); never brokers, never external price APIs; zero keys, zero " +
  "broadcasts, zero value movement; seal convention mirrors surface-watch signWatchDoc; registry number pending (R343+)";

const STATE_REL = path.join("mini-services", "saos-engine", "state", "portfolio-snapshot-latest.json");
const r6 = (x) => { const v = Math.round(x * 1e6) / 1e6; return Object.is(v, -0) ? 0 : v; };

/* ── seal: surface-watch signWatchDoc convention, mirrored exactly ───────── */
function stableStringify(v) {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function signSnapshotDoc(doc) {
  const { sig, ...rest } = doc ?? {};
  return "sig:" + createHash("sha256").update(stableStringify(rest ?? {})).digest("hex").slice(0, 8);
}

/* ── 1 · readLedgerState — read OWN saos-dex paper state, fail-closed ────── */
export function readLedgerState(repoRoot) {
  const gridsPath = path.join(String(repoRoot ?? ""), "mini-services", "saos-dex", "state", "grids.json");
  const ledgerPath = path.join(String(repoRoot ?? ""), "mini-services", "saos-dex", "state", "ledger.json");
  try {
    const grids = JSON.parse(fs.readFileSync(gridsPath, "utf8"));
    if (!grids || typeof grids !== "object" || !Array.isArray(grids.stacks)) throw new Error("grids-shape-invalid");
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    if (!ledger || typeof ledger !== "object") throw new Error("ledger-shape-invalid");
    return {
      ok: true,
      grids,
      ledger,
      at: {
        gridsAt: typeof grids.at === "string" ? grids.at : null,
        ledgerAt: typeof ledger.at === "string" ? ledger.at : null,
      },
    };
  } catch (e) {
    const detail = String(e?.message ?? e);
    const missing = /ENOENT|ENOTDIR|EISDIR/.test(detail);
    return {
      ok: false,
      error: missing ? "saos-dex-state-missing" : "saos-dex-state-unparseable",
      detail: detail.slice(0, 200),
      gridsPath,
      ledgerPath,
    };
  }
}

/* ── 2 · computeWeights — DETERMINISTIC weights from the paper economy ───── */
export function computeWeights({ grids, ledger } = {}) {
  const notionals = new Map();
  const skipped = { malformedStacks: 0, badLegs: 0, badCredit: 0 };
  const add = (asset, v) => {
    if (typeof asset !== "string" || !asset) return false;
    if (!Number.isFinite(v) || !(v > 0)) return false;
    notionals.set(asset, (notionals.get(asset) ?? 0) + v);
    return true;
  };
  const stacks = grids && typeof grids === "object" && Array.isArray(grids.stacks) ? grids.stacks : [];
  for (const st of stacks) {
    const pair = Array.isArray(st?.pair) && st.pair.length === 2 && st.pair.every((x) => typeof x === "string" && x) ? st.pair : null;
    const plan = st && typeof st.plan === "object" && st.plan !== null ? st.plan : null;
    if (!pair || !plan) { skipped.malformedStacks++; continue; }
    const legs = [...(Array.isArray(plan.asks) ? plan.asks : []), ...(Array.isArray(plan.bids) ? plan.bids : [])];
    for (const leg of legs) {
      const nq = Number(leg?.notionalQuote);
      const qty = Number(leg?.qty);
      const price = Number(leg?.price);
      const quoteOk = add(pair[1], nq);
      const baseOk = add(pair[0], Number.isFinite(qty) && Number.isFinite(price) ? qty * price : nq);
      if (!quoteOk && !baseOk) skipped.badLegs++;
    }
  }
  const credit = ledger && typeof ledger === "object" ? ledger.credit : null;
  if (credit && typeof credit === "object") {
    if (Array.isArray(credit.minted) && credit.minted.length > 0) {
      for (const m of credit.minted) { if (!add("CREDIT", Number(m?.amount))) skipped.badCredit++; }
    } else if (credit.supply !== undefined) {
      if (!add("CREDIT", Number(credit.supply))) skipped.badCredit++;
    }
  }
  const total = [...notionals.values()].reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || !(total > 0)) {
    return { ok: true, verdict: "EMPTY-ECONOMY", weights: [], total: 0, skipped }; // honest zero — never NaN
  }
  const rows = [...notionals.entries()].map(([asset, n]) => ({ asset, weight: r6(n / total), notional: r6(n) }));
  // deterministic largest-remainder fixup so the ROUNDED weights still sum to 1
  const sumR = rows.reduce((a, w) => a + w.weight, 0);
  const residual = r6(1 - sumR);
  if (residual !== 0) {
    let top = rows[0];
    for (const w of rows) if (w.weight > top.weight) top = w;
    const fixed = r6(top.weight + residual);
    if (!(fixed > 0)) return { ok: false, verdict: "WEIGHT-SUM-FAIL", error: "fixup-nonpositive", weights: null, total, skipped };
    top.weight = fixed;
  }
  const sumF = rows.reduce((a, w) => a + w.weight, 0);
  if (!(Math.abs(sumF - 1) <= 1e-6)) {
    return { ok: false, verdict: "WEIGHT-SUM-FAIL", error: `weights-sum-out-of-band:${sumF}`, weights: null, total, skipped };
  }
  rows.sort((a, b) => (b.weight - a.weight) || (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));
  return { ok: true, verdict: "WEIGHTS-OK", weights: rows, total: r6(total), skipped };
}

/* ── 3 · buildSnapshotDoc — the signed, chart-ready state doc ────────────── */
export function buildSnapshotDoc({ grids, ledger, now } = {}) {
  const at = typeof now === "string" && now ? now : new Date().toISOString();
  const lawSource = SNAPSHOT_LAW_SOURCE;
  const identity = SNAPSHOT_IDENTITY;
  const source = {
    gridsAt: grids && typeof grids === "object" && typeof grids.at === "string" ? grids.at : null,
    ledgerAt: ledger && typeof ledger === "object" && typeof ledger.at === "string" ? ledger.at : null,
  };
  const w = computeWeights({ grids, ledger });
  if (!w.ok) {
    const doc = { at, verdict: "SNAPSHOT-FAIL", identity, source, error: w.error ?? w.verdict ?? "weights-failed", weights: [], chartReady: { labels: [], series: [] }, lawSource };
    return { ...doc, sig: signSnapshotDoc(doc) };
  }
  const weights = w.weights;
  const doc = {
    at,
    verdict: w.verdict === "EMPTY-ECONOMY" ? "EMPTY-ECONOMY" : "SNAPSHOT-OK",
    identity,
    source,
    weights, // flat JSON [{asset, weight, notional}] — chart-ready
    chartReady: { labels: weights.map((x) => x.asset), series: weights.map((x) => x.weight) },
    lawSource,
  };
  return { ...doc, sig: signSnapshotDoc(doc) };
}

/* ── 4 · writeSnapshot — ATOMIC write + R340 parse-back readback ─────────── */
export function writeSnapshot(repoRoot, doc) {
  const file = path.join(String(repoRoot ?? ""), STATE_REL);
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    if (!doc || typeof doc !== "object") return { written: false, error: "doc-required", path: file };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, file);
    const back = JSON.parse(fs.readFileSync(file, "utf8")); // R340: written is PROVEN, never assumed
    if (!back || typeof back !== "object" || back.sig !== doc.sig || back.verdict !== doc.verdict) {
      return { written: false, error: "readback-mismatch", path: file };
    }
    return { written: true, path: file };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort tmp cleanup */ }
    return { written: false, error: String(e?.message ?? e).slice(0, 200), path: file };
  }
}

/* ── 5 · commitSnapshot — the git-as-memory loop (one file, idempotent) ──── */
const GIT_IDENTITY = ["-c", "user.name=exec34-engine-lane", "-c", "user.email=exec34-engine-lane@agents.roshpinacare-sys", "-c", "commit.gpgsign=false"];

async function git(repoRoot, args, opts = {}) {
  const { stdout } = await execFileP("git", args, { cwd: repoRoot, timeout: 20000, maxBuffer: 4 * 1024 * 1024, ...opts });
  return String(stdout).trim();
}

export async function commitSnapshot(repoRoot, doc) {
  try {
    await git(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    const status = await git(repoRoot, ["status", "--porcelain", "--", STATE_REL]);
    if (!status) return { committed: false, reason: "no-change", path: STATE_REL }; // idempotent skip
    await git(repoRoot, ["add", "--", STATE_REL]); // ONLY this one state file
    const msg = `SAOS-engine-ci: portfolio snapshot (weights ${Array.isArray(doc?.weights) ? doc.weights.length : 0}, verdict ${doc?.verdict ?? "?"}) [ci]`;
    await execFileP("git", [...GIT_IDENTITY, "commit", "-m", msg, "--", STATE_REL], { cwd: repoRoot, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const sha = await git(repoRoot, ["rev-parse", "HEAD"]);
    return { committed: true, sha, path: STATE_REL, message: msg };
  } catch (e) {
    return { committed: false, reason: "git-error", error: String(e?.message ?? e).slice(0, 200), path: STATE_REL };
  }
}

/* ── 6 · runPortfolioSnapshot — read → compute → build → write → commit ──── */
export async function runPortfolioSnapshot({ repoRoot, commit = true, now = null } = {}) {
  try {
    if (typeof repoRoot !== "string" || !repoRoot) return { ok: false, stage: "args", error: "repoRoot-required" };
    const st = readLedgerState(repoRoot);
    if (!st.ok) return { ok: false, stage: "read", error: st.error, detail: st.detail ?? null };
    const w = computeWeights({ grids: st.grids, ledger: st.ledger });
    if (!w.ok) return { ok: false, stage: "weights", error: w.error ?? w.verdict ?? "weights-failed" };
    const doc = buildSnapshotDoc({ grids: st.grids, ledger: st.ledger, now: typeof now === "string" && now ? now : new Date().toISOString() });
    const wr = writeSnapshot(repoRoot, doc);
    if (!wr.written) return { ok: false, stage: "write", error: wr.error ?? "write-failed", path: wr.path ?? null };
    const cm = commit ? await commitSnapshot(repoRoot, doc) : { committed: false, reason: "commit-skipped-by-flag" };
    return { ok: true, verdict: doc.verdict, doc, write: wr, commit: cm };
  } catch (e) {
    return { ok: false, stage: "unhandled", error: String(e?.message ?? e).slice(0, 200) }; // never throw past the boundary
  }
}
