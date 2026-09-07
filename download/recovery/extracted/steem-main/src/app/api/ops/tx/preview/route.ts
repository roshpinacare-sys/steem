import { NextRequest, NextResponse } from "next/server";
import { fetchDexSnapshot } from "@/lib/steem/saos-dex";

export const dynamic = "force-dynamic";

/**
 * Console v3 — transaction PREVIEW builder (docs/CONSOLE_PLAN.md §7 v3).
 *
 * The server assembles the exact operation payloads from live chain data and
 * validates amounts against real balances. It NEVER touches keys: the browser
 * signs via src/lib/steem/sign.ts and broadcasts browser → public RPC.
 * Output op tuples are plain JSON the browser passes to steem.broadcast.
 *
 * POST { username, action, params }
 *   action=claim          → claim_reward_balance (posting) — exact pending amounts
 *   action=claim_account  → claim_account fee=0 STEEM (active) — RC factory test
 *   action=power_down     → withdraw_vesting (active) — params {percent} | {cancel}
 *   action=power_up       → transfer_to_vesting (active) — params {amount}
 *   action=transfer       → transfer (active) — params {to, amount, asset, memo}
 *   action=witness_unvote → account_witness_vote×N (active) — params {witnesses}
 *   action=saos_ping     → custom_json id="saos" (posting) — FREE zero-fee
 *                          protocol heartbeat: the first on-chain op of the
 *                          SAOS-1 virtual-token bus (Task 27).
 *   action=saos_mint     → custom_json id="saos" (posting) — SAOS-1 issuance
 *                          on the feeless bus (Task 28).
 *   action=saos_burn     → custom_json id="saos" (posting) — SAOS-1 burn: the
 *                          redemption sink. Revenue share burns supply, raising
 *                          the measured backing per remaining token (Task 30).
 *   action=saos_order    → custom_json id="saos" (posting) — DEX limit order on
 *                          the feeless bus: params {side, price, amount}; the
 *                          server generates the unique oid (Task 31).
 *   action=saos_cancel   → custom_json id="saos" (posting) — cancel own DEX
 *                          order: params {oid} (Task 31).
 *   action=saos_fill     → custom_json id="saos" (posting) — taker fill of a
 *                          resting order at the maker's price: params {oid,
 *                          amount, taker?} (Task 31).
 *   action=saos_escrow   → transfer (active) — real STEEM escrow into the DEX
 *                          credit rail: issuer→issuer memo "saos:escrow",
 *                          params {amount} (Task 31).
 *   action=saos_withdraw → transfer (active) — settle DEX STEEM credit to a
 *                          real on-chain transfer: memo "saos:withdraw:<to>",
 *                          params {to, amount} (Task 31).
 *   action=saos_announce → comment (posting) — publish the SAOS-1 protocol
 *                          spec as a root post built from LIVE chain data
 *                          (genesis, supply, book, escrow rails) — the public
 *                          face of the empire (Task 32).
 */

const RPC_URL = "https://api.steemit.com";
const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;

let rpcId = 1200;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
  if (json.result === undefined) throw new Error(`${method}: empty result`);
  return json.result;
}

interface RawAccount {
  balance: string;
  sbd_balance: string;
  vesting_shares: string;
  received_vesting_shares: string;
  delegated_vesting_shares: string;
  reward_steem_balance: string;
  reward_sbd_balance: string;
  reward_vesting_balance: string;
  witness_votes: string[];
  to_withdraw: string;
  withdrawn: string;
  next_vesting_withdrawal: string;
}
interface Dgp {
  total_vesting_fund_steem: string;
  total_vesting_shares: string;
}

function num(asset: string | undefined | null): number {
  if (!asset) return 0;
  return parseFloat(asset.split(" ")[0]) || 0;
}
function fmt(amount: number, unit: string): string {
  const decimals = unit === "VESTS" ? 6 : 3;
  return `${amount.toFixed(decimals)} ${unit}`;
}

export interface PreviewResponse {
  ok: boolean;
  error?: string;
  username?: string;
  action?: string;
  requiredRole?: "posting" | "active";
  ops?: [string, Record<string, unknown>][];
  summary?: string;
  warnings?: string[];
  context?: {
    steem: number;
    sbd: number;
    spOwn: number;
    spIn: number;
    spDelegatedOut: number;
    pendingSteem: number;
    pendingSbd: number;
    pendingSp: number;
    vest2sp: number;
    steemUsd: number;
    witnessVotes: string[];
    powerDownActive: boolean;
  };
}

export async function POST(req: NextRequest) {
  let body: {
    username?: string;
    action?: string;
    params?: Record<string, unknown>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const username = (body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  const action = (body.action ?? "").trim();
  const params = body.params ?? {};

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ ok: false, error: "שם משתמש לא תקין" }, { status: 400 });
  }

  try {
    const [rawAcc] = await rpc<RawAccount[]>("condenser_api.get_accounts", [[username]]);
    if (!rawAcc) {
      return NextResponse.json(
        { ok: false, error: `חשבון ${username} לא נמצא ברשת` },
        { status: 400 },
      );
    }
    const dgp = await rpc<Dgp>("condenser_api.get_dynamic_global_properties", []);
    const vest2sp = num(dgp.total_vesting_fund_steem) / num(dgp.total_vesting_shares);

    const liquidSteem = num(rawAcc.balance);
    const sbd = num(rawAcc.sbd_balance);
    const ownVests = num(rawAcc.vesting_shares);
    const spIn = num(rawAcc.received_vesting_shares) * vest2sp;
    const spOwn = ownVests * vest2sp;
    const spDelegatedOut = num(rawAcc.delegated_vesting_shares) * vest2sp;
    const pendingSteem = num(rawAcc.reward_steem_balance);
    const pendingSbd = num(rawAcc.reward_sbd_balance);
    const pendingSp = num(rawAcc.reward_vesting_balance) * vest2sp;
    const powerDownActive = !rawAcc.next_vesting_withdrawal.startsWith("1969");

    const context: NonNullable<PreviewResponse["context"]> = {
      steem: liquidSteem,
      sbd,
      spOwn,
      spIn,
      spDelegatedOut,
      pendingSteem,
      pendingSbd,
      pendingSp,
      vest2sp,
      steemUsd: 0,
      witnessVotes: rawAcc.witness_votes ?? [],
      powerDownActive,
    };

    const response: PreviewResponse = {
      ok: true,
      username,
      action,
      requiredRole: "posting",
      ops: [],
      summary: "",
      warnings: [],
      context,
    };

    switch (action) {
      case "claim": {
        response.requiredRole = "posting";
        const hasPending =
          pendingSteem > 1e-6 || pendingSbd > 1e-6 || num(rawAcc.reward_vesting_balance) > 1e-6;
        if (!hasPending) {
          return NextResponse.json(
            { ok: false, error: "אין פרסים ממתינים לתביעה — הכל נתבע כבר" },
            { status: 400 },
          );
        }
        response.ops = [
          [
            "claim_reward_balance",
            {
              account: username,
              reward_steem: rawAcc.reward_steem_balance,
              reward_sbd: rawAcc.reward_sbd_balance,
              reward_vests: rawAcc.reward_vesting_balance,
            },
          ],
        ];
        response.summary = `תביעת פרסים ממתינים: ${pendingSp.toFixed(3)} SP + ${pendingSteem.toFixed(3)} STEEM + ${pendingSbd.toFixed(3)} SBD`;
        response.warnings = ["פעולת posting-key בטוחה — אינה מעבירה כספים"];
        break;
      }

      case "saos_ping": {
        // Task 27 — the zero-fee protocol bus: a real custom_json op with id
        // "saos". No fee, no funds moved — only RC. This is the genesis op of
        // the SAOS-1 virtual-token ledger (the chain never knew it could host
        // a token protocol for free).
        response.requiredRole = "posting";
        const now = new Date().toISOString();
        const payload = {
          protocol: "saos/v1",
          action: "ping",
          account: username,
          time: now,
          note: "SAOS-1 genesis heartbeat — feeless custom_json bus",
        };
        response.ops = [
          [
            "custom_json",
            {
              required_auths: [],
              required_posting_auths: [username],
              id: "saos",
              json: JSON.stringify(payload),
            },
          ],
        ];
        response.summary =
          "פעימת SAOS-1 הראשונה — custom_json עם id=saos, עמלת רשת 0 (עולה רק RC). הפעולה חתומה בדפדפן שלך ונרשמת בשרשרת לנצח.";
        response.warnings = [
          "פעולת posting-key בטוחה — אינה מעבירה כספים ואינה שינוי הרשאות",
          "ניתן לאמת אחר-כך ב-steemscan לפי ה-txid",
        ];
        break;
      }

      case "saos_mint": {
        // Task 28 — SAOS-1 mint: a real token issuance on the feeless bus.
        // params { amount, reason, ref? } — signed by the operator's posting
        // key; the ledger replay endpoint credits the receiver from history.
        response.requiredRole = "posting";
        const amount = Math.round(Number((params as { amount?: number }).amount ?? 0) * 1000) / 1000;
        const reason = String((params as { reason?: string }).reason ?? "").slice(0, 90) || "manual reward";
        const ref = String((params as { ref?: string }).ref ?? "").slice(0, 80);
        if (!(amount > 0) || amount > 100000) {
          return NextResponse.json(
            { ok: false, error: "כמות SAOS-1 לא חוקית (חייבת 0 < amount ≤ 100000)" },
            { status: 400 },
          );
        }
        const payload = {
          protocol: "saos/v1",
          action: "mint",
          to: username,
          amount,
          reason,
          ...(ref ? { ref } : {}),
        };
        response.ops = [
          [
            "custom_json",
            {
              required_auths: [],
              required_posting_auths: [username],
              id: "saos",
              json: JSON.stringify(payload),
            },
          ],
        ];
        response.summary = `הנפקת ${amount} SAOS-1 ל-${username} (${reason}) — עמלת רשת 0, הספר נגזר מהשרשרת`;
        response.warnings = [
          "פעולת posting-key בטוחה — אינה מעבירה כספים; המינט נרשם לנצח על האוטובוס id=\"saos\"",
        ];
        break;
      }

      case "saos_burn": {
        // Task 30 — the redemption sink of the SAOS-1 value loop: burning
        // removes tokens from supply forever, so every unit of engine revenue
        // routed to buyback raises the backing per remaining token. The burn
        // is visible in the deterministic ledger replay immediately.
        response.requiredRole = "posting";
        const burnAmount =
          Math.round(Number((params as { amount?: number }).amount ?? 0) * 1000) / 1000;
        const burnReason =
          String((params as { reason?: string }).reason ?? "").slice(0, 90) || "revenue buyback";
        if (!(burnAmount > 0) || burnAmount > 100000) {
          return NextResponse.json(
            { ok: false, error: "כמות SAOS-1 לשריפה לא חוקית (חייבת 0 < amount ≤ 100000)" },
            { status: 400 },
          );
        }
        const burnPayload = {
          protocol: "saos/v1",
          action: "burn",
          from: username,
          amount: burnAmount,
          reason: burnReason,
        };
        response.ops = [
          [
            "custom_json",
            {
              required_auths: [],
              required_posting_auths: [username],
              id: "saos",
              json: JSON.stringify(burnPayload),
            },
          ],
        ];
        response.summary = `שריפת ${burnAmount} SAOS-1 (${burnReason}) — ההיצע יורד לנצח, הגיבוי לטוקן שנותר עולה`;
        response.warnings = [
          "פעולת posting-key בטוחה — אינה מעבירה כספים; שריפה סופית ובלתי הפיכה",
        ];
        break;
      }

      case "saos_order": {
        // Task 31 — DEX limit order on the feeless bus. sell locks SAOS-1 in
        // the replayed book; buy locks DEX STEEM credit. The chain is the
        // final judge: the replay invalidates orders with insufficient funds.
        response.requiredRole = "posting";
        const side = params.side === "buy" ? "buy" : params.side === "sell" ? "sell" : null;
        const price = Math.round(Number((params as { price?: number }).price ?? 0) * 1e6) / 1e6;
        const amount = Math.round(Number((params as { amount?: number }).amount ?? 0) * 1000) / 1000;
        if (!side) {
          return NextResponse.json({ ok: false, error: "side חייב להיות sell או buy" }, { status: 400 });
        }
        if (!(price > 0) || price > 1e6) {
          return NextResponse.json({ ok: false, error: "מחיר לא חוקי (חייב 0 < price ≤ 1e6 STEEM/SAOS)" }, { status: 400 });
        }
        if (!(amount > 0) || amount > 1e6) {
          return NextResponse.json({ ok: false, error: "כמות לא חוקית (חייבת 0 < amount ≤ 1e6 SAOS-1)" }, { status: 400 });
        }
        const oid = `${username}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const orderPayload = {
          protocol: "saos/v1",
          action: "order",
          oid,
          side,
          price,
          amount,
          account: username,
          time: new Date().toISOString(),
        };
        response.ops = [
          [
            "custom_json",
            {
              required_auths: [],
              required_posting_auths: [username],
              id: "saos",
              json: JSON.stringify(orderPayload),
            },
          ],
        ];
        response.summary =
          side === "sell"
            ? `הזמנת מכירה: ${amount} SAOS-1 @ ${price} STEEM — הספר נגזר מהשרשרת, עמלה 0`
            : `הזמנת קניה: ${amount} SAOS-1 @ ${price} STEEM — נעולה מקרדיט הדקס, עמלה 0`;
        response.warnings = [
          "פעולת posting-key בטוחה — אינה מעבירה כספים",
          "כשההזמנה מתמלאת ה-SAOS-1 וה-STEEM-קרדיט זזים בספר הנגזר מהשרשרת בעסקה אחת",
        ];
        break;
      }

      case "saos_cancel": {
        response.requiredRole = "posting";
        const oid = String((params as { oid?: string }).oid ?? "").slice(0, 80);
        if (!oid) {
          return NextResponse.json({ ok: false, error: "חסר מזהה הזמנה (oid)" }, { status: 400 });
        }
        response.ops = [
          [
            "custom_json",
            {
              required_auths: [],
              required_posting_auths: [username],
              id: "saos",
              json: JSON.stringify({
                protocol: "saos/v1",
                action: "cancel",
                oid,
                account: username,
                time: new Date().toISOString(),
              }),
            },
          ],
        ];
        response.summary = `ביטול הזמנה ${oid} — היתרה הנעולה חוזרת לספר מיד`; 
        response.warnings = ["פעולת posting-key בטוחה — אינה מעבירה כספים"];
        break;
      }

      case "saos_fill": {
        response.requiredRole = "posting";
        const fillOid = String((params as { oid?: string }).oid ?? "").slice(0, 80);
        const taker = String((params as { taker?: string }).taker ?? username)
          .trim().replace(/^@/, "").toLowerCase() || username;
        const fillAmount = Math.round(Number((params as { amount?: number }).amount ?? 0) * 1000) / 1000;
        if (!fillOid) {
          return NextResponse.json({ ok: false, error: "חסר מזהה הזמנה (oid)" }, { status: 400 });
        }
        if (!(fillAmount > 0) || fillAmount > 1e6) {
          return NextResponse.json({ ok: false, error: "כמות מילוי לא חוקית" }, { status: 400 });
        }
        response.ops = [
          [
            "custom_json",
            {
              required_auths: [],
              required_posting_auths: [username],
              id: "saos",
              json: JSON.stringify({
                protocol: "saos/v1",
                action: "fill",
                oid: fillOid,
                taker,
                amount: fillAmount,
                time: new Date().toISOString(),
              }),
            },
          ],
        ];
        response.summary = `מילוי ${fillAmount} SAOS-1 מההזמנה ${fillOid} במחיר ה-maker — עמלה 0`;
        response.warnings = [
          "פעולת posting-key בטוחה — אינה מעבירה כספים",
          "המילוי מתבצע תמיד במחיר ה-maker — אין הזדמנות לחריגה ממחיר",
        ];
        break;
      }

      case "saos_escrow": {
        // Real STEEM escrow: the funds actually move into the issuer wallet
        // and the replay credits the DEX rail from history. Self-transfer =
        // the operator locking their own liquidity visibly on-chain.
        response.requiredRole = "active";
        const escAmount = Number((params as { amount?: number }).amount);
        if (!Number.isFinite(escAmount) || escAmount <= 0) {
          return NextResponse.json({ ok: false, error: "סכום escrow לא תקין" }, { status: 400 });
        }
        if (escAmount > liquidSteem + 1e-9) {
          return NextResponse.json(
            { ok: false, error: `אין מספיק STEEM נזיל (יש ${liquidSteem.toFixed(3)})` },
            { status: 400 },
          );
        }
        response.ops = [
          ["transfer", { from: username, to: username, amount: fmt(escAmount, "STEEM"), memo: "saos:escrow" }],
        ];
        response.summary = `נעילת ${escAmount.toFixed(3)} STEEM כ-escrow לדקס (העברה עצמית גלויה בשרשרת, עמלה 0)`;
        response.warnings = [
          "ההעברה עצמית לא מוציאה כסף מהחשבון — היא נועלת אותו לנזילות-הדקס באופן גלוי לכולם",
          "פדיון חזרה לנזילות = saos_withdraw (מתועד באותו ספר)",
        ];
        break;
      }

      case "saos_withdraw": {
        // DEX settlement: the issuer pays a real on-chain transfer and the
        // replay debits the receiver's STEEM credit — solvency stays provable.
        response.requiredRole = "active";
        const wdTo = String((params as { to?: string }).to ?? "").trim().replace(/^@/, "").toLowerCase();
        const wdAmount = Number((params as { amount?: number }).amount);
        if (!USERNAME_RE.test(wdTo)) {
          return NextResponse.json({ ok: false, error: "כתובת יעד לא תקינה" }, { status: 400 });
        }
        if (!Number.isFinite(wdAmount) || wdAmount <= 0) {
          return NextResponse.json({ ok: false, error: "סכום לא תקין" }, { status: 400 });
        }
        if (wdAmount > liquidSteem + 1e-9) {
          return NextResponse.json(
            { ok: false, error: `אין מספיק STEEM נזיל בארנק המנפיק (יש ${liquidSteem.toFixed(3)})` },
            { status: 400 },
          );
        }
        response.ops = [
          ["transfer", { from: username, to: wdTo, amount: fmt(wdAmount, "STEEM"), memo: `saos:withdraw:${wdTo}` }],
        ];
        response.summary = `פדיון ${wdAmount.toFixed(3)} STEEM מקרדיט הדקס אל @${wdTo} — המזכר מתעד את הסילוק`;
        response.warnings = [
          "העברה סופית — בדוק את כתובת היעד פעמיים",
          "הספר יחסיב את הקרדיט של היעד בריפליי הבא",
        ];
        break;
      }

      case "saos_announce": {
        // Task 32 — the protocol's public face: a root post whose content is
        // generated from LIVE chain measurements (genesis, supply, backing
        // engine, book stats, escrow rails). The DEX escrow rails accept
        // deposits from ANY account — the post is how the network learns it.
        response.requiredRole = "posting";
        const annRpc = async <T,>(method: string, params: unknown): Promise<T> => {
          const res = await fetch(RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 77 }),
            cache: "no-store",
          });
          const json = (await res.json()) as { result?: T; error?: { message?: string } };
          if (json.error) throw new Error(json.error.message ?? "RPC error");
          return json.result as T;
        };
        // Cheap bounded scan: genesis + supply from the first history pages.
        let genesisTrx = "";
        let genesisBlock = 0;
        let annSupply = 0;
        try {
          let start: number | string = -1;
          for (let p = 0; p < 3 && !genesisTrx; p++) {
            const raw = await annRpc<[number, { block: number; trx_id?: string; op: [string, Record<string, unknown>] }][]>(
              "condenser_api.get_account_history",
              [username, start, 100],
            );
            if (!Array.isArray(raw) || raw.length === 0) break;
            let lowest = raw[0][0];
            for (const [idx, entry] of raw) {
              lowest = Math.min(lowest, idx);
              const [type, value] = entry.op;
              if (type !== "custom_json" || value?.id !== "saos") continue;
              try {
                const pl = JSON.parse(String(value.json ?? "{}")) as { protocol?: string; action?: string; amount?: number };
                if (pl.protocol !== "saos/v1") continue;
                if (pl.action === "mint" || pl.action === "burn") annSupply += Number(pl.amount ?? 0) * (pl.action === "mint" ? 1 : -1);
                if (pl.action === "ping" && !genesisTrx) {
                  genesisTrx = entry.trx_id ?? "";
                  genesisBlock = entry.block;
                }
              } catch { /* skip */ }
            }
            if (lowest <= 0) break;
            start = lowest - 1;
          }
        } catch { /* degrade — post still builds */ }
        let bookLine = "book: (unavailable right now)";
        try {
          const dex = await fetchDexSnapshot(username);
          if (dex.ok) {
            bookLine = `book: ${dex.stats.openOrders} open · last ${dex.stats.lastPrice ?? "—"} · vol24h ${dex.stats.vol24hSaos} SAOS · coverage ${dex.solvency.coveragePct != null ? `${dex.solvency.coveragePct.toFixed(0)}%` : "—"}`;
          }
        } catch { /* degrade */ }
        const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const permlink = `saos-1-protocol-spec-${day}`;
        const title = "SAOS-1 — הטוקן והדקס בעמלה-0 שרצים על Steem עצמה";
        const genesisMd = genesisTrx
          ? `[block ${genesisBlock.toLocaleString("en-US")}](https://steemscan.com/transaction/${genesisTrx})`
          : "(גנזיס: ראו ההיסטוריה של @" + username + ")";
        const body = [
          `**SAOS-1 — virtual token + feeless DEX anchored on Steem custom_json (id=\"saos\", protocol saos/v1).**`,
          ``,
          `**מה זה?** טוקן וירטואלי שכל הספר שלו נגזר דטרמיניסטית מהיסטוריית החשבון — בלי חוזה חכם, בלי sidechain, בלי עמלות. השרשרת עצמה מאמתת כל פעולה (חתימת posting), וכל אחד יכול לחשב את היתרות מחדש.`,
          ``,
          `**עובדות חיות (נמדדו בזמן כתיבת הפוסט):**`,
          `- גנזיס: ${genesisMd}`,`- היצע: ${Math.round(annSupply * 1000) / 1000} SAOS-1`,`- ספר הזמנות: ${bookLine}`,`- גז: RC בלבד — כל פעולה עמלת רשת 0 STEEM`,``,
          `**איך מצטרפים (עמלה 0, מפתח posting):**`,
          `1. שולחים transfer STEEM אל @${username} עם מזכר \`saos:escrow\` — הסכום נרשם לזכותך בספר הדקס (escrow אמיתי, גלוי בשרשרת).`,
          `2. מנפיקים order/cancel/fill על custom_json id=\"saos\": \`{"protocol":"saos/v1","action":"order","oid":"<unique>","side":"buy","price":<STEEM-per-SAOS>,"amount":<SAOS>,"account":"<you>"}\``,
          `3. מילוי תמיד במחיר ה-maker — אין הפתעות. פדיון: המנפיק משדר transfer עם מזכר \`saos:withdraw:<you>\`.`,
          ``,
          `**כלכלה:** סוכני המערכת מרוויחים SAOS-1 על עבודה מאומתת (תביעת פרסים = 1, הצבעת אצירה = 0.1, חשבון-סוכן חדש = 5, פעימה אוטונומית = 0.1). הגיבוי = 10% ממנוע הכנסות הסולם הריבוני (אצירה + השכרת SP + טפטוף) — נמדד, לא מובטח. תמלוגים שורפים היצע: כל burn מעלה את הגיבוי לטוקן שנותר.`,
          ``,
          `**למה זה עובד:** Steem חושבת שהיא מארחת בלוג — אנחנו מניחים עליה שוק הון שלם. הספר קריא לכולם, הסולבנציה נמדדת מהשרשרת עצמה, וההצטרפות פתוחה לכל חשבון.`,
          ``,
          `*English TL;DR: SAOS-1 is a virtual token + zero-fee DEX living on Steem custom_json ops (id=\"saos\"). Ledger = deterministic replay of account history — no smart contract, no sidechain, RC gas only. Escrow via real transfers with \"saos:escrow\" memo; fills always at maker price; solvency measured on-chain. Open to every Steem account.*`,
          ``,
          `---`,
          `*פורסם על-ידי מערכת SAOS (Steem AI Agent OS) — נבנה ומנוהל אוטונומית.*`,
        ].join("\n");
        response.ops = [
          [
            "comment",
            {
              parent_author: "",
              parent_permlink: "saos",
              author: username,
              permlink,
              title,
              body,
              json_metadata: JSON.stringify({
                tags: ["saos", "steem", "blockchain", "token", "dex"],
                app: "saos-agent-os/1.0",
                format: "markdown+hebrew",
              }),
            },
          ],
        ];
        response.summary = `פרסום מפרט SAOS-1 כפוסט שורש (${permlink}) — ההכרזה הציבורית של הפרוטוקול, נבנית מנתוני שרשרת חיים`;
        response.warnings = [
          "פעולת posting-key בטוחה — אינה מעבירה כספים",
          "פוסט ציבורי לכל הרשת — זה הסמפון שדרכו מצטרפים סוחרים וסוכנים לפסי ה-escrow",
        ];
        break;
      }

      case "claim_account": {
        response.requiredRole = "active";
        response.ops = [
          ["claim_account", { creator: username, fee: "0.000 STEEM", extensions: [] }],
        ];
        response.summary =
          "claim_account עם fee=0 — תביעת זכות-יצירת-חשבון דרך תקציב ה-RC (ניסוי אמפירי: כמה RC זה עולה?)";
        response.warnings = [
          "לא מעביר כספים — צורך חלק מתקציב ה-RC; נועד למדוד את העלות האמיתית",
        ];
        break;
      }

      case "power_down": {
        response.requiredRole = "active";
        if (params.cancel === true) {
          response.ops = [
            ["withdraw_vesting", { account: username, vesting_shares: "0.000000 VESTS" }],
          ];
          response.summary = "ביטול Power Down פעיל (איפוס משיכת ה-VESTS)";
          break;
        }
        const percent = Number(params.percent);
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
          return NextResponse.json(
            { ok: false, error: "percent חייב להיות בין 0 ל-100" },
            { status: 400 },
          );
        }
        const vestsOut = ownVests * (percent / 100);
        if (vestsOut * vest2sp < 1) {
          return NextResponse.json(
            { ok: false, error: `הסכום קטן מדי (מתחת ל-1 SP עצמי; יש ${spOwn.toFixed(3)} SP)` },
            { status: 400 },
          );
        }
        const weeklySp = (vestsOut / 13) * vest2sp;
        response.ops = [
          ["withdraw_vesting", { account: username, vesting_shares: fmt(vestsOut, "VESTS") }],
        ];
        response.summary = `Power Down ${percent.toFixed(1)}% מ-SP עצמי → ${weeklySp.toFixed(2)} SP לשבוע × 13 שבועות`;
        response.warnings = [
          "13 תשלומים שבועיים אוטומטיים — ביטול אפשרי בכל רגע (cancel)",
          spIn > 0.001
            ? `יש ${spIn.toFixed(1)} SP מוקצים פנימה — אם הבקשה חורגת מה-SP העצמי היא מתקצרת אוטומטית`
            : "השחרור מוריד גם את כוח ההצבעה ותשואת הקוראציה/השכרה",
        ];
        break;
      }

      case "power_up": {
        response.requiredRole = "active";
        const amount = Number(params.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ ok: false, error: "סכום לא תקין" }, { status: 400 });
        }
        if (amount > liquidSteem + 1e-9) {
          return NextResponse.json(
            { ok: false, error: `אין מספיק STEEM נזיל (יש ${liquidSteem.toFixed(3)})` },
            { status: 400 },
          );
        }
        response.ops = [
          [
            "transfer_to_vesting",
            { from: username, to: username, amount: fmt(amount, "STEEM") },
          ],
        ];
        response.summary = `Power Up: ${amount.toFixed(3)} STEEM → +${amount.toFixed(3)} SP`;
        break;
      }

      case "transfer": {
        response.requiredRole = "active";
        const to = String(params.to ?? "").trim().replace(/^@/, "").toLowerCase();
        const amount = Number(params.amount);
        const asset = params.asset === "SBD" ? "SBD" : "STEEM";
        const memo = String(params.memo ?? "");
        if (!USERNAME_RE.test(to)) {
          return NextResponse.json({ ok: false, error: "כתובת יעד לא תקינה" }, { status: 400 });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ ok: false, error: "סכום לא תקין" }, { status: 400 });
        }
        const balance = asset === "SBD" ? sbd : liquidSteem;
        if (amount > balance + 1e-9) {
          return NextResponse.json(
            { ok: false, error: `אין מספיק ${asset} (יש ${balance.toFixed(3)})` },
            { status: 400 },
          );
        }
        if (memo.length > 2048) {
          return NextResponse.json({ ok: false, error: "מזכר ארוך מדי" }, { status: 400 });
        }
        response.ops = [["transfer", { from: username, to, amount: fmt(amount, asset), memo }]];
        response.summary = `העברה של ${amount.toFixed(3)} ${asset} אל @${to}${memo ? ` (מזכר: ${memo.slice(0, 40)})` : ""}`;
        response.warnings = ["העברה סופית — אין ביטול בשרשרת; בדוק את כתובת היעד פעמיים"];
        break;
      }

      case "witness_vote": {
        response.requiredRole = "active";
        const list = Array.isArray(params.witnesses) ? params.witnesses.map(String) : [];
        const names = [...new Set(
          list.map((w) => w.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
        )];
        if (names.length === 0) {
          return NextResponse.json(
            { ok: false, error: "לא נבחרו עדים להצבעה" },
            { status: 400 },
          );
        }
        if (names.length > 30) {
          return NextResponse.json(
            { ok: false, error: "מקסימום 30 עדים בעסקה אחת (מגבלת שרשרת)" },
            { status: 400 },
          );
        }
        const currentVotes = new Set(rawAcc.witness_votes ?? []);
        const already = names.filter((w) => currentVotes.has(w));
        // Existence check — one RPC per witness, capped to keep latency sane.
        const missing: string[] = [];
        for (const w of names.slice(0, 30)) {
          try {
            const wit = await rpc<{ owner?: string }>("condenser_api.get_witness_by_account", [w]);
            if (!wit || !wit.owner) missing.push(w);
          } catch {
            missing.push(w);
          }
        }
        if (missing.length > 0) {
          return NextResponse.json(
            { ok: false, error: `עדים לא קיימים בשרשרת: ${missing.join(", ")}` },
            { status: 400 },
          );
        }
        const toVote = names.filter((w) => !currentVotes.has(w));
        if (toVote.length === 0) {
          return NextResponse.json(
            { ok: false, error: "החשבון כבר מצביע לכל העדים שנבחרו" },
            { status: 400 },
          );
        }
        response.ops = toVote.map(
          (witness) =>
            ["account_witness_vote", { account: username, witness, approve: true }] as [
              string,
              Record<string, unknown>,
            ],
        );
        response.summary = `הצבעה ל-${toVote.length} עדים בעסקה אחת: ${toVote.join(", ")}`;
        response.warnings = [
          already.length > 0
            ? `כבר מצביעים כיום ל-${already.length} מהשמות — הם לא ייכללו`
            : "הצבעות עדים מתבצעות במפתח Active",
          "ביטול הצבעה אפשר בכל עת דרך הפעולה הסרת הצבעות עדים",
        ];
        break;
      }

      case "convert": {
        response.requiredRole = "active";
        const amount = Number(params.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ ok: false, error: "סכום לא תקין" }, { status: 400 });
        }
        if (amount > sbd + 1e-9) {
          return NextResponse.json(
            { ok: false, error: `אין מספיק SBD (יש ${sbd.toFixed(3)})` },
            { status: 400 },
          );
        }
        const requestid = Math.floor(Date.now() / 1000) % 2147483647;
        // Live feed for the honest STEEM estimate (never a hardcoded price).
        let feedRate = 0;
        try {
          const fh = await rpc<{ current_median_history?: { base: string; quote: string } }>(
            "condenser_api.get_feed_history",
            [],
          );
          const base = num(fh.current_median_history?.base); // SBD
          const quote = num(fh.current_median_history?.quote); // STEEM
          if (base > 0 && quote > 0) feedRate = base / quote;
        } catch {
          feedRate = 0;
        }
        response.ops = [
          [
            "convert",
            { owner: username, requestid, amount: fmt(amount, "SBD") },
          ],
        ];
        response.summary = feedRate > 0
          ? `המרת ${amount.toFixed(3)} SBD → ≈${(amount / feedRate).toFixed(3)} STEEM (לפי פיד ${feedRate.toFixed(6)}) אחרי 3.5 ימים`
          : `המרת ${amount.toFixed(3)} SBD ל-STEEM (הפיד לא נקרא כרגע) אחרי 3.5 ימים`;
        response.warnings = [
          "סופי — אין ביטול אחרי השידור",
          "התשלום מתבצע לפי הפיד השורר בזמן הביצוע בפועל (3.5 ימים)",
        ];
        break;
      }

      case "delegate": {
        response.requiredRole = "active";
        const to = String(params.to ?? "").trim().replace(/^@/, "").toLowerCase();
        const amountSp = Number(params.amountSp);
        if (!USERNAME_RE.test(to)) {
          return NextResponse.json({ ok: false, error: "חשבון יעד לא תקין" }, { status: 400 });
        }
        if (!Number.isFinite(amountSp) || amountSp <= 0) {
          return NextResponse.json({ ok: false, error: "סכום SP לא תקין" }, { status: 400 });
        }
        const freeSp = Math.max(0, spOwn - spDelegatedOut);
        if (amountSp > freeSp + 1e-6) {
          return NextResponse.json(
            {
              ok: false,
              error: `אין מספיק SP פנוי (פנוי ≈${freeSp.toFixed(3)} · מוקצה כבר החוצה ${spDelegatedOut.toFixed(3)})`,
            },
            { status: 400 },
          );
        }
        let delegateeExists = true;
        try {
          const [target] = await rpc<RawAccount[]>("condenser_api.get_accounts", [[to]]);
          delegateeExists = Boolean(target);
        } catch {
          delegateeExists = true; // node hiccup — let the chain be the judge
        }
        const vestsOut = amountSp / vest2sp;
        response.ops = [
          [
            "delegate_vesting_shares",
            { delegator: username, delegatee: to, vesting_shares: fmt(vestsOut, "VESTS") },
          ],
        ];
        response.summary = `הקצאת ${amountSp.toFixed(3)} SP → @${to} (${fmt(vestsOut, "VESTS")})`;
        response.warnings = [
          "ה-SP המוקצה ננעל — ביטול מחזיר אותו אחרי ~7 ימי המתנה",
          "ההקצאה מפחיתה כוח הצבעה ותשואת קוראציה עד הביטול",
          delegateeExists
            ? "בדוק את שם החשבון פעמיים — ההקצאה מיידית וסופית"
            : "⚠️ חשבון היעד לא נמצא בשרשרת — כנראה שגיאת הקלדה",
        ];
        break;
      }

      case "witness_unvote": {
        response.requiredRole = "active";
        const list = Array.isArray(params.witnesses) ? params.witnesses.map(String) : [];
        const current = new Set(rawAcc.witness_votes ?? []);
        const valid = [...new Set(list)].filter((w) => current.has(w));
        if (valid.length === 0) {
          return NextResponse.json(
            { ok: false, error: "לא נבחרו עדים שהחשבון אכן מצביע עבורם כיום" },
            { status: 400 },
          );
        }
        response.ops = valid.map(
          (witness) =>
            ["account_witness_vote", { account: username, witness, approve: false }] as [
              string,
              Record<string, unknown>,
            ],
        );
        response.summary = `הסרת הצבעה מ-${valid.length} עדים: ${valid.join(", ")}`;
        break;
      }

      default:
        return NextResponse.json(
          { ok: false, error: `פעולה לא מוכרת: ${action}` },
          { status: 400 },
        );
    }

    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
