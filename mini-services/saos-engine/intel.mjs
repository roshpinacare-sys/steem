/**
 * intel.mjs — self-activating intelligence: every cycle the system scans its
 * own situation and writes DECISIONS with reasons (not just data). The
 * executor consumes these decisions on the next step of the SAME cycle.
 *
 * Operator order: "הרבה אינטליגנציה שתפעיל את עצמה ללא תלות במפעיל בשוטף".
 *
 * Rails scanned each cycle:
 *  - book depth & spread  → recommended ladder concentration (dragK input)
 *  - parity drift          → arb / reprice pressure signals
 *  - convert edge          → D-023 PSM rail status (armed by MEASURED price)
 *  - soldier fleet         → deploy need / grid health
 *  - reward claims         → unclaimed STEEM/SBD/VESTS = free fuel
 *  - RC health             → resource floor guard
 *  - curation dormancy     → measured $ potential, honest when 0
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { soldiersState } from "./soldiers.mjs";
import { dragK } from "./lib.mjs";
import { triggerWatch } from "./adaptation.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const INTEL_FILE = path.join(STATE, "intel.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* R235: atomic — rename is the commit point */

export async function scanBookDepth() {
  const r = await rpcCall("condenser_api.get_order_book", [15]);
  if (!r.ok) return { ok: false };
  const asks = (r.result?.asks ?? []).map((x) => ({ unit: Number(String(x.real_price ?? "0")) , sbd: Number(String(x.sbd ?? "0").split(" ")[0]) }));
  // real_price in condenser order book = base/quote ratio (SBD per STEEM)
  const bestAsk = asks.length ? Number(r.result.asks[0].real_price) : null;
  const bestBid = r.result?.bids?.length ? Number(r.result.bids[0].real_price) : null;
  if (!(bestAsk > 0) || !(bestBid > 0)) return { ok: true, bestAsk, bestBid, spreadBps: null };
  const mid = (bestAsk + bestBid) / 2;
  const spreadBps = Math.round(((bestAsk - bestBid) / mid) * 10000);
  return { ok: true, bestAsk, bestBid, mid, spreadBps };
}

export async function unclaimedRewards(account) {
  const r = await rpcCall("condenser_api.get_accounts", [[account]]);
  const acc = r.ok ? r.result?.[0] : null;
  if (!acc) return { ok: false };
  const val = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;
  const out = {
    ok: true,
    steem: val(acc.reward_steem_balance),
    sbd: val(acc.reward_sbd_balance),
    vests: val(acc.reward_vesting_balance),
  };
  out.any = out.steem > 0 || out.sbd > 0 || out.vests > 0;
  return out;
}

/** the one intelligence pass — returns decisions AND persists them */
export async function runIntel({ obs, offer, convert, now }) {
  const decisions = [];
  const push = (kind, decision, reason, action = null) => decisions.push({ kind, decision, reason, action, at: now });

  const depth = await scanBookDepth();
  if (depth.ok && depth.spreadBps != null) {
    const k = dragK(depth.spreadBps);
    push("book-depth",
      k > 1.4 ? "concentrate" : "hold-shape",
      `spread ${depth.spreadBps}bps → dragK ${k}`,
      { spreadBpsRec: depth.spreadBps, bestAsk: depth.bestAsk, bestBid: depth.bestBid });
  } else {
    push("book-depth", "no-read", "order book read failed — proceed with last-known shape", null);
  }

  const band = obs?.band;
  if (band?.bps != null && Math.abs(band.bps) >= 100) {
    push("parity-drift", Math.abs(band.bps) >= 500 ? "arb-window" : "monitor",
      `internal feed deviates ${band.bps}bps from external parity`,
      { bps: band.bps });
  }

  if (convert?.verdict === "CONVERT-PLAN") {
    push("convert", "arm", `edge ${convert.edgeBps}bps on ${convert.amountSbd} SBD (PSM hysteresis)`, { amountSbd: convert.amountSbd });
  } else if (convert?.verdict === "CONVERT-HOLD") {
    push("convert", "hold", convert.reason ?? "below band", { edgeBps: convert.edgeBps ?? null });
  }

  const st = soldiersState();
  if (!st.deployed) push("soldiers", "deploy-needed", `fleet not yet on the book (planned: master-funded micro-grids)`, { deployed: false });
  else push("soldiers", "grids-live", `${st.accounts.length} soldiers holding lanes alongside master`, { deployed: true });

  const rewards = await unclaimedRewards(obs?.account ?? "headcorner").catch(() => ({ ok: false }));
  /* R210 §V: NATURAL TRIGGER MONITOR — chain-measured pending rewards are the
   * ONLY lawful trigger. Monitored here (independent of custody state):
   * pending=0 → honest ARMED+WAITING journal; pending>0 → trigger record.
   * Never manufactured, never forced (R210 §IV/§XXII). */
  triggerWatch(rewards.ok === true && rewards.any === true, rewards.ok ? { steem: rewards.steem ?? 0, sbd: rewards.sbd ?? 0, vests: rewards.vests ?? 0 } : { steem: 0, sbd: 0, vests: 0 });
  if (rewards.ok && rewards.any) {
    push("rewards", "claim", `unclaimed: ${rewards.steem} STEEM + ${rewards.sbd} SBD + ${rewards.vests} VESTS — free fuel, claim now`, rewards);
  }

  const rc = obs?.inventory?.rcPct;
  if (rc != null) push("rc-health", rc < 20 ? "conserve" : "healthy", `RC at ${rc}%`, { rcPct: rc });

  const fuel = obs?.fuel;
  /* T-13: the curation rail is LIVE (curator.mjs) — intel reports its real
   * state each cycle instead of only noting dormancy. When disabled by the
   * operator, the honest dormant note returns. */
  const cur = readJson(path.join(STATE, "curator.json"), null);
  const curConf = cur?.enabled ?? true;
  if (cur && curConf) {
    const live = cur.verdict === "VOTED";
    push("curation", live ? "curator-live" : "curator-armed",
      live
        ? `voted ${cur.voted?.length ?? 0} today (${cur.totalVotes ?? 0} total) · VP ${cur.vpEff ?? "?"}% · txid ${String(cur.txid ?? "").slice(0, 12)}`
        : `rail armed, verdict ${cur.verdict} today (VP ${cur.vpEff ?? "?"}%) — gates hold until candidates pass`,
      { votesToday: cur.votesTodayCount ?? 0, vpEff: cur.vpEff ?? null, verdict: cur.verdict });
  } else if (fuel?.curationOps === 0 && fuel?.authorOps === 0) {
    push("curation", "dormant-noted", "no reward ops in window — fuel rail dormant (content/curation is a manual-judgment rail; engine reports, operator decides policy)", null);
  }

  const spreadRec = decisions.find((d) => d.kind === "book-depth")?.action?.spreadBpsRec ?? null;
  const out = { at: now, decisions, spreadBpsRec: spreadRec, book: depth.ok ? { bestAsk: depth.bestAsk, bestBid: depth.bestBid, spreadBps: depth.spreadBps } : null };
  writeJson(INTEL_FILE, out);
  return out;
}

export function intelState() { return readJson(INTEL_FILE, null); }
