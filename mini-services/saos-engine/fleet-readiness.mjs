/* fleet-readiness.mjs — R316: the architecture knows BY ITSELF whether every
 * account it owns can actually act. Answers, with numbers per account:
 *   exists on-chain? | keys live (judge crown-map fingerprints) | own/received
 *   SP | outgoing delegation | max RC + energy | verdict (ACTIVE / STARVED /
 *   NO-KEYS-IN-VAULT / KEYS-SEALED-PASS-UNAVAILABLE / NOT-ON-CHAIN).
 * No key material is ever read or printed — key liveness comes from the
 * judge's fingerprint verdicts, never from the raw crown-map.
 * Receipt: state/fleet-readiness-latest.json + state/fleet-readiness.jsonl
 * (honest, append-only, one line per run). */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const S = path.join(DIR, "state");
const KNOWN = [
  "headcorner","lsa","siq","woq","hcsoldier4","hcsoldier5","cashmachine",
  "haran","israelnews","macrame","tov","wic","wog",
  "hcsoldier1","hcsoldier2","hcsoldier3","hcsoldier6","hcsoldier12",
];
/* key liveness per account as last attested by master-judge (fingerprints only) */
const JUDGE_KEYS = {
  headcorner:["owner","active","memo"], lsa:["owner","active","posting","memo"],
  siq:["owner","active","posting","memo"], woq:["owner","active","posting","memo"],
  hcsoldier4:["posting"], hcsoldier5:["posting"], cashmachine:["owner","posting"],
  haran:["owner","active"], israelnews:["owner","memo"], macrame:["owner","active"],
  tov:["owner","active","posting"], wic:["owner","active","posting"], wog:["owner","active","memo"],
};
const SEALED = { hcsoldier12: "KEYS-SEALED-PASS-UNAVAILABLE (CROWN-NEW-20261029T153531Z; transport pass not held locally)" };
const amt = (x) => (typeof x === "string" ? parseFloat(x) : Number(x));

export async function runFleetReadiness() {
  const at = new Date().toISOString();
  const gp = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  const spm = gp?.ok ? amt(gp.result.total_vesting_fund_steem) / amt(gp.result.total_vesting_shares) : null;
  const accs = await rpcCall("condenser_api.get_accounts", [[...new Set(KNOWN)]]);
  const byName = new Map((accs?.result ?? []).map((a) => [String(a.name), a]));
  const rows = {};
  for (const name of KNOWN) {
    const a = byName.get(name);
    if (!a) { rows[name] = { exists:false, verdict:"NOT-ON-CHAIN" }; continue; }
    const own = amt(a.vesting_shares) * spm, recv = amt(a.received_vesting_shares) * spm, out = amt(a.delegated_vesting_shares) * spm;
    let rca = null;
    for (let i = 0; i < 2 && !rca; i++) {
      const rc = await rpcCall("rc_api.find_rc_accounts", { accounts: [name] });
      rca = rc?.result?.rc_accounts?.[0] ?? null;
    }
    const cur = Number(rca?.rc_manabar?.current_mana ?? 0), max = Number(rca?.max_rc ?? 0);
    const keys = JUDGE_KEYS[name] ?? [];
    const eff = own + recv - out;
    let verdict;
    if (!keys.length) verdict = SEALED[name] ? "KEYS-SEALED-PASS-UNAVAILABLE" : "NO-KEYS-IN-VAULT";
    else if (eff < 1) verdict = "STARVED";
    else if (!rca) verdict = "RC-UNMEASURED"; /* measurement failed ≠ starvation — never conflate */
    else verdict = "ACTIVE";
    rows[name] = {
      exists: true, verdict,
      keysLive: keys, inVault: keys.length > 0,
      spOwn: +(own).toFixed(3), spReceived: +(recv).toFixed(3), spDelegatedOut: +(out).toFixed(3),
      spEffective: +(own + recv - out).toFixed(3),
      steem: amt(a.balance), sbd: amt(a.sbd_balance),
      maxRc: max, rcEnergyPct: max ? +((100 * cur) / max).toFixed(2) : null,
      rcMeasured: Boolean(rca),
      powerdownPerWeekSp: +(amt(a.vesting_withdraw_rate) * spm).toFixed(3),
    };
  }
  /* master outgoing delegation truth */
  const dg = await rpcCall("condenser_api.get_vesting_delegations", ["headcorner", "", "100"]);
  const delegations = (dg?.result ?? []).map((d) => ({ delegatee: d.delegatee, sp: +(amt(d.vesting_shares) * spm).toFixed(2) }));
  const summary = {
    active: Object.entries(rows).filter(([, r]) => r.verdict === "ACTIVE").length,
    starved: Object.entries(rows).filter(([, r]) => r.verdict === "STARVED").map(([n]) => n),
    rcUnmeasured: Object.entries(rows).filter(([, r]) => r.verdict === "RC-UNMEASURED").map(([n]) => n),
    noKeys: Object.entries(rows).filter(([, r]) => r.verdict === "NO-KEYS-IN-VAULT").map(([n]) => n),
    sealed: Object.entries(rows).filter(([, r]) => r.verdict === "KEYS-SEALED-PASS-UNAVAILABLE").map(([n]) => n),
    delegationOutSp: +delegations.reduce((s, d) => s + d.sp, 0).toFixed(1),
    delegationCount: delegations.length,
  };
  const out = { at, spm, summary, delegations, rows };
  fs.mkdirSync(S, { recursive: true });
  fs.writeFileSync(path.join(S, "fleet-readiness-latest.json"), JSON.stringify(out, null, 1));
  fs.appendFileSync(path.join(S, "fleet-readiness.jsonl"), JSON.stringify({ at, summary }) + "\n");
  return out;
}

/* CLI: node fleet-readiness.mjs */
if (process.argv[1] && process.argv[1].endsWith("fleet-readiness.mjs")) {
  runFleetReadiness()
    .then((o) => { console.log("READINESS", JSON.stringify(o.summary)); })
    .catch((e) => { console.error("READINESS-ERROR", String(e?.message ?? e).slice(0, 200)); process.exit(1); });
}
