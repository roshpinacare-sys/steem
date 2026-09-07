import { getLiveAccount } from "@/lib/steem/steem-live";
import type { LiveAccount } from "@/lib/steem/steem-live";

// ─────────────────────────────────────────────────────────────────────────────
// sovereign.ts — the sovereign capital ladder. Measures, LIVE, the only
// stake-independent capital pool on Steem: the SPS/DHF worker-proposal fund —
// plus the account's own dead capital (idle VP, surplus RC, idle SP) — and
// compiles both into a step-by-step capital plan.
//
// Everything numeric here is measured from the chain at request time, not
// invented: pool ledger (sps_interval_ledger), funding threshold (the return
// proposal's total votes, id 0), funded/unfunded asks (list_proposals), the
// account strip (getLiveAccount). Economic APR constants reuse the measured
// figures from docs (EFFICIENCY_AUDIT 2.48% curation, RENTAL_SCAN 4.15%).
//
// Iron law: read-only. No keys, no signing, no writes — pure inference.
// ─────────────────────────────────────────────────────────────────────────────

export const CURATION_APR = 0.0248; // measured, EFFICIENCY_AUDIT (2,100 ops)
export const RENTAL_APR = 0.0415; // measured, RENTAL_SCAN (13/13 payers)
/** RC-account factory ceiling for headcorner-class stake (measured, Task 20). */
export const FACTORY_TICKETS_PER_DAY = { min: 0.31, max: 3.1 };
export const FACTORY_TICKET_VALUE_USD = 0.313; // measured ceiling (fee 3 STEEM × feed)
/** consensus rule: only proposals with MORE votes than the return proposal are funded */
const SWEEPER_DAILY_SBD = 100_000;
/** proposal total_votes are GESTS (micro-VESTS) — measured live 2026-09-02:
 *  return proposal raw 8.33e16 GESTS = 83.3e9 VESTS / 1616.6 = 51.5M SP ✓ */
const GESTS_PER_VESTS = 1e6;
/** sps_interval_ledger resets every maintenance hour; remember the max seen for 7d */
const LEDGER_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
interface LedgerMax {
  at: number;
  value: number;
}
const gLedger = globalThis as unknown as { __saosSpsLedgerMax?: LedgerMax };

const NODES = ["https://api.steemit.com", "https://api.justyy.com"];

let reqId = 500;
async function rpc<T>(method: string, params: unknown, timeoutMs = 14_000): Promise<T> {
  let lastErr: unknown = null;
  for (const node of NODES) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++reqId }),
        signal: ctrl.signal,
        cache: "no-store",
      });
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "RPC error");
      if (json.result === undefined) throw new Error("empty result");
      return json.result;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const num = (s: string | number | undefined | null): number => {
  if (s == null) return 0;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : 0;
};

// ── Chain shapes (only the fields we touch) ──────────────────────────────────

interface PropRecord {
  id: number;
  creator: string;
  receiver: string;
  subject?: string;
  total_votes: string;
  daily_pay: string;
  end_date?: string;
}

interface DgpShape {
  total_vesting_fund_steem: string;
  total_vesting_shares: string;
  sps_interval_ledger?: string;
  head_block_number: number;
  time: string;
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

export interface SovereignProposal {
  id: number;
  creator: string;
  receiver: string;
  subject: string;
  dailyPaySbd: number;
  votesSp: number;
  pctOfThreshold: number;
  funded: boolean;
  sweeper: boolean;
}

export interface SovereignSnapshot {
  measuredAt: string;
  headBlock: number;
  /** VESTS per 1 STEEM — divide VESTS by this to get SP. */
  vestsPerSteem: number;
  /** SPS treasury ledger for the current maintenance interval (SBD) — raw, resets hourly. */
  poolIntervalSbd: number;
  /** max interval ledger seen in the last 7d × 24 (converges to the true hourly rate). */
  poolMaxObservedSbd: number;
  /** hard floor: sum of daily_pay of currently funded (non-sweeper) proposals. */
  poolFloorSbd: number;
  /** best estimate of the daily SPS pool: max(observed, floor). */
  poolPerDaySbd: number;
  /** the funding bar: total votes (SP) of the return proposal (id 0) */
  thresholdSp: number;
  funded: SovereignProposal[];
  unfunded: SovereignProposal[];
}

export async function fetchSovereignSnapshot(): Promise<SovereignSnapshot> {
  const [dgp, desc, asc] = await Promise.all([
    rpc<DgpShape>("condenser_api.get_dynamic_global_properties", []),
    rpc<PropRecord[]>(`condenser_api.list_proposals`, [
      ["18446744073709551615"],
      12,
      "by_total_votes",
      "descending",
    ]),
    rpc<PropRecord[]>("condenser_api.list_proposals", [["0"], 6, "by_total_votes", "ascending"]),
  ]);

  const vestsPerSteem =
    num(dgp.total_vesting_shares) > 0
      ? num(dgp.total_vesting_shares) / num(dgp.total_vesting_fund_steem)
      : 1616.6;

  const ret = asc.find((p) => p.id === 0) ?? asc[asc.length - 1];
  const thresholdVests = num(ret?.total_votes) / GESTS_PER_VESTS;
  const thresholdSp = thresholdVests / vestsPerSteem;

  const map = (p: PropRecord): SovereignProposal => {
    const votesGests = num(p.total_votes);
    const votesVests = votesGests / GESTS_PER_VESTS;
    const votesSp = votesVests / vestsPerSteem;
    const daily = num(p.daily_pay);
    return {
      id: p.id,
      creator: p.creator,
      receiver: p.receiver,
      subject: (p.subject ?? "").slice(0, 60),
      dailyPaySbd: daily,
      votesSp,
      pctOfThreshold: thresholdSp > 0 ? (votesSp / thresholdSp) * 100 : 0,
      funded: votesVests > thresholdVests,
      sweeper: daily > SWEEPER_DAILY_SBD,
    };
  };

  const all = [...desc, ...asc].filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i);
  const funded = all
    .map(map)
    .filter((p) => p.funded && !p.sweeper)
    .sort((a, b) => b.votesSp - a.votesSp);
  const unfunded = all
    .map(map)
    .filter((p) => !p.funded && !p.sweeper)
    .sort((a, b) => b.votesSp - a.votesSp)
    .slice(0, 6);

  // The interval ledger resets every maintenance hour — remember the running max
  // for 7 days so repeated scans converge on the true hourly rate.
  const intervalNow = num(dgp.sps_interval_ledger);
  const prev = gLedger.__saosSpsLedgerMax;
  const ledgerMax =
    prev && Date.now() - prev.at < LEDGER_MAX_TTL_MS
      ? { at: prev.at, value: Math.max(prev.value, intervalNow) }
      : { at: Date.now(), value: intervalNow };
  gLedger.__saosSpsLedgerMax = ledgerMax;
  const observedPerDay = ledgerMax.value * 24;
  const poolFloor = funded.reduce((s, p) => s + p.dailyPaySbd, 0);

  return {
    measuredAt: new Date().toISOString(),
    headBlock: dgp.head_block_number,
    vestsPerSteem,
    poolIntervalSbd: intervalNow,
    poolMaxObservedSbd: observedPerDay,
    poolFloorSbd: poolFloor,
    poolPerDaySbd: Math.max(observedPerDay, poolFloor),
    thresholdSp,
    funded,
    unfunded,
  };
}

// ── Ladder (pure computation given measured inputs) ──────────────────────────

export type RungGate = "posting" | "active" | "campaign" | "none";
export type RungStatus = "now" | "ready" | "needs-signing" | "campaign" | "locked";

export interface LadderRung {
  level: number;
  title: string;
  subtitle: string;
  gate: RungGate;
  status: RungStatus;
  metrics: { label: string; value: string; tone: "emerald" | "amber" | "violet" | "zinc" }[];
  why: string;
  risk: string | null;
}

export interface LadderStep {
  id: string;
  title: string;
  gate: string;
  status: "active" | "ready" | "needs-arming" | "needs-signing" | "campaign" | "locked";
  produces: string;
  fundsNext: string;
}

export interface DeadMoney {
  idleSp: number;
  idleSpUsd: number;
  vpPct: number;
  curationForfeitUsdMonth: number;
  rentalForfeitUsdMonth: number;
  rcTicketsPerDayMin: number;
  rcTicketsPerDayMax: number;
  liquidSteem: number;
  liquidSbd: number;
}

export interface SovereignLadder {
  deadMoney: DeadMoney;
  rungs: LadderRung[];
  steps: LadderStep[];
  headline: string;
}

interface AgentEnvLike {
  POSTING_WIF?: string | null;
  DRY_RUN?: string;
  CURATION_ENABLED?: string;
  ACTIVE_WIF?: string | null;
  FACTORY_ENABLED?: string;
}

export function computeLadder(
  snapshot: SovereignSnapshot,
  live: LiveAccount,
  env: AgentEnvLike,
): SovereignLadder {
  const steemUsd = live.chain.steemUsd;
  const sbdUsd = live.chain.sbdUsd > 0 ? live.chain.sbdUsd : 1;
  // two different "idle" bases: curation works on effective stake (in+own-out),
  // rental can only delegate out what we own.
  const curationSp = Math.max(0, live.balances.spEffective);
  const rentalSp = Math.max(0, live.balances.spOwn - live.balances.spOut);
  const idleSp = curationSp;
  const idleSpUsd = idleSp * steemUsd;
  const vpPct = live.power.votingPower;
  const curationForfeitUsdMonth = ((idleSpUsd * CURATION_APR) / 12) * (vpPct / 100);
  const rentalForfeitUsdMonth = ((rentalSp * steemUsd * RENTAL_APR) / 12);
  const armed = Boolean(env.POSTING_WIF) && env.DRY_RUN === "false";
  const curationOn = env.CURATION_ENABLED === "true";
  const hasActive = Boolean(env.ACTIVE_WIF);
  const factoryOn = env.FACTORY_ENABLED === "true";

  const deadMoney: DeadMoney = {
    idleSp,
    idleSpUsd,
    vpPct,
    curationForfeitUsdMonth,
    rentalForfeitUsdMonth,
    rcTicketsPerDayMin: FACTORY_TICKETS_PER_DAY.min,
    rcTicketsPerDayMax: FACTORY_TICKETS_PER_DAY.max,
    liquidSteem: live.balances.steem,
    liquidSbd: live.balances.sbd,
  };

  const ourPct = snapshot.thresholdSp > 0 ? (curationSp / snapshot.thresholdSp) * 100 : 0;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const topFunded = snapshot.funded[0];

  const rungs: LadderRung[] = [
    {
      level: 0,
      title: "ההון המת — מה יושב בלי לעבוד",
      subtitle: "כל הנכסים שמפיקים אפס כרגע",
      gate: "none",
      status: "now",
      metrics: [
        { label: "SP בטל", value: `${idleSp.toFixed(0)} SP · ${usd(idleSpUsd)}`, tone: "amber" },
        { label: "SP ניתן להשכרה", value: `${rentalSp.toFixed(0)} SP`, tone: "zinc" },
        { label: "כוח הצבעה לא נקצר", value: `${vpPct.toFixed(0)}% → ${usd(curationForfeitUsdMonth)}/חודש שלא נלקח`, tone: "amber" },
        { label: "עודף RC → זכאויות", value: `עד ${FACTORY_TICKETS_PER_DAY.max} כרטיסים/יום חינם`, tone: "emerald" },
        { label: "נזיל", value: `${live.balances.steem.toFixed(3)} STEEM · ${live.balances.sbd.toFixed(2)} SBD`, tone: "zinc" },
      ],
      why: "הכסף לא נעלם — הוא קפוא בלי מנוע. VP ב-100% ו-RC מלא זה הון שנוצר כל יום ונשרף לריק. זה הדלק של כל הסולם.",
      risk: null,
    },
    {
      level: 1,
      title: "מפעל זכאויות חשבון (RC)",
      subtitle: "המכשיר האוטונומי הראשון — RC עודף הופך כרטיסי חשבונות",
      gate: "active",
      status: factoryOn && hasActive ? "ready" : hasActive ? "ready" : "needs-signing",
      metrics: [
        { label: "תפוקה", value: `${FACTORY_TICKETS_PER_DAY.min}–${FACTORY_TICKETS_PER_DAY.max} כרטיסים/יום`, tone: "emerald" },
        { label: "תקרת ערך כרטיס", value: usd(FACTORY_TICKET_VALUE_USD), tone: "zinc" },
        { label: "תקרה יומית", value: `$${(FACTORY_TICKETS_PER_DAY.min * FACTORY_TICKET_VALUE_USD).toFixed(2)}–$${(FACTORY_TICKETS_PER_DAY.max * FACTORY_TICKET_VALUE_USD).toFixed(2)}/יום`, tone: "amber" },
      ],
      why: "RC מתחדש חינם כל יום — זה הון מת טהור שהופך למוצר (חשבונות). אחרי חתימת Active אחת המכשיר רץ לבד ומוכר דרך הרייל.",
      risk: "הביקוש לחשבונות הוא חוץ-שרשרת (rail) — לא מובטח; התקרה היא 0.19% מקיבולת המפעלים הגדולים.",
    },
    {
      level: 2,
      title: "השכרת SP — הנזילות המהירה",
      subtitle: "המרת SP בטל לתשלום יומי נזיל",
      gate: "active",
      status: live.balances.spOut > 1 ? "ready" : "needs-signing",
      metrics: [
        { label: "APR מדוד", value: `${(RENTAL_APR * 100).toFixed(2)}%`, tone: "emerald" },
        { label: "תפוקה צפויה", value: `${usd(rentalForfeitUsdMonth)}/חודש נזיל`, tone: "amber" },
        { label: "סיכון SP", value: "אפס — SP חוזר אחרי 7 ימים", tone: "zinc" },
      ],
      why: "הדרך היחידה להפוך SP קפוא לכסף נזיל שוטף בלי לוותר על בעלות. התשלום היומי הנזיל הוא מה שמממן את הקומות הבאות.",
      risk: "תשואה נמוכה (4.15%) — זה סולם, לא מנוע. ערך: הנזילות, לא הסכום.",
    },
    {
      level: 3,
      title: "הצעת עבודה SPS — הקפיצה הריבונית",
      subtitle: "הקופה של הרשת משלמת לבונים — לא תלויה בהון שלך",
      gate: "campaign",
      status: "campaign",
      metrics: [
        { label: "קופה חיה", value: `≈${snapshot.poolPerDaySbd.toFixed(0)} SBD/יום ($${(snapshot.poolPerDaySbd * sbdUsd).toFixed(0)})`, tone: "violet" },
        { label: "סף כניסה", value: `${(snapshot.thresholdSp / 1e6).toFixed(1)}M SP קולות`, tone: "amber" },
        { label: "המיקום שלנו", value: `${ourPct < 0.01 ? ourPct.toFixed(4) : ourPct.toFixed(2)}% מהסף (${idleSp.toFixed(0)} SP)`, tone: "zinc" },
        { label: "בקשה צנועה", value: `20 SBD/יום ≈ $${(20 * sbdUsd * 30).toFixed(0)}/חודש = ${((20 / Math.max(snapshot.poolPerDaySbd, 1)) * 100).toFixed(1)}% מהקופה`, tone: "emerald" },
      ],
      why: `המנגנון היחיד בפרוטוקול שמשלם מהקופה של הרשת ולא מההון שלך: הצעה ממומנת מקבלת תשלום יומי מהאינפלציה. כרגע ממומנים בפועל: ${snapshot.funded.map((f) => `${f.creator} (${f.dailyPaySbd.toFixed(0)} SBD/יום)`).join(", ") || "—"} . ה-SAOS עצמו הוא המוצר שמוצע: קונסולת ניהול חיה.`,
      risk: `הסף ${(snapshot.thresholdSp / 1e6).toFixed(1)}M SP גבוה — צריך קולות של עדים/לווייתנים (קול אחד של עד צמוד = 2,000+ חשבונות כמו שלנו). זו עבודת קמפיין, לא כפתור. עמלת הגשה לא מדודה — נמדד בריצה החיה הראשונה.`,
    },
    {
      level: 4,
      title: "תשתית רשת — עד / צומת API",
      subtitle: "המכשיר שמשרת את הרשת עצמה",
      gate: "none",
      status: "locked",
      metrics: [
        { label: "תנאי כניסה", value: "הון מקומות 1–3 + קהילה", tone: "zinc" },
        { label: "התפקיד", value: "הפקת בלוקים · שירות RPC", tone: "violet" },
      ],
      why: "הקומה שבה אנחנו לא רק משתמשים ברשת אלא מתקינים בה מכשיר. דורש הון וקולות — נפתח אוטומטית כשהסולם עולה.",
      risk: null,
    },
  ];

  const steps: LadderStep[] = [
    {
      id: "drip",
      title: "שלב 0 · הפעלת הטפטוף",
      gate: "posting · אוטונומי",
      status: armed ? (curationOn ? "active" : "ready") : "needs-arming",
      produces: `תביעות אוטומטיות + ${usd(curationForfeitUsdMonth)}/חודש אצירה → SP עובד`,
      fundsNext: "SP גדל → RC גדל → קומת המפעל מתרחבת",
    },
    {
      id: "liquidity",
      title: "שלב 1 · נזילות ראשונה (A2 + השכרה)",
      gate: "active · שתי חתימות",
      status: hasActive ? "ready" : "needs-signing",
      produces: `מפעל RC + השכרה → זרם נזיל ראשון ${usd(rentalForfeitUsdMonth)}/חודש + כרטיסים למכירה`,
      fundsNext: "ה-STEEM הנזיל הראשון — מממן עמלות והגשה",
    },
    {
      id: "proposal",
      title: "שלב 2 · המכשיר הריבוני — הגשת הצעה",
      gate: "active · עמלה זעירה (לא מדוד)",
      status: hasActive ? "ready" : "needs-signing",
      produces: "הצעת SAOS על השרשרת — daily_pay 20 SBD/יום",
      fundsNext: "מוצר מוצג לקהילה → מסע קולות",
    },
    {
      id: "threshold",
      title: "שלב 3 · מעבר הסף",
      gate: "קמפיין · עדים + לווייתנים",
      status: "campaign",
      produces: `>${(snapshot.thresholdSp / 1e6).toFixed(1)}M SP קולות → מימון יומי מהקופה`,
      fundsNext: "הכנסה שאינה תלוית-הון → 100% power-up → דריבית",
    },
    {
      id: "infra",
      title: "שלב 4 · תשתית רשת",
      gate: "נעול עד שלב 3",
      status: "locked",
      produces: "עד/צומת API — מכשיר של הרשת עצמה",
      fundsNext: "הון ריבוני מלא",
    },
  ];

  const headline =
    `קופת SPS חיה ≈${snapshot.poolPerDaySbd.toFixed(0)} SBD/יום · סף המימון ${(snapshot.thresholdSp / 1e6).toFixed(1)}M SP · ` +
    `אנחנו ${ourPct < 0.01 ? ourPct.toFixed(4) : ourPct.toFixed(2)}% מהסף · ` +
    (topFunded ? `הממומנת המובילה: ${topFunded.creator} (${topFunded.dailyPaySbd.toFixed(0)} SBD/יום). ` : "") +
    `ההון המת בחשבון: ${usd(idleSpUsd)} SP בטל + VP ${vpPct.toFixed(0)}% לא נקצר.`;

  return { deadMoney, rungs, steps, headline };
}
