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

process.env.SAOS_OFFLINE = "1";
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
    const st = armyCustodyState([masterAccount(), "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"]);
    return { verdict: r?.verdict ?? null, verified: st?.verified ?? null, total: st?.total ?? null };
  });

  report.steps.social = await stepWrap("social", async () => {
    const r = await runSocial({ now });
    return { verdict: r.verdict, executed: r.executed ?? 0, refused: r.refused ?? 0, due: r.due ?? 0 };
  });

  report.steps.content = await stepWrap("content", async () => {
    const r = await runContent({ now, force: true });
    return { verdict: r.verdict, draftsQueued: r.draftsQueued ?? 0, exposureBlocked: r.exposureBlocked ?? 0, source: r.source ?? null };
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
  };
  console.log("CI-HEARTBEAT " + JSON.stringify(summary));
  fs.writeFileSync(path.join(STATE, "ci-last-heartbeat.json"), JSON.stringify({ ...summary, report }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error("CI-HEARTBEAT-FAIL", String(e?.message ?? e)); process.exit(1); });
