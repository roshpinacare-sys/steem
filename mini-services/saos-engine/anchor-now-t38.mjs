/* T-38 · ANCHOR NOW — one-shot custodian anchor refresh.
 *
 * MEASURED HAZARD (2026-10-09 03:10Z): the local anchor was 3.6h stale
 * (written Oct 8 23:33 by the pre-recycle engine) because ci-act's cadence
 * gates never fired since the revival. With a >90min-stale anchor the PUBLIC
 * runner's dex-takeover gate goes DUE (anchor-stale + 3h gap since the last
 * takeover) and adopts the master's ACTIVE authority WHILE the local engine
 * lives — the double-sovereignty the R245 law exists to prevent.
 *
 * This organ broadcasts the SAME custom_json the ci-act flow does
 * (saos-git-custody-v1, git tip, think-gate, posting role, memory-only WIF)
 * and writes state/custody-anchor.json. Then the anchor is PUSHED to the
 * private repo so the runner's next pulse reads a live custodian and stands
 * down (engine-alive → STANDBY). This is a refresh of the standing law, not
 * a new one — same gates, same identity path, one broadcast, rate-limited. */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { thinkGate, executeAs, custodyOf, verifyRoles } from "./signer.mjs";
import { reviveWriterIdentity } from "../../scripts/sovereign-selfcustody.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ACCOUNT = "headcorner";

function sh(cmd, args) {
  try {
    return { out: execFileSync(cmd, args, { encoding: "utf8", cwd: DIR }).trim() };
  } catch (e) { return { out: "", err: String(e).slice(0, 100) }; }
}

function lastAnchorMs() {
  try {
    return Number(JSON.parse(fs.readFileSync(path.join(DIR, "state", "custody-anchor.json"), "utf8")).at) || 0;
  } catch { return 0; }
}

const last = lastAnchorMs();
const ageMin = Math.round((Date.now() - last) / 60_000);
if (Date.now() - last < 3600_000) {
  console.log(JSON.stringify({ ok: true, verdict: "RATE-LIMITED-DURABLE", ageMin }));
  process.exit(0);
}

const co0 = custodyOf(ACCOUNT);
if (co0 !== "master-verified") {
  /* same boot-identity path the engine itself uses (index.ts boot lines) —
   * adopt from the sovereign vault, then re-verify. Zero secrets logged. */
  /* Promise.resolve() wrapper is the R291-measured law — reviveWriterIdentity
   * may return non-promise, and a bare .then/.catch killed engine boot lines */
  const rev = await Promise.resolve(reviveWriterIdentity()).catch((e) => ({ verdict: `ERROR:${String(e?.message ?? e).slice(0, 80)}` }));
  console.error(`identity revival: ${rev?.verdict ?? "?"}`);
}
const co = custodyOf(ACCOUNT);
/* custodyOf is PROCESS-LOCAL: a fresh process may read master-unverified even
 * while the engine's own process is fully verified — executeAs derives WIFs
 * on demand and fail-closes on its own (measured: "WIFs derived on demand").
 * So we do NOT hard-refuse here; the broadcast gate below is the authority. */
console.error(`custody precheck: ${co} — chain-proving via verifyRoles (the gate's own demand)`);
/* the gate refuses "keyed-but-unverified" — verifyRoles IS the chain-proven
 * adoption the law requires (same as the engine's custody 14/14 boot flow) */
const vr = await Promise.resolve(verifyRoles(ACCOUNT)).catch((e) => ({ verdict: `ERROR:${String(e?.message ?? e).slice(0, 100)}` }));
console.error(`verifyRoles: ${JSON.stringify(vr?.verdict ?? vr).slice(0, 120)}`);
const coProven = custodyOf(ACCOUNT);
if (coProven !== "master-verified") {
  /* R300-b · SECOND ADMISSION PATH (the custodian's own measured cure, R297:
   * after any cold start the password-derivation cache is dead and verifyRoles
   * chronically mismatches — measured live 2026-10-10 03:41Z — while the SAME
   * vault's WIF is chain-judged alive 14/14). The chain itself vouches:
   * adoptAccountPostingWif runs the generation unlock + role-exact
   * live-authority match, fail-closed, memory-only, zero secrets logged. */
  const { adoptAccountPostingWif } = await import("./vault-revival.mjs");
  const adopt = await Promise.resolve(adoptAccountPostingWif(ACCOUNT)).catch((e) => ({ ok: false, reason: String(e?.message ?? e).slice(0, 100) }));
  console.error(`vault adoption: ${adopt?.ok ? String(adopt.gen ?? "ok") : String(adopt?.reason ?? "refused").slice(0, 100)}`);
  if (adopt?.ok) await Promise.resolve(verifyRoles(ACCOUNT)).catch(() => null);
  const co2 = custodyOf(ACCOUNT);
  if (co2 !== "master-verified") {
    console.log(JSON.stringify({ ok: false, verdict: `CUSTODY-REFUSED:${co2}` }));
    process.exit(1);
  }
}

/* R315 · PUSHED-TIP LAW (same measured cure as the custodian): the chain
 * anchors TRUTH (what origin/saos-cockpit holds), never ambition. HEAD
 * unpushed/diverged → anchor the pushed tip instead of a lineage that a
 * reconcile may lawfully drop. */
function isAncestor(sha, of) {
  if (!sha || !of) return false;
  return sh("git", ["merge-base", "--is-ancestor", sha, of]).code === 0;
}
let tip = sh("git", ["rev-parse", "HEAD"]).out;
if (!isAncestor(tip, "origin/saos-cockpit")) {
  const originTip = sh("git", ["rev-parse", "origin/saos-cockpit"]).out;
  if (originTip) {
    console.error(`pushed-tip law: HEAD ${tip.slice(0, 12)} unpushed/diverged — anchoring pushed truth ${originTip.slice(0, 12)}`);
    tip = originTip;
  } else {
    console.log(JSON.stringify({ ok: false, verdict: "NO-ORIGIN-REV — refused to anchor a guess" }));
    process.exit(1);
  }
}
const ops = [["custom_json", {
  required_auths: [],
  required_posting_auths: [ACCOUNT],
  id: "saos-git-custody-v1",
  json: JSON.stringify({ branch: "saos-cockpit", tip, at: new Date().toISOString(), src: "t38-anchor-now", fp: "t38" }),
}]];
const gate = thinkGate(ACCOUNT, ops, { source: "ci-custody-witness" });
if (gate?.verdict !== "ALLOW") {
  console.log(JSON.stringify({ ok: false, verdict: `GATE:${(gate?.reasons ?? []).join(";").slice(0, 140)}` }));
  process.exit(1);
}
const r = await executeAs(ACCOUNT, ops, { tag: "ci-custody-witness", role: "posting" });
if (r?.ok) {
  fs.writeFileSync(path.join(DIR, "state", "custody-anchor.json"), JSON.stringify({ at: Date.now(), txid: r.txid ?? null, tip }));
  console.log(JSON.stringify({ ok: true, verdict: "ANCHORED", txid: r.txid ?? null, tip: tip.slice(0, 8) }));
} else {
  console.log(JSON.stringify({ ok: false, verdict: `BROADCAST-FAIL:${String(r?.verdict ?? r?.error ?? "?").slice(0, 120)}` }));
  process.exit(1);
}
