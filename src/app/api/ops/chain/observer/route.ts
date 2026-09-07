import { NextRequest, NextResponse } from "next/server";

import { getLiveAccount } from "@/lib/steem/steem-live";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/chain/observer?username=… — read-only chain observation.
// This is the "מהצד" (from the side) view: everything the chain itself can
// tell us about what the operator's key did and can do — WITHOUT ever seeing
// the key. Sources (all public RPC, read-only):
//   - getLiveAccount()            → state strip (balances/RC/yield/security)
//   - condenser_api.get_accounts  → authority PUBLIC keys (posting/active/memo)
//                                    for in-browser fingerprint matching
//   - condenser_api.get_account_history → parsed Hebrew timeline of recent ops
//     with signing-role attribution (posting / active / chain-virtual)
// Iron law: public keys only. Nothing here ever touches a secret.
// In-memory cache 30s per username — history does not change faster.
// ─────────────────────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9][a-z0-9.-]{1,25}$/;
const RPC_URL = "https://api.steemit.com";
const CACHE_TTL_MS = 30_000;
const HISTORY_LIMIT = 60;

let rpcId = 4100;

async function rpc<T>(method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
    if (json.result === undefined) throw new Error(`${method}: empty result`);
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

function num(asset: string | undefined | null): number {
  if (!asset) return 0;
  return parseFloat(asset.split(" ")[0]) || 0;
}

// ── Timeline parsing (chain op → Hebrew row) ─────────────────────────────────

export type OpRole = "posting" | "active" | "chain" | "signed";

export interface ObserverOp {
  idx: number;
  block: number;
  ts: string; // ISO (UTC, as chain reports)
  type: string; // raw chain op type
  label: string; // Hebrew short label
  summary: string; // Hebrew one-liner
  role: OpRole; // who must sign (chain = virtual/reward row)
  spEst: number | null; // VESTS rows → ≈SP (vest2sp), else null
  trxId: string | null; // for steemscan transaction links (non-virtual ops)
}

interface HistEntry {
  block: number;
  op: [string, Record<string, unknown>];
  timestamp: string;
  virtual_op?: number;
  trx_id?: string;
}

//
// condenser_api.get_account_history entries ship virtual_op but NOT
// required_*_auths, so role attribution = virtual flag + Steem's fixed
// op→authority table (whitepaper). Unknown signed ops → "signed" (generic).
const POSTING_OPS = new Set([
  "vote",
  "comment",
  "delete_comment",
  "custom_json",
  "claim_reward_balance",
  "account_update2",
  "feed_publish",
]);
const ACTIVE_OPS = new Set([
  "transfer",
  "transfer_to_vesting",
  "transfer_to_savings",
  "withdraw_vesting",
  "set_withdraw_vesting_route",
  "delegate_vesting_shares",
  "claim_account",
  "account_update",
  "account_witness_vote",
  "account_witness_voting",
  "witness_set_properties",
  "convert",
  "limit_order_create",
  "limit_order_create2",
  "limit_order_cancel",
  "proposal_vote",
  "escrow_transfer",
]);

function roleOf(e: HistEntry): OpRole {
  if ((e.virtual_op ?? 0) > 0) return "chain"; // virtual_op is a counter, not boolean (observed: 1,3,…)
  const type = e.op[0];
  if (POSTING_OPS.has(type)) return "posting";
  if (ACTIVE_OPS.has(type)) return "active";
  return "signed";
}

function vestsToSp(v: unknown, vest2sp: number): number {
  const n = typeof v === "string" ? num(v) : Number(v) || 0;
  return n * vest2sp;
}

function permlinkShort(p: unknown): string {
  const s = typeof p === "string" ? p : "";
  return s.length > 42 ? `${s.slice(0, 42)}…` : s;
}

function parseOp(
  e: HistEntry,
  vest2sp: number,
): ObserverOp {
  const [type, b] = e.op;
  const role = roleOf(e);
  let label = type;
  let summary = "";
  let spEst: number | null = null;

  switch (type) {
    case "claim_reward_balance": {
      label = "תביעת פרסים";
      // Account history names the field reward_vests (not reward_vesting_balance).
      const vests = String(b.reward_vests ?? "0.000000 VESTS");
      spEst = vestsToSp(vests, vest2sp);
      const parts: string[] = [];
      if (num(String(b.reward_steem)) > 0) parts.push(`${b.reward_steem} STEEM`);
      if (num(String(b.reward_sbd)) > 0) parts.push(`${b.reward_sbd} SBD`);
      if (num(vests) > 0) parts.push(`${vests} (≈${spEst.toFixed(3)} SP)`);
      summary = parts.length ? `נתבעו והופקו ל-SP: ${parts.join(" · ")}` : "תביעה ריקה (איפוס)";
      break;
    }
    case "vote": {
      label = "הצבעה";
      const w = Number(b.weight ?? 0);
      summary = `${(w / 100).toFixed(0)}% עבור @${b.author}/${permlinkShort(b.permlink)}`;
      break;
    }
    case "curation_reward": {
      label = "פרס אצירה";
      spEst = vestsToSp(b.reward, vest2sp);
      summary = `+${b.reward} (≈${spEst.toFixed(3)} SP) מ-@${b.comment_author}/${permlinkShort(b.comment_permlink)}`;
      break;
    }
    case "author_reward": {
      label = "פרס מחבר";
      spEst = vestsToSp(b.vesting_payout, vest2sp);
      summary = `${b.sbd_payout ?? ""} ${b.steem_payout ?? ""} +${b.vesting_payout ?? ""} על ${permlinkShort(b.permlink)}`.trim();
      break;
    }
    case "transfer": {
      label = "העברה";
      summary = `${b.amount} מ-@${b.from} אל @${b.to}`;
      if (typeof b.memo === "string" && b.memo.trim()) summary += " · מצורפת הערה";
      break;
    }
    case "transfer_to_vesting": {
      label = "Power Up";
      summary = `${b.amount} הומרו ל-SP`;
      break;
    }
    case "withdraw_vesting": {
      label = "Power Down";
      spEst = vestsToSp(b.vesting_shares, vest2sp);
      summary = `הוצאה נשלפת של ${b.vesting_shares} (≈${spEst.toFixed(3)} SP) ל-13 שבועות`;
      break;
    }
    case "delegate_vesting_shares": {
      label = "האצלת SP";
      spEst = vestsToSp(b.vesting_shares, vest2sp);
      summary = `${b.vesting_shares} (≈${spEst.toFixed(3)} SP) → @${b.delegatee}`;
      break;
    }
    case "return_vesting_delegation": {
      label = "האצלה חזרה";
      spEst = vestsToSp(b.vesting_shares, vest2sp);
      summary = `${b.vesting_shares} (≈${spEst.toFixed(3)} SP) חזרו לחשבון`;
      break;
    }
    case "claim_account": {
      label = "יצירת זכאות חשבון";
      summary = `זכאות claim_account של ${b.fee} (מענק RC, ללא תשלום)`;
      break;
    }
    case "account_update": {
      label = "עדכון חשבון";
      summary = "שינוי הרשאות/מפתחות או פרופיל";
      break;
    }
    case "account_create_with_delegation": {
      label = "יצירת חשבון";
      summary = `חשבון חדש @${b.new_account}`;
      break;
    }
    case "comment": {
      label = typeof b.parent_author === "string" && b.parent_author ? "תגובה" : "פרסום";
      summary = `${permlinkShort(b.permlink)}${b.title ? ` — "${String(b.title).slice(0, 40)}"` : ""}`;
      break;
    }
    case "witness_vote":
      label = "הצבעת עד";
      summary = `+@${b.witness}`;
      break;
    case "account_witness_vote": {
      const approve = Boolean(b.approve);
      label = approve ? "הצבעת עד" : "ביטול הצבעת עד";
      summary = `${approve ? "+" : "−"}@${b.witness}`;
      break;
    }
    case "convert": {
      label = "המרת SBD";
      summary = `${b.amount} → STEEM בתוך ~3.5 ימים`;
      break;
    }
    case "custom_json": {
      label = "פעולת מערכת";
      summary = `${b.id ?? ""}`.slice(0, 50);
      break;
    }
    case "interest":
      label = "ריבית SBD";
      summary = `${b.interest ?? ""}`;
      break;
    case "fill_order":
      label = "פועל שוק";
      summary = "עסקת המרה בוצעה בשוק הפנימי";
      break;
    case "transfer_to_savings":
      label = "חיסכון";
      summary = `${b.amount} → חיסכון`;
      break;
    case "fill_vesting_withdraw":
      label = "שבוע Power Down";
      spEst = vestsToSp(b.withdrawn, vest2sp);
      summary = `${b.withdrawn} (≈${spEst.toFixed(3)} SP) שוחררו`;
      break;
    default:
      summary = JSON.stringify(b).slice(0, 90);
      break;
  }

  const trx = e.trx_id;
  return {
    idx: 0, // caller patches
    block: e.block,
    ts: e.timestamp,
    type,
    label,
    summary,
    role,
    spEst,
    trxId: trx && !/^0+$/.test(trx) ? trx : null,
  };
}

// ── Module cache ─────────────────────────────────────────────────────────────

interface CacheRow {
  t: number;
  data: unknown;
}
const cache = new Map<string, CacheRow>();

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "headcorner")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ ok: false, error: "שם משתמש לא תקין" }, { status: 400 });
  }

  const hit = cache.get(username);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) {
    return NextResponse.json(hit.data);
  }

  const [liveRes, authRes, histRes] = await Promise.allSettled([
    getLiveAccount(username),
    rpc<
      {
        posting: { key_auths: [string, number][]; account_auths: [string, number][] };
        active: { key_auths: [string, number][]; account_auths: [string, number][] };
        memo_key: string;
      }[]
    >("condenser_api.get_accounts", [[username]]),
    rpc<[number, HistEntry][]>("condenser_api.get_account_history", [username, -1, HISTORY_LIMIT]),
  ]);

  const live = liveRes.status === "fulfilled" && liveRes.value.ok ? liveRes.value : null;
  const acc = authRes.status === "fulfilled" ? authRes.value[0] : undefined;
  const hist = histRes.status === "fulfilled" ? histRes.value : undefined;

  if (!live && !acc && !hist) {
    return NextResponse.json(
      { ok: false, error: "כל צמתי ה-RPC לא הגיבו — נסה שוב" },
      { status: 502 },
    );
  }

  const vest2sp = live?.chain.vest2sp ?? 0;

  const authorities = acc
    ? {
        posting: acc.posting.key_auths[0]?.[0] ?? null,
        active: acc.active.key_auths[0]?.[0] ?? null,
        memo: acc.memo_key ?? null,
        postingApps: acc.posting.account_auths.map(([a]) => a),
      }
    : null;

  const timeline: ObserverOp[] = (hist ?? [])
    .slice()
    .sort((a, b) => a[0] - b[0]) // ascending: oldest → newest
    .map(([idx, e]) => {
      const op = parseOp(e, vest2sp);
      op.idx = idx;
      return op;
    })
    .reverse(); // newest first — the timeline renders top-down

  const payload = {
    ok: true as const,
    username,
    fetchedAt: new Date().toISOString(),
    state: live
      ? {
          chain: live.chain,
          balances: live.balances,
          power: live.power,
          yield: live.yield,
          securityScore: live.security.score,
          staleAuths: live.security.staleAuths,
        }
      : null,
    authorities,
    timeline,
  };

  cache.set(username, { t: Date.now(), data: payload });
  return NextResponse.json(payload);
}
