/**
 * proof.mjs — T-72 · מכשיר-ההוכחה (THE PROOF INSTRUMENT).
 * The operator's demand: prove profit, at txid level, from what exists.
 * This module answers with chain truth only:
 *   · eras            — lifetime vs machine-era vs the DEAD ZONE (proofLedgerLaw)
 *   · inFlight        — every machine vote still pending: our measured rshare
 *                       share × pending × CURATION_SHARE, settle dates (inFlightCurationLaw)
 *   · firstDollar     — the first provable machine-era dollar, as a DATE over
 *                       the measured timeline — or the wall, named (firstDollarLaw)
 *   · batteryApr      — the voting battery's measured yield (batteryAprLaw)
 *   · proofs[]        — the settled reward rows (kind/txid/amounts) the operator
 *                       can verify on any explorer
 * Chain reads: ONE day-gated vote scan + bounded get_content batch (chunked,
 * leashed 15 min) + a reward-fund probe (typed UNREACHABLE — measured live
 * 2026-10-04: all 4 shapes assert "Invalid reward fund name" on our nodes).
 * The heavy valueLedger stays payouts.mjs's (T-65) — proof READS it, never
 * rescans (one body, one reader).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { opTypeName, proofLedgerLaw, inFlightCurationLaw, firstDollarLaw, batteryAprLaw } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "proof.json");
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";
const MACHINE_ERA_START = "2026-09-09"; // the T-21 adoption window anchor
const VOTE_CUTOFF = "2026-09-28"; // in-flight votes can only exist after the last settlements began
const CONTENT_BATCH = 6; // get_content chunk width
const CONTENT_MAX = 60; // posts per scan — the fleet+curator vote surface measured 2026-10-04
const LEASH_MS = 15 * 60_000; // the heavy lane runs at most once per 15 min

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
export function proofState() { return readJson(FILE, null); }

const num = (s) => { const n = Number(String(s ?? "0").split(" ")[0]); return Number.isFinite(n) ? n : 0; };
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/* the machine's own vote ops since the cutoff (chain truth) */
async function ourVoteOps(account) {
  const r = await rpcCall("account_history_api.get_account_history", {
    account, start: -1, limit: 10000, select_ops: ["vote"],
  }).catch(() => ({ ok: false }));
  if (!r.ok) return { rows: [], api: null };
  const rows = [];
  for (const [, e] of r.result?.history ?? []) {
    if (opTypeName(e?.op) !== "vote") continue;
    const v = (Array.isArray(e.op) ? e.op[1] : e.op?.value) ?? {};
    if (v.voter !== account) continue;
    if (String(e.timestamp ?? "") < VOTE_CUTOFF) continue;
    rows.push({ author: v.author, permlink: v.permlink, weight: v.weight, at: `${e.timestamp}Z` });
  }
  return { rows, api: r.node };
}

/* per voted post: pending + OUR rshare share (rshareShareLaw guards the units) */
async function postRows(votes, account) {
  const uniq = new Map();
  for (const v of votes) { const k = `${v.author}/${v.permlink}`; if (!uniq.has(k)) uniq.set(k, v); }
  const keys = [...uniq.keys()].slice(0, CONTENT_MAX);
  const out = [];
  for (let i = 0; i < keys.length; i += CONTENT_BATCH) {
    const chunk = keys.slice(i, i + CONTENT_BATCH);
    const res = await Promise.all(chunk.map(async (k) => {
      const [author, permlink] = k.split("/");
      const c = await rpcCall("condenser_api.get_content", [author, permlink]).catch(() => ({ ok: false }));
      if (!c.ok || !c.result) return { key: k, err: true };
      const mine = (c.result.active_votes ?? []).find((a) => a.voter === account);
      const sumRshares = (c.result.active_votes ?? []).reduce((s, a) => s + Number(a.rshares ?? 0), 0);
      const selfClass = author === account ? "own" : /^saos-/.test(String(permlink)) ? "fleet" : "external";
      return {
        key: k,
        pendingSbd: num(c.result.pending_payout_value),
        cashout: c.result.cashout_time ?? null,
        myRshares: mine?.rshares ?? 0,
        sumRshares,
        selfClass,
        selfVoted: author === account,
      };
    }));
    out.push(...res.filter((r) => !r.err));
  }
  return out;
}

/* the reward fund, probed across every shape the nodes might still carry —
 * measured live 2026-10-04: ALL shapes assert on our node set → typed. */
async function rewardFundProbe() {
  const shapes = [
    ["condenser_api.get_reward_fund", ["Steem"]],
    ["condenser_api.get_reward_fund", ["steem"]],
    ["database_api.list_reward_funds", { start: null, limit: 10, order: "by_name" }],
    ["database_api.find_reward_funds", {}],
  ];
  for (const [m, p] of shapes) {
    const r = await rpcCall(m, p).catch(() => ({ ok: false }));
    if (r.ok && r.result) return { reachable: true, shape: m, fund: r.result };
  }
  return { reachable: false, shapesTried: shapes.length, reason: "all-shapes-assert (fund != nullptr) — measured live 2026-10-04" };
}

export async function runProof({ now = new Date().toISOString(), day = now.slice(0, 10), persist = true } = {}) {
  const prev = readJson(FILE, null);
  const payouts = readJson(path.join(STATE, "payouts.json"), null);
  const observe = readJson(path.join(STATE, "observe.json"), null);
  const steemUsd = observe?.parity?.steemUsd ?? null;
  const sbdUsd = observe?.parity?.sbdUsd ?? null;

  /* VESTS → STEEM from the same legs payouts uses (chain truth via DGP) */
  let v2s = prev?.pricing?.v2s ?? null;
  const leaseOk = !prev?.at || Date.parse(now) - Date.parse(prev.at) > LEASH_MS || prev?.day !== day;
  if (leaseOk) {
    const dyn = await rpcCall("condenser_api.get_dynamic_global_properties", []).catch(() => ({ ok: false }));
    const tvs = dyn.ok ? num(dyn.result?.total_vesting_shares) : 0;
    const tvf = dyn.ok ? num(dyn.result?.total_vesting_fund_steem) : 0;
    if (tvs > 0 && tvf > 0) v2s = tvf / tvs;
  }

  /* the heavy lane: votes + per-post money (day-gated by the leash) */
  let inFlight = prev?.inFlight ?? null;
  let rewardFund = prev?.rewardFund ?? null;
  if (leaseOk) {
    const [vf, votes] = await Promise.all([rewardFundProbe(), ourVoteOps(ACCOUNT)]);
    rewardFund = vf;
    const posts = votes.rows.length ? await postRows(votes.rows, ACCOUNT) : [];
    inFlight = inFlightCurationLaw({ rows: posts, sbdUsd });
    inFlight.voteScan = { rows: votes.rows.length, api: votes.api ?? null, cutoff: VOTE_CUTOFF };
  }

  /* eras from the T-65 valueLedger (payouts' scan — read, never re-scanned) */
  const vl = payouts?.valueLedger ?? null;
  const eras = proofLedgerLaw({
    totals: vl?.totals ?? null,
    windowRows: vl?.ledger ?? [],
    rollup: payouts?.rollup ?? null,
    steemUsd, sbdUsd, v2s,
    machineEraStart: MACHINE_ERA_START, now,
  });

  /* battery APR — WINDOW-ALIGNED law (live-caught 2026-10-04: the first run
   * priced LIFETIME curation vests (247,402 VESTS, 7,373 ops over the
   * account's whole life) over the 10-day rollup window → a fantasy 157%
   * APR. The numerator MUST be the settled curation of THE SAME window the
   * denominator spans: payouts.rollup.curationVests over rollup.windowDays,
   * with the window-rows sum as fallback. "measured-as-used", never a
   * lifetime-over-window fantasy. */
  const rollupDays = (() => {
    const o = payouts?.rollup?.oldestTs, n = payouts?.rollup?.newestTs;
    const a = Date.parse(String(o ?? "")), b = Date.parse(String(n ?? ""));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(1, Math.round((b - a) / 86_400_000));
  })();
  const windowCurationVests = (() => {
    const rv = Number(payouts?.rollup?.curationVests);
    if (Number.isFinite(rv) && rv > 0) return rv;
    const rows = Array.isArray(vl?.ledger) ? vl.ledger : [];
    const inWindow = rows.filter((r) => r?.kind === "curation");
    return inWindow.length ? inWindow.reduce((s, r) => s + num(r.vests), 0) : null;
  })();
  const battery = batteryAprLaw({
    settledCurationVests: windowCurationVests,
    windowDays: rollupDays,
    stakeSp: observe?.inventory?.spOwn ?? null,
    steemUsd, v2s,
    windowLabel: payouts?.rollup?.oldestTs && payouts?.rollup?.newestTs ? `${String(payouts.rollup.oldestTs).slice(0, 10)}→${String(payouts.rollup.newestTs).slice(0, 10)}` : null,
  });

  /* the first machine-era dollar: in-flight settle timeline + measured rails */
  const economics = readJson(path.join(STATE, "economics.json"), null);
  const makerUsdPerDay = economics?.rails?.find((r) => r?.id === "market-making")?.measuredUsdPerDay ?? null;
  const firstDollar = firstDollarLaw({
    inFlightUsd: inFlight?.totalUsd ?? 0,
    settleDates: inFlight?.settleDates ?? [],
    settledUsdPerDay: 0, // the settled history IS the dead zone — no invented flow
    makerUsdPerDay: Math.max(0, Number(makerUsdPerDay) || 0), // a losing maker contributes ZERO projected dollars, never negative hope
    now,
  });

  /* proofs[] — the operator-verifiable settled rows (txids where the chain keeps them) */
  const proofs = (vl?.ledger ?? []).slice(0, 40).map((r) => ({
    kind: r.kind ?? null, at: r.at ?? null, txid: r.txid ?? null, block: r.block ?? null,
    sbd: num(r.sbd ?? 0) || null, steem: num(r.steem ?? 0) || null, vests: num(r.vests ?? 0) || null,
    permlink: r.permlink ?? null,
  }));

  const out = {
    day, at: now, account: ACCOUNT,
    verdict: eras?.verdict === "PROOF-MEASURED" ? "PROOF-MEASURED" : "NO-LEDGER",
    eras, inFlight, battery, firstDollar, rewardFund, proofs,
    pricing: { steemUsd, sbdUsd, v2s: v2s != null ? r6(v2s) : null, source: observe?.parity?.source ?? null },
    machineEraStart: MACHINE_ERA_START,
    law: "ההוכחה: כל-שקל עם txid שניתן לבדוק בכל-סייר — העבר (lifetime) נפרד מההווה (machine-era), והדולר-הראשון תאריך-נמדד או קיר-נקרא-בשמו",
  };
  if (persist) writeJson(FILE, out);
  return out;
}
