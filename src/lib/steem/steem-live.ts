/**
 * steem-live.ts — Live read-only Steem RPC layer for the Cockpit platform.
 *
 * Read-only by design: this module NEVER signs, NEVER holds keys, and only
 * performs JSON-RPC reads against public Steem nodes. All param formats were
 * verified live against api.steemit.com (see worklog Tasks 6-8).
 *
 * Server-only: imported exclusively by API routes.
 */

const RPC_URL = "https://api.steemit.com";

// ── Types (shared with the Cockpit UI via /api/steem/live) ─────────────────

export interface LockedItem {
  kind: "sp_powered" | "sp_delegated_in" | "savings" | "conversion" | "open_order";
  label: string;
  amount: number;
  unit: string; // SP | STEEM | SBD
  usd: number;
  unlockMethod: string; // Hebrew
  unlockDays: number | null;
  note: string; // Hebrew
}

export interface PostingAuthAudit {
  account: string;
  status: "active" | "defunct" | "unknown";
  risk: "low" | "medium" | "high";
  note: string; // Hebrew
}

export interface LiveAccount {
  ok: true;
  username: string;
  fetchedAt: string;
  chain: {
    vest2sp: number;
    steemUsd: number;
    sbdUsd: number;
    headBlock: number;
    time: string;
    delegationReturnDays: number;
  };
  balances: {
    steem: number;
    sbd: number;
    spOwn: number;
    spIn: number;
    spOut: number;
    spEffective: number;
    savingsSteem: number;
    savingsSbd: number;
    pendingSteem: number;
    pendingSbd: number;
    pendingSp: number;
    totalUsd: number;
  };
  power: {
    votingPower: number; // 0-100 (%)
    rcPct: number; // 0-100 (%)
    rcMax: number;
    lastVoteTime: string;
    fullVoteValueUsd: number;
    fullVotesPerDay: number;
  };
  locked: {
    items: LockedItem[];
    totalUsd: number;
  };
  yield: {
    claimsReady: boolean;
    claimableUsd: number;
    curationApyLow: number; // 0.02
    curationApyHigh: number; // 0.04
    rentalApr: number; // 0.15 measured
    wastedVotesPerDay: number;
    wastedUsdPerYear: number;
    score: number; // 0-100 (100 = fully optimized)
    advice: string[]; // Hebrew bullet list
  };
  security: {
    postingAuths: PostingAuthAudit[];
    keyCounts: { posting: number; active: number; owner: number };
    thresholds: { active: number; owner: number };
    staleAuths: number;
    score: number; // 0-100 hygiene
    advice: string[];
  };
}

export interface LiveError {
  ok: false;
  error: string;
}

// ── Low-level RPC client ────────────────────────────────────────────────────

let rpcId = 100;

async function rpc<T>(method: string, params: unknown, timeoutMs = 15000): Promise<T> {
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
  const p = asset.split(" ");
  return p.length >= 1 ? parseFloat(p[0]) || 0 : 0;
}

// ── Known posting-app registry (verified statuses, 2026) ────────────────────

const POSTING_APP_REGISTRY: Record<string, Omit<PostingAuthAudit, "account">> = {
  smartsteem: {
    status: "defunct",
    risk: "medium",
    note: "השירות נסגר (2023) — ההרשאה נשארה תלויה. מומלץ לשלול.",
  },
  "bottracker.app": { status: "defunct", risk: "medium", note: "שירות מעקב שנסגר. מומלץ לשלול." },
  "dlive.app": { status: "defunct", risk: "medium", note: "DLive עזב את Steem כבר ב-2019. מומלץ לשלול." },
  "steem-plus-app": { status: "defunct", risk: "medium", note: "תוסף דפדפן לא פעיל שנים. מומלץ לשלול." },
  streemian: { status: "defunct", risk: "medium", note: "שירות ותיק שנסגר. מומלץ לשלול." },
  "utopian.app": { status: "defunct", risk: "medium", note: "Utopian-io נסגר (2019). מומלץ לשלול." },
  steemauto: {
    status: "unknown",
    risk: "medium",
    note: "סינון הצבעות אוטומטי — לא אומת שפעיל. לבדוק או לשלול.",
  },
  "steemhunt.com": { status: "active", risk: "low", note: "פלטפורמת מוצרים — נראית פעילה." },
};

function auditPostingAuths(accountAuths: [string, number][]): PostingAuthAudit[] {
  return accountAuths.map(([account]) => {
    const known = POSTING_APP_REGISTRY[account];
    if (known) return { account, ...known };
    return {
      account,
      status: "unknown" as const,
      risk: "medium" as const,
      note: "לא מוכר ברישום — לא אומת. מומלץ לבדוק או לשלול.",
    };
  });
}

// ── Market price (CoinGecko, with internal-market fallback) ─────────────────

async function fetchUsdPrices(props: DynamicProps): Promise<{ steemUsd: number; sbdUsd: number }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars&vs_currencies=usd",
      { signal: ctrl.signal, cache: "no-store" }
    );
    clearTimeout(t);
    const j = (await res.json()) as {
      steem?: { usd?: number };
      "steem-dollars"?: { usd?: number };
    };
    if (j.steem?.usd && j["steem-dollars"]?.usd) {
      return { steemUsd: j.steem.usd, sbdUsd: j["steem-dollars"].usd };
    }
  } catch {
    // fall through to internal market
  }
  // Fallback: internal SBD/STEEM mid (assumes SBD ≈ $1 scale)
  try {
    const book = await rpc<{ asks: { real_price: string }[]; bids: { real_price: string }[] }>(
      "condenser_api.get_order_book",
      [5]
    );
    const ask = book.asks?.[0] ? parseFloat(book.asks[0].real_price) : 0;
    const bid = book.bids?.[0] ? parseFloat(book.bids[0].real_price) : 0;
    const mid = ask > 0 && bid > 0 ? (ask + bid) / 2 : ask || bid || 0.108;
    // internal book is SBD-per-STEEM → convert with measured SBD/USD (~0.398)
    return { steemUsd: mid * 0.398, sbdUsd: 0.398 };
  } catch {
    // last-resort constants (measured 2026-09): SBD $0.398, STEEM ≈ $0.043
    return { steemUsd: 0.043, sbdUsd: 0.398 };
  }
}

// ── Chain props shapes ──────────────────────────────────────────────────────

interface DynamicProps {
  time: string;
  head_block_number: number;
  total_vesting_fund_steem: string;
  total_vesting_shares: string;
  delegation_return_period: number;
  current_supply: string;
  current_sbd_supply: string;
}

interface RewardFund {
  reward_balance: string;
  recent_claims: string;
}

interface AccountShape {
  balance: string;
  sbd_balance: string;
  vesting_shares: string;
  received_vesting_shares?: string;
  delegated_vesting_shares?: string;
  savings_balance: string;
  savings_sbd_balance: string;
  reward_steem_balance: string;
  reward_sbd_balance: string;
  reward_vesting_balance: string;
  voting_power: number;
  voting_manabar?: { current_mana: string; last_update_time: number };
  proxy: string;
  witnesses_voted_for: number;
  post_count: number;
  curation_rewards: string;
  memo_key: string;
  next_vesting_withdrawal: string;
  to_withdraw: string;
  withdrawn: string;
  posting: { key_auths: [string, number][]; account_auths: [string, number][]; weight_threshold: number };
  active: { key_auths: [string, number][]; account_auths: [string, number][]; weight_threshold: number };
  owner: { key_auths: [string, number][]; account_auths: [string, number][]; weight_threshold: number };
  created: string;
}

// ── Main snapshot builder ───────────────────────────────────────────────────

export async function getLiveAccount(username: string): Promise<LiveAccount | LiveError> {
  try {
    const accounts = await rpc<AccountShape[]>("condenser_api.get_accounts", [[username]]);
    if (!accounts?.length) return { ok: false, error: `חשבון ${username} לא נמצא ברשת` };
    const acc = accounts[0];

    const [props, rcRes, routes, conversions, savingsOut, delegOut, openOrders, rfund] =
      await Promise.all([
        rpc<DynamicProps>("condenser_api.get_dynamic_global_properties", []),
        rpc<{ rc_accounts: { max_rc: string; rc_manabar: { current_mana: string } }[] }>(
          "rc_api.find_rc_accounts",
          { accounts: [username] }
        ),
        // NOTE: flat param formats verified live (nested arrays → Bad Cast)
        rpc<unknown[]>("condenser_api.get_withdraw_routes", [username, "all"]),
        rpc<unknown[]>("condenser_api.get_conversion_requests", [username]),
        rpc<unknown[]>("condenser_api.get_savings_withdraw_from", [username]),
        rpc<{ delegatee: string; vesting_shares: string }[]>(
          "condenser_api.get_vesting_delegations",
          [username, "", 100]
        ),
        rpc<unknown[]>("condenser_api.get_open_orders", [username]),
        rpc<RewardFund>("condenser_api.get_reward_fund", ["post"]),
      ]);
    const usd = await fetchUsdPrices(props);

    const vest2sp = num(props.total_vesting_fund_steem) / num(props.total_vesting_shares);
    const spOwn = num(acc.vesting_shares) * vest2sp;
    const spIn = num(acc.received_vesting_shares) * vest2sp;
    const spOut = num(acc.delegated_vesting_shares) * vest2sp;
    const spEff = spOwn + spIn - spOut;
    const spTotal = spOwn + spIn + spOut; // "physical" total incl. outbound lock

    const pendingSp = num(acc.reward_vesting_balance) * vest2sp;
    const pendingSteem = num(acc.reward_steem_balance);
    const pendingSbd = num(acc.reward_sbd_balance);

    // RC
    const rcMax = parseInt(rcRes.rc_accounts[0]?.max_rc ?? "0", 10);
    const rcCur = parseInt(rcRes.rc_accounts[0]?.rc_manabar?.current_mana ?? "0", 10);
    const rcPct = rcMax > 0 ? (rcCur / rcMax) * 100 : 0;

    // Voting power: the legacy acc.voting_power field is deprecated on current
    // Steem (observed stuck at 0 with a FULL manabar). The authoritative value
    // is voting_manabar.current_mana / (effective VESTS × 1e6), same math as RC.
    const effVests =
      num(acc.vesting_shares) + num(acc.received_vesting_shares) - num(acc.delegated_vesting_shares);
    const voteManaMax = effVests * 1e6;
    const voteManaCur = num(String(acc.voting_manabar?.current_mana ?? ""));
    const votingPower =
      voteManaMax > 0 && voteManaCur > 0
        ? Math.min(100, (voteManaCur / voteManaMax) * 100)
        : acc.voting_power / 100; // fallback for old-API shapes
    const rsharesFullVote = (effVests * 1e6) / 50; // full vote at 100% VP: mana/50
    const recentClaims = parseFloat(rfund.recent_claims);
    const rewardBalance = num(rfund.reward_balance);
    const fullVoteSteem = rewardBalance * (rsharesFullVote / (recentClaims + rsharesFullVote));
    const fullVoteValueUsd = fullVoteSteem * usd.steemUsd;
    const fullVotesPerDay = 10; // measured vote_power_reserve_rate=10

    // ── Locked funds breakdown ──
    const powerDownActive = !acc.next_vesting_withdrawal.startsWith("1969");
    const lockedItems: LockedItem[] = [];

    if (spOwn > 0.001) {
      lockedItems.push({
        kind: "sp_powered",
        label: "Steem Power (מנופח)",
        amount: spOwn,
        unit: "SP",
        usd: spOwn * usd.steemUsd,
        unlockMethod: powerDownActive ? "Power Down פעיל" : "withdraw_vesting (Power Down)",
        unlockDays: 91, // 13 weekly payments
        note: powerDownActive
          ? "מתוכנן שחרור שבועי מתמשך"
          : "13 תשלומים שבועיים — אך מומלץ לא לשחרר: זה הנכס המניב",
      });
    }
    if (spIn > 0.001) {
      lockedItems.push({
        kind: "sp_delegated_in",
        label: "SP שהוקצה אליך מאחרים",
        amount: spIn,
        unit: "SP",
        usd: spIn * usd.steemUsd,
        unlockMethod: "משתחרר אוטומטית כשהמקצה שולף",
        unlockDays: 5,
        note: "ה-5 ימים = delegation_return_period (נמדד)",
      });
    }
    if (num(acc.savings_balance) > 0.001 || num(acc.savings_sbd_balance) > 0.001) {
      lockedItems.push({
        kind: "savings",
        label: "חיסכון (STEEM+SBD)",
        amount: num(acc.savings_balance) + num(acc.savings_sbd_balance),
        unit: num(acc.savings_sbd_balance) > 0.001 ? "SBD" : "STEEM",
        usd: num(acc.savings_balance) * usd.steemUsd + num(acc.savings_sbd_balance) * usd.sbdUsd,
        unlockMethod: "transfer_from_savings",
        unlockDays: 3,
        note: "72 שעות מהבקשה ועד למשיכה",
      });
    }
    if (conversions.length > 0) {
      lockedItems.push({
        kind: "conversion",
        label: "המרות SBD בתהליך",
        amount: conversions.length,
        unit: "בקשות",
        usd: 0,
        unlockMethod: "אוטומטי",
        unlockDays: 3.5,
        note: "תוצרת המרה ב-3.5 ימים (ה-ARB של BOT-3)",
      });
    }
    if (openOrders.length > 0) {
      lockedItems.push({
        kind: "open_order",
        label: "פקודות שוק פתוחות",
        amount: openOrders.length,
        unit: "פקודות",
        usd: 0,
        unlockMethod: "limit_order_cancel",
        unlockDays: 0,
        note: "ניתן לביטול מיידי",
      });
    }

    const totalUsd =
      num(acc.balance) * usd.steemUsd +
      num(acc.sbd_balance) * usd.sbdUsd +
      spTotal * usd.steemUsd +
      num(acc.savings_balance) * usd.steemUsd +
      num(acc.savings_sbd_balance) * usd.sbdUsd;

    // ── Yield engine ──
    const claimsReady = pendingSp + pendingSteem + pendingSbd > 0.001;
    const claimableUsd =
      pendingSp * usd.steemUsd + pendingSteem * usd.steemUsd + pendingSbd * usd.sbdUsd;

    // Waste model: regen ≈ 20%/day = 10 full votes/day; near cap, regen hits ceiling
    const wastedVotesPerDay = votingPower >= 95 ? Math.round(((votingPower - 95) / 2) * 10) / 10 + 5 : 0;
    const wastedUsdPerYear = wastedVotesPerDay * fullVoteValueUsd * 365;

    const rentalApr = 0.15; // measured (leasing market)
    const curationApyLow = 0.02;
    const curationApyHigh = 0.04;

    const advice: string[] = [];
    if (votingPower >= 95)
      advice.push(
        `כוח הצבעה גולש (${votingPower.toFixed(1)}%) — עד ${Math.round(wastedVotesPerDay)} הצבעות/יום מבוזבזות. טרייל-הצבעה (BOT-2) הופך זאת ל-${(curationApyLow * 100).toFixed(0)}-${(curationApyHigh * 100).toFixed(0)}% APY.`
      );
    if (claimsReady)
      advice.push(
        `רווחים לא נתבעו (~$${claimableUsd.toFixed(2)}) — claim_reward_balance עם posting key בלבד, פעולה בטוחה לגמרי.`
      );
    if (spOut < 1 && spOwn > 100)
      advice.push(
        `כ-${spOwn.toFixed(0)} SP עומדים ללא הקצאה — שכירה לשוק (~15% APR ≈ $${(spOwn * rentalApr * usd.steemUsd).toFixed(0)}/שנה) או הקצאה לצי בוטים שלך.`
      );
    if (rcPct > 99)
      advice.push(
        "RC מלא 100% — דלק עסקאות חינם שלא מנוצל; מספיק להקצות (delegate_rc) לבוטים או ליצור תתי-חשבונות (claim_account)."
      );
    if (!advice.length) advice.push("החשבון ממוטב — כל המנועים רצים.");

    let yieldScore = 100;
    if (votingPower >= 95) yieldScore -= 25;
    if (claimsReady) yieldScore -= 15;
    if (spOut < 1 && spOwn > 100) yieldScore -= 20;
    if (rcPct > 99) yieldScore -= 10;
    if (conversions.length === 0 && num(acc.sbd_balance) > 10) yieldScore -= 10;

    // ── Security audit ──
    const postingAuths = auditPostingAuths(acc.posting.account_auths ?? []);
    const staleAuths = postingAuths.filter((a) => a.status !== "active").length;
    const secAdvice: string[] = [];
    if (staleAuths > 0)
      secAdvice.push(
        `${staleAuths} הרשאות פרסום מיושנות — שלילה דורשת owner key (פעולה אופליין, מדריך ב-KEY_CAPABILITIES.md). הסיכון הוא מוניטין (ספאם בשמך), לא כספים.`
      );
    if (acc.active.weight_threshold === 1 && acc.active.key_auths.length === 1)
      secAdvice.push(
        "חתימת-יחיד ב-Active — שקול multi-sig (threshold 2) להגנה על פעולות כסף, מתועד ב-KEY_CAPABILITIES.md."
      );
    if (postingAuths.length === 0) secAdvice.push("אין הרשאות צד-שלישי — היגיינה מעולה.");

    const secScore = Math.max(0, 100 - staleAuths * 12 - (acc.active.key_auths.length === 1 ? 5 : 0));

    return {
      ok: true,
      username,
      fetchedAt: new Date().toISOString(),
      chain: {
        vest2sp,
        steemUsd: usd.steemUsd,
        sbdUsd: usd.sbdUsd,
        headBlock: props.head_block_number,
        time: props.time,
        delegationReturnDays: props.delegation_return_period / 86400,
      },
      balances: {
        steem: num(acc.balance),
        sbd: num(acc.sbd_balance),
        spOwn,
        spIn,
        spOut,
        spEffective: spEff,
        savingsSteem: num(acc.savings_balance),
        savingsSbd: num(acc.savings_sbd_balance),
        pendingSteem,
        pendingSbd,
        pendingSp,
        totalUsd,
      },
      power: {
        votingPower,
        rcPct,
        rcMax,
        lastVoteTime: "",
        fullVoteValueUsd,
        fullVotesPerDay,
      },
      locked: { items: lockedItems, totalUsd: lockedItems.reduce((s, i) => s + i.usd, 0) },
      yield: {
        claimsReady,
        claimableUsd,
        curationApyLow,
        curationApyHigh,
        rentalApr,
        wastedVotesPerDay,
        wastedUsdPerYear,
        score: yieldScore,
        advice,
      },
      security: {
        postingAuths,
        keyCounts: {
          posting: acc.posting.key_auths.length,
          active: acc.active.key_auths.length,
          owner: acc.owner.key_auths.length,
        },
        thresholds: { active: acc.active.weight_threshold, owner: acc.owner.weight_threshold },
        staleAuths,
        score: secScore,
        advice: secAdvice,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
