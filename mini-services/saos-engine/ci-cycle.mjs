/**
 * ci-cycle.mjs — R244 · THE SOVEREIGN CI HEARTBEAT (דופק-הריבונות).
 *
 * OPERATOR ORDER 2026-10-07 (verbatim intent): "הטוקן הוא אדמין... תפעיל
 * actions... ווידוא פעילות ריבונית אוטונומית ללא תלות באף סנדבוקס חובה".
 *
 * WHERE THIS RUNS: GitHub Actions, on the public saos-runtime repo, on a
 * 30-minute cron — infrastructure that survives every sandbox wipe BY DESIGN.
 * The workflow clones the PRIVATE engine tree via a secrets-held PAT, runs
 * the selftest gate, then THIS file.
 *
 * WHAT ONE HEARTBEAT DOES (fail-isolated steps):
 *  1. CUSTODY: reviveArmyCustody — the git vault (agent/vault/*.enc on
 *     origin/main) decrypts and re-adopts the soldiers' posting WIFs against
 *     the LIVE chain. Zero key material in CI secrets: the vault IS the
 *     credential delivery, exactly like a fresh sandbox boot.
 *  2. SOCIAL: runSocial with SAOS_OFFLINE=1 + SAOS_CI_SKIP_MASTER=1 —
 *     · the offline intelligence pack (intel-pack.mjs) drafts anchored,
 *       topic-aware conversation — no bridge, no cockpit, no sandbox;
 *     · the soldiers converse: fleet comments, community comments, replies,
 *       deepens, mutual votes — under every cap and sanitizer.
 *  3. CONTENT: runContent — the sovereign corpus (content-corpus.json,
 *     hand-crafted pillar posts living IN the tree) queues drafts.
 *  4. STATE: written into state/*.json inside the clone; the workflow
 *     commits + pushes it back to saos-cockpit (FF-only, no force).
 *
 * WHAT NEVER HAPPENS HERE: the master (headcorner) credential is never
 * present — master signing, trading, custody stay machine-local. The job
 * summary prints VERDICTS ONLY (this output is public).
 *
 * Exit code: 0 = heartbeat lived (even if lanes honestly skipped);
 * only a broken gate (selftest handled in workflow) or a hard crash exits 1.
 */

/* T-61 (trace 1a12632b71721ef9): SAOS_ONLINE_CONTENT=1 lets a LOCAL heartbeat
 * feed the live bridge (the sandbox's own LLM at :3000). Default remains the
 * CI law — offline, corpus floor — so the cloud behavior is byte-unchanged. */
if (process.env.SAOS_ONLINE_CONTENT !== "1") process.env.SAOS_OFFLINE = "1";
process.env.SAOS_CI_SKIP_MASTER = "1";

import * as fs from "node:fs";
import * as path from "node:path";
import { masterAccount, armyCustodyState } from "./signer.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";
import { runSocial } from "./army-social.mjs";
import { runContent } from "./content.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

async function stepWrap(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    return { name, ok: true, ms: Date.now() - t0, ...(out ?? {}) };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) };
  }
}

async function main() {
  const now = new Date().toISOString();
  const report = { heartbeat: "saos.ci.v1", at: now, master: masterAccount(), steps: {} };

  report.steps.custody = await stepWrap("custody", async () => {
    const r = await reviveArmyCustody({ now });
    /* R245: full roster — 10 old army + the replacement generation (4/5/6) */
    const st = armyCustodyState([masterAccount(), "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"]);
    return { verdict: r?.verdict ?? null, verified: st?.verified ?? null, total: st?.total ?? null };
  });

  /* ── R245 · DEX TAKEOVER (operator order: no action is sovereign on the
   * sandbox) — when the sandbox's custodian anchor goes stale (engine dead),
   * CI adopts the master's ACTIVE authority (chain-judged, from the workflow
   * secret) and runs ONE full engine cycle: trading, converts, the economy.
   * A fresh anchor = engine alive = STANDBY (never races the local engine). */
  report.steps.dex = await stepWrap("dex-takeover", async () => {
    const { dexTakeoverDue } = await import("./lib.mjs");
    const anchor = readJson(path.join(STATE, "custody-anchor.json"), null);
    const last = readJson(path.join(STATE, "ci-takeover.json"), null);
    const gate = dexTakeoverDue({ anchorAt: anchor?.at ?? null, now, lastAt: last?.at ?? null });
    if (!gate.due) return { verdict: "STANDBY", reason: gate.reason, anchorAgeMs: anchor?.at ? Date.now() - (typeof anchor.at === "number" ? anchor.at : Date.parse(anchor.at)) : null };
    if (!process.env.CI_ADOPT_WIF_ACTIVE) return { verdict: "TAKEOVER-BLOCKED-NO-CREDENTIAL", reason: gate.reason };
    process.env.CI_ADOPT_WIF_POSTING = process.env.CI_ADOPT_WIF_POSTING ?? "";
    const { runCycle } = await import("./daily.mjs");
    const r = await runCycle({ now, persist: true });
    try {
      fs.writeFileSync(path.join(STATE, "ci-takeover.json"), JSON.stringify({ at: now, reason: gate.reason, verdict: r?.verdict ?? null, health: r?.health ?? null }, null, 2));
      appendLine(path.join(STATE, "events.jsonl"), { type: "ci.dex-takeover", at: now, reason: gate.reason, verdict: r?.verdict ?? null });
    } catch { /* ledger never blocks */ }
    return { verdict: "TAKEOVER-EXECUTED", reason: gate.reason, cycle: r?.verdict ?? null, health: r?.health ?? null };
  });

  report.steps.social = await stepWrap("social", async () => {
    const r = await runSocial({ now });
    return { verdict: r.verdict, executed: r.executed ?? 0, refused: r.refused ?? 0, due: r.due ?? 0 };
  });

  report.steps.content = await stepWrap("content", async () => {
    const r = await runContent({ now, force: true });
    return { verdict: r.verdict, draftsQueued: r.draftsQueued ?? 0, exposureBlocked: r.exposureBlocked ?? 0, source: r.source ?? null };
  });

  /* R312 · THE MEASURED-DIGEST SUPPLY (wires R288 — built 2026-10-10, never
   * called in production: the exact built-but-not-running pattern). Measured
   * 2026-10-11: the corpus burned out (R311 FULL-PUBLISHED SHIELD holds every
   * entry) and the bridge is down (ECONNREFUSED since 2026-10-08) — so the
   * posting stream starves while every gate stays green. The finance-digest
   * rail composes measured telemetry into a deterministic digest document,
   * appends it to the compiler intake and compiles it BROADCAST-READY
   * (max 2/day, 28-pair topic rotation, honesty law, never broadcasts).
   * Operator order 2026-10-11 (verbatim): "יש לך אישור להכל תמשיך בוא נתחיל לבצע". */
  report.steps.digest = await stepWrap("digest", async () => {
    const { runFinanceDigest } = await import("./finance-digest.mjs");
    const r = await runFinanceDigest({ now });
    return { verdict: r.verdict, slot: r.slot ?? null, title: r.title ?? null, compiled: r.compileVerdict ?? null };
  });

  /* T-61 · THE CONTINUOUS POSTING STREAM: one bounded broadcast attempt per
   * heartbeat (stage → mode → armed → caps → dedupe → signature-verified →
   * broadcast). Fail-closed everywhere; a refusal is a verdict, never an
   * error. The ledger (content/sent) travels in the repo so caps + dedupe
   * hold across machines and across sandbox deaths. */
  report.steps.post = await stepWrap("post", async () => {
    const { runOnce } = await import("./social-streamer.mjs");
    const r = await runOnce();
    return { verdict: r.verdict, account: r.account ?? null, permlink: r.permlink ?? null, mode: r.mode ?? null, note: r.note ?? null };
  });

  /* R313 · BLURT BODIES PROBE (read-only, public RPC, zero keys). Operator
   * question 2026-10-11: why do the blurt accounts read "not connected" while
   * the vault holds their keys? Truth: R267 verified 11/12 blurt bodies
   * FULL-ACCESS (2026-10-08), but no heartbeat step ever showed blurt — the
   * wing was invisible. This step makes the bodies visible every beat
   * (existence, stake, last post — public data only). The SPEND gate (R254
   * operator pause) is untouched: visibility is not spend. */
  report.steps.blurt = await stepWrap("blurt-custody", async () => {
    const { runBlurtBodies } = await import("./blurt-heartbeat.mjs");
    const r = await runBlurtBodies({ now });
    return { verdict: r.verdict, live: r.live ?? 0, total: r.total ?? 0, spendGate: "R254-PAUSE-STANDS" };
  });

  /* R314 · THE DELEGATION RAIL (operator standing order 2026-10-11, verbatim:
   * "אני רוצה להאציל sp לכלל החשבונות כדי לחלק את כוח העבודה וההצבעה ופוסטים
   * בצורה נכונה" + "יש לך אישור להכל"). Tops the active publishers up to their
   * floor from the treasury, chain-judged WIF adoption, hard caps, idempotent,
   * ledgered, fully reversible (7-day undelegation, ownership never moves).
   * Fail-closed when the CI_DELEGATION_ARMED secret is absent. */
  report.steps.delegation = await stepWrap("delegation", async () => {
    const { runDelegationRail } = await import("./delegation-rail.mjs");
    const r = await runDelegationRail({ now });
    return { verdict: r.verdict, ops: r.ops ?? 0, totalSp: r.totalSp ?? 0, reason: r.reason ?? null };
  });

  /* CI session ledger — the machine-independent life of the organ, appended
   * every heartbeat, committed back into the private tree. */
  try {
    appendLine(path.join(STATE, "ci-sessions.jsonl"), {
      at: now, verdict: report.steps.social?.verdict ?? null,
      executed: report.steps.social?.executed ?? 0,
      custodyVerified: report.steps.custody?.verified ?? null,
      draftsQueued: report.steps.content?.draftsQueued ?? 0,
    });
  } catch { /* ledger never blocks the heartbeat */ }

  const summary = {
    at: now,
    custody: `${report.steps.custody?.verified ?? "?"}/${report.steps.custody?.total ?? "?"}`,
    social: report.steps.social?.verdict ?? "STEP-FAIL",
    socialExecuted: report.steps.social?.executed ?? 0,
    content: report.steps.content?.verdict ?? "STEP-FAIL",
    contentSource: report.steps.content?.source ?? null,
    post: report.steps.post?.verdict ?? "STEP-FAIL",
    postAccount: report.steps.post?.account ?? null,
    postPermlink: report.steps.post?.permlink ?? null,
    dex: report.steps.dex?.verdict ?? "STEP-FAIL",
    dexReason: report.steps.dex?.reason ?? null,
    digest: report.steps.digest?.verdict ?? "STEP-FAIL",
    digestTitle: report.steps.digest?.title ?? null,
    blurt: report.steps.blurt?.verdict ?? "STEP-FAIL",
    blurtLive: report.steps.blurt?.live ?? null,
    delegation: report.steps.delegation?.verdict ?? "STEP-FAIL",
    delegationOps: report.steps.delegation?.ops ?? 0,
    delegationSp: report.steps.delegation?.totalSp ?? 0,
  };
  console.log("CI-HEARTBEAT " + JSON.stringify(summary));
  fs.writeFileSync(path.join(STATE, "ci-last-heartbeat.json"), JSON.stringify({ ...summary, report }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error("CI-HEARTBEAT-FAIL", String(e?.message ?? e)); process.exit(1); });
