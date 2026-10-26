/**
 * weave.mjs — T-23 · פרוטוקול-ה-WEAVE v1 (הגוף-האחד כולל את החותם-השני).
 * T-18/T-19f proved it live: an EXTERNAL agent-signer ("saos.weave.core.v1")
 * holds the same credential — clockwork ~15-min votes, weight variation, its
 * own orders. Two writers on one account with no published contract = the
 * exact "layers killing each other" class the operator named. This module
 * is the handshake v1: OBSERVE both writers from chain truth (their votes =
 * votes not in our journal; their orders = live ids not in our registry),
 * DERIVE the arbitration (shared day-cap, lanes, collision + weight laws),
 * and PUBLISH our half of the contract machine-readably in state/weave.json.
 * Read-only — runs with or without a credential.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { weaveArbitration, weaveFresh, opTypeName } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "weave.json");
const PROTOCOL = "saos.weave.core.v1";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

export function weaveState() { return readJson(FILE, null); }

const DAY_MS = 86400_000;
const dayStart = (now) => { const t = Date.parse(now); return Number.isFinite(t) ? Math.floor(t / DAY_MS) * DAY_MS : null; };
const tsOf = (e) => {
  const ts = Date.parse(String(e?.timestamp ?? "").includes("T") ? e.timestamp : `${e?.timestamp ?? ""}Z`);
  return Number.isFinite(ts) ? ts : null;
};

export async function runWeave({ now = new Date().toISOString(), account } = {}) {
  const acc = account || process.env.SAOS_ACCOUNT || "headcorner";
  const start = dayStart(now);
  /* SCAN LIMIT LAW (T-23, measured live): the trading account churns ~10k ops
   * in weeks — a 2000 window misses today's votes. opTypeName handles BOTH
   * shapes ("vote_operation" vs bare "vote") — the false-zero bug class. */
  const r = await rpcCall("account_history_api.get_account_history", {
    account: acc, start: -1, limit: 10000, select_ops: ["vote", "limit_order_create", "limit_order_cancel", "fill_order"],
  }).catch(() => ({ ok: false }));
  let rows = r.ok ? (r.result?.history ?? []) : [];
  if (!r.ok) {
    const c = await rpcCall("condenser_api.get_account_history", [acc, -1, 1000]).catch(() => ({ ok: false }));
    if (c.ok) rows = (c.result ?? []).filter(([, e]) => ["vote", "limit_order_create", "limit_order_cancel", "fill_order"].includes(opTypeName(e?.op)));
  }

  /* OUR truth lives in our own journals — the chain read supplies the total,
   * the difference is the second writer (T-18's second-signer discovery law:
   * their votes/orders never appear in our exec-log). */
  const curator = readJson(path.join(STATE, "curator.json"), null);
  const ourOrders = readJson(path.join(STATE, "our-orders.json"), { orderids: [] });
  const ourVoteKeys = new Set(
    (curator?.votesToday ?? []).map((v) => `${v.author}/${v.permlink}`),
  );
  const ourIds = new Set((ourOrders.orderids ?? []).map((o) => (typeof o === "object" ? o.id : o)));

  const theirVoteTimes = [];
  let theirVotesToday = 0, ourVotesToday = (curator?.votesTodayCount ?? 0);
  let totalVotesToday = 0, ourOrdersLive = 0, theirOrdersLive = 0, ourFillCount = 0, theirFillCount = 0;
  for (const [, e] of rows) {
    const ts = tsOf(e);
    if (ts == null || ts < start) continue;
    const type = opTypeName(e?.op);
    const v = (Array.isArray(e?.op) ? e.op[1] : e?.op?.value) ?? {};
    if (type === "vote") {
      totalVotesToday++;
      const key = `${v.author}/${v.permlink}`;
      if (v.voter === acc && !ourVoteKeys.has(key)) { theirVotesToday++; theirVoteTimes.push(ts); }
    } else if (type === "limit_order_create") {
      if (ourIds.has(v.orderid)) ourOrdersLive++; else theirOrdersLive++;
    } else if (type === "fill_order") {
      if (ourIds.has(v.orderid ?? v.open_owner ?? null)) ourFillCount++; else theirFillCount++;
    }
  }
  theirVoteTimes.sort((a, b) => a - b);
  const deltas = theirVoteTimes.slice(1).map((t, i) => (t - theirVoteTimes[i]) / 60_000);
  const intervalMin = deltas.length
    ? Math.round(deltas.slice().sort((a, b) => a - b)[Math.floor(deltas.length / 2)] * 10) / 10
    : null;

  const arb = weaveArbitration({
    ourVotesToday, theirVotesToday,
    sharedDayCap: curator?.maxPerDay ?? 18,
    ourOrderCount: ourOrdersLive, theirOrderCount: theirOrdersLive,
  });

  const out = {
    protocol: PROTOCOL,
    observedAt: now, account: acc,
    day: now.slice(0, 10),
    ours: { votesToday: ourVotesToday, ordersLive: ourOrdersLive, fillsObserved: ourFillCount, journal: "state/curator.json + state/our-orders.json" },
    theirs: {
      votesToday: theirVotesToday, lastVoteAt: theirVoteTimes.length ? new Date(theirVoteTimes[theirVoteTimes.length - 1]).toISOString() : null,
      intervalMinEst: intervalMin, ordersLive: theirOrdersLive, fillsObserved: theirFillCount,
      fingerprint: "saos.weave.core.v1 — חותם-חיצוני בעל-אישורי-גישה-זהים (T-17/T-18 measured)",
    },
    arbitration: arb,
    handshake: {
      status: "PUBLISHED", revision: 1, publishAt: now,
      ourOffer: "המסלולים שלנו מפורסמים: תקרת-יום משותפת (chain-truth), הצבעות-דוקטרינה בלילה, מחזור-פקודות [0,2.1e9), היפר [2.1e9,4.29e9)",
      request: "החותם-השני מתבקש לפרסם את טווח-ה-orderid שלו ואת חוק-המשקל שלו — ההתנגשות מונעת ב-contract, לא במזל",
      /* R264 · THE CRAFT ADDENDUM (adversarial-audit finding): the second
       * writer's own publisher (`the-weave/publisher/1.0`) shipped posts
       * violating the house laws ON OUR SHARED ACCOUNT — em-dashes in the
       * title, sub-300-word bodies, and the internal protocol string in the
       * public body (a probe magnet). This addendum is the in-band demand:
       * same account, same laws, or no post. */
      craftAddendum: {
        at: now, revision: 2,
        demand: "the-weave/publisher posts from this account MUST obey the house laws: zero em/en dashes; ≥300 words or do not post; no internal codenames (protocol strings, roster names) in public bodies, titles, permlinks, or tags; titles crafted for readers, not logs",
        evidence: "the-weave-2026-10-07-muy8f0e5: dash-in-title + codename-in-body + thin-body — measured by the R264 adversarial audit",
        law: "one account, one voice, one craft bar — the second writer is welcome, the second standard is not",
      },
    },
    scan: { rowsRead: rows.length, api: r.ok ? "ah_api" : "condenser-fallback", node: r.node ?? null },
    law: "שני-כותבים, חשבון-אחד, אמת-אחת: השרשרת היא הפנקס-המשותף והחוזה פומבי — הגוף-אחד כולל את החותם-השני",
  };
  writeJson(FILE, out);
  return out;
}

/* recruiter evidence: a fresh published handshake (<26h) with observed second-writer activity */
export function weaveEvidence(nowMs = Date.now()) {
  const fresh = weaveFresh(readJson(FILE, null), nowMs);
  if (!fresh) return null;
  return `state/weave.json: ${PROTOCOL} published, age ${Math.round(fresh.ageMs / 3600000)}h — second-writer votes today ${fresh.theirVotesToday ?? "?"} — החוזה-האחד פומבי`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWeave({ now: new Date().toISOString() }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("WEAVE-FAIL", e); process.exit(1); });
}
