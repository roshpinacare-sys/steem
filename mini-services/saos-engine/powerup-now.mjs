/**
 * powerup-now.mjs — ONE-OFF OPERATOR EXECUTION (T-595, 2026-11-04).
 *
 * WHY: the T-91 d2 law defers the power-up whenever a claim_reward_balance
 * is in the batch (posting/active authority cannot mix in one signed tx).
 * Pending curation dust (>0 VESTS at ANY time) keeps the claim in EVERY
 * batch → the power-up lane is structurally starved (measured 2026-11-04:
 * morning cycle claimed 12.88 VESTS dust and deferred powerUpSteem 48.422;
 * 21:07Z cycle stalled on slow nodes before execute). The fix here is NOT
 * a code change: the power-up runs as its OWN transaction through the SAME
 * lawful rails (crown-vault-adopt → executeAs → think gate rule 4:
 * self-directed + operator.allowPowerUp=true). The claim dust is left in
 * place — it never blocks a standalone active-authority tx.
 *
 * AMOUNT: the doctrine plan's own number (redeploy.planned powerUpSteem,
 * fresh-computed at cycle start), floored by the batch-funds guard law
 * (liquid − liquidSteemFloor), never above doctrine.
 *
 * LAWS: fail-closed (no chain-verified custody → exit 1, honest); zero key
 * material printed; verdicts only; single broadcast; pacing receipt written.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

const PLAN = readJson(path.join(STATE, "daily-report.json"), null);
// freshness guard: a STALE plan means a STALE excess — deploying doctrine
// numbers from an old report risks over-vesting (the excess shrinks as the
// book arms). Only a report finished within the last 2h may drive vesting.
const FIN = PLAN?.finishedAt ?? PLAN?.startedAt ?? null;
const AGE = FIN ? Date.now() - Date.parse(FIN) : Infinity;
if (!FIN || !(AGE < 2 * 3600_000)) { console.error(`powerup-now: report stale (${FIN ?? "none"}) — honest skip (fresh doctrine required)`); process.exit(1); }
// prefer the freshest planned number from the last cycle's redeploy step
let planned = PLAN?.steps?.redeploy?.powerUpSteem ?? null;
if (!planned || !(planned >= 0.001)) { console.error("powerup-now: no REDEPLOY-PLAN number available — honest abort"); process.exit(1); }

const signer = await import("./signer.mjs");
const { masterAccount, executeAs } = signer;
const adoptMod = await import("./crown-vault-adopt.mjs");
const ad = await adoptMod.runAdopt();
if (ad?.verdict !== "FLEET-CUSTODY-ALIVE") { console.error("powerup-now: custody NOT alive — fail-closed abort:", JSON.stringify({ verdict: ad?.verdict ?? null, reason: ad?.reason ?? null })); process.exit(1); }
console.log(`[powerup-now] custody: ${ad.verdict} verified=${ad.verified}/${ad.total}`);

const ACCOUNT = masterAccount();
const { accountState } = await import("./measure.mjs");
const acc = await accountState(ACCOUNT);
if (!acc?.ok) { console.error("powerup-now: chain read failed — honest abort"); process.exit(1); }
const floorSteem = readJson(path.join(DIR, "..", "..", ".secrets", "exec-armed.json"), {})?.redeploy?.liquidSteemFloor ?? 5;
const amt3 = Math.floor(Math.min(planned, Math.max(0, acc.steem - floorSteem)) * 1000) / 1000;
if (!(amt3 >= 0.001)) { console.error("powerup-now: batch-funds guard refuses (liquid below floor) — honest abort"); process.exit(1); }
console.log(`[powerup-now] planned=${planned} liquid=${acc.steem} floor=${floorSteem} → vest ${amt3.toFixed(3)} STEEM (self-directed, gate-armed)`);

const t0 = new Date().toISOString();
const r = await executeAs(ACCOUNT, [["transfer_to_vesting", { from: ACCOUNT, to: ACCOUNT, amount: `${amt3.toFixed(3)} STEEM` }]]);
console.log(`[powerup-now] broadcast: ${JSON.stringify({ ok: r?.ok ?? false, txid: r?.txid ?? null, error: r?.error ?? r?.reason ?? null })}`);
appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.executed-standalone", at: t0, powerUpSteem: amt3, ok: !!r?.ok, txid: r?.txid ?? null, law: "T-595 standalone power-up (claim-dust deadlock bypass, gate-armed, doctrine-capped)" });
if (r?.ok) {
  const RS_FILE = path.join(STATE, "redeploy-state.json");
  const rs = readJson(RS_FILE, { day: t0.slice(0, 10), powerUpsToday: 0, lastPowerUpAt: null });
  writeRs();
  function writeRs() {
    const day = t0.slice(0, 10);
    if (rs.day !== day) { rs.day = day; rs.powerUpsToday = 0; }
    fs.writeFileSync(RS_FILE, JSON.stringify({ day, powerUpsToday: (rs.powerUpsToday ?? 0) + 1, lastPowerUpAt: t0 }));
  }
  console.log("[powerup-now] pacing receipt bumped");
} else {
  process.exit(1);
}
process.exit(0);
