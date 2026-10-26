/**
 * router.mjs — T-25 · THE POOL ROUTER (ניתוב-הבריכות). The operator's question:
 * "יש בריכות ענק עם מלא נזילות ויש את הבריכות שלנו — איך מנתבים בחוכמה?"
 * The honest engineering answer has two halves:
 *  (1) route OUR OWN capital/attention to the best MEASURED venue (measured
 *      wins, estimated counts at half-weight, blocked counts zero — the same
 *      honesty contract as the rails), and
 *  (2) NAME the binding constraint instead of promising: with ~12$ liquid and
 *      ~4042 SP every pool-share rail is capital-bound; the non-proportional
 *      lever is the OFFER (selling measured capabilities to the network).
 * Pure core: lib.routePlan. State: state/router.json → /router → cockpit.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { routePlan, rcRateFromIntel } from "./lib.mjs";
import { hiveState } from "./hive.mjs"; // T-59a · the measured second venue feeds the denominator's honesty

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ROUTER_FILE = path.join(STATE, "router.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };

export const ROUTER_LAW = "הניתוב קורא רק מדידות: measured נשקל מלא, estimated חצי, blocked אפס — והחסם-הכובל נאמר בקול, לא מובטח";

export function routerState() { return readJson(ROUTER_FILE, null); }

/* ── T-59a · THE SECOND VENUE, SEEN BY THE DENOMINATOR ────────────────
 * hive.json is measured every cycle (HBD:HIVE — 24h vol ~71,554 HIVE ≈
 * $4,015/day ≈ 27× Steem's venue) yet the venue table had NO hive row — the
 * $/day denominator lied by omission (audit 1-a). The row is HONESTLY
 * BLOCKED, not hidden and not counted: class "blocked-no-credential" (the
 * venue is MEASURED, the income is not — no Hive credential on the machine,
 * the same operator gate as T-54). routePlan normalizes the class to
 * blocked → effective 0 → the row is VISIBLE in router.venues and
 * contributes ZERO to totals. usdPerDay stays null — an honest null, never
 * a zero that pretends to be a measurement. Fail-open: no/partial hive
 * state → the same blocked row with note "אין מדידה". */
export const HIVE_VENUE_ID = "hive-grid";
export const HIVE_VENUE_LABEL = "סריג-Hive · מקום-שני";

/** pure row builder (state-shape in → venue row out; no IO, vectorable).
 * The note carries the MEASURED regime (spread/range/tick/volume — each
 * only when present, volumeUsd only when the state itself carries one — we
 * hold no measured HIVE/USD pricer, so none is invented) + the plan-only
 * status. */
export function hiveVenueRow(hive) {
  const noMeasure = () => ({
    id: HIVE_VENUE_ID, label: HIVE_VENUE_LABEL,
    class: "blocked-no-credential", usdPerDay: null, note: "אין מדידה",
  });
  if (!hive || typeof hive !== "object") return noMeasure();
  const fin = (x) => Number.isFinite(Number(x)) && Number(x) > 0;
  const parts = [];
  if (fin(hive.book?.spreadBps)) parts.push(`פער ${hive.book.spreadBps}bps`);
  if (fin(hive.range?.rangeBps)) parts.push(`טווח-24ש ${hive.range.rangeBps}bps`);
  if (fin(hive.tick)) parts.push(`טיק ${hive.tick}`);
  if (fin(hive.volume?.hiveVolume24h)) {
    const usd = hive.volume?.volumeUsd;
    parts.push(`נפח ${Math.round(Number(hive.volume.hiveVolume24h))} HIVE/24ש${fin(usd) ? ` ≈ $${Math.round(Number(usd))}` : ""}`);
  }
  if (parts.length === 0) return noMeasure();
  return {
    id: HIVE_VENUE_ID, label: HIVE_VENUE_LABEL,
    class: "blocked-no-credential",
    usdPerDay: null,
    note: `מדוד-כל-מחזור: ${parts.join(" · ")} — סולם-המייקר נכתב-בלבד (${hive.plan?.execution ?? "credential-gated-plan-only"}); ההכנסה חסומה: אין-credential-Hive על-המכונה — אפס במניין-ההכנסה-הנמדדת`,
  };
}

export function runRouter({ now = new Date().toISOString() } = {}) {
  const econ = readJson(path.join(STATE, "economics.json"), null);
  const catalog = readJson(path.join(STATE, "catalog.json"), null);
  const rctank = readJson(path.join(STATE, "rc-tank.json"), null);
  const observe = readJson(path.join(STATE, "observe.json"), null);
  /* T-26 · the rc-rental sensor: a SOURCED delegation-APR finding from the
   * webintel rotation surfaces the market rate — labeled sourced, never invented.
   * T-45 · the deep probe (the marketplace's OWN page) outranks search
   * snippets: its full-text parse rides scan.rate, same rcRateFromIntel law. */
  const webintel = readJson(path.join(STATE, "webintel.json"), null);
  const wiFindings = (webintel?.scans ?? []).flatMap((sc) => sc?.findings ?? []);
  const rcDeepRate = (webintel?.scans ?? [])
    .filter((sc) => String(sc?.id ?? "").startsWith("rc-rental-deep") && sc?.rate?.aprPct)
    .map((sc) => ({ ...sc.rate, from: sc.id }))[0] ?? null;
  const rcRate = rcDeepRate ?? rcRateFromIntel(wiFindings);

  const rail = (id) => (econ?.rails ?? []).find((r) => r.id === id) ?? null;
  const venue = (id, label, r, note) => ({
    id, label,
    class: r?.confidence === "measured" ? "measured" : r?.confidence === "estimated" ? "estimated" : "blocked",
    usdPerDay: r?.measuredUsdPerDay ?? r?.estUsdPerDay ?? null,
    note: note ?? r?.note ?? "",
  });

  const mm = rail("market-making");
  const guard = econ?.makerGuard ?? null;
  const venues = [
    venue("market-making", "מעשה-שוק · ספר-STEEM/SBD", mm, guard?.action === "PAUSE-FLOW" ? `שומר-המעשה עצר את טרנס-ה-flow (${guard.verdict} ${guard.perDaySbd ?? ""} SBD/day) — ההון מנותב בינתיים למסילות-החיוביות` : null),
    venue("curation", "קיורציה · מסילת-דלק", rail("curation")),
    venue("convert-arb", "ארביטרז'-המרה · SBD print path", rail("convert-arb")),
    {
      id: "rc-rental", label: "השכרת-RC · דלק-עסקאות",
      class: rcRate ? "estimated" : "blocked",
      usdPerDay: rcRate && observe?.inventory?.spOwn != null && observe?.parity?.steemUsd != null
        ? Math.round(observe.inventory.spOwn * observe.parity.steemUsd * (rcRate.aprPct / 100) / 365 * 1e6) / 1e6
        : null,
      note: rcRate
        ? `${rcRate.note}${rcRate.url ? ` · מקור: ${rcRate.url.slice(0, 80)}` : ""} — ההצעה: rc-boost בקטלוג`
        : rctank?.maxRc ? `טנק ${Math.round(rctank.maxRc / 1e12 * 100) / 100}T RC בשימוש-שיווי-משקל נמוך — שוק-ההשכרה לא נמדד עדיין (החיישן: webintel rc-rental); ההצעה: rc-boost בקטלוג` : "RC tank unmeasured",
    },
    {
      id: "offer-catalog", label: "הצעה · מכירת-יכולות מדודות",
      class: catalog?.counts?.paidNew > 0 ? "measured" : "blocked",
      usdPerDay: catalog?.counts?.paidNew > 0 ? (catalog.orders ?? []).filter((o) => o.status === "PAID-NEW").reduce((a, o) => a + (o.amountSbd ?? 0), 0) * (observe?.parity?.sbdUsd ?? 0) : null,
      note: "המסילה הלא-פרופורציונלית להון — נמדדת מהתשלום הראשון שתיכנס",
    },
    hiveVenueRow(hiveState()), // T-59a · the measured second venue, honestly blocked (zero in totals)
  ];

  const plan = routePlan({
    venues,
    targetUsdPerDay: 1000,
    catalogPotentialUsdPerDay: null,
    capitalUsd: observe?.inventory?.spOwn != null && observe?.parity?.steemUsd != null
      ? Math.round(observe.inventory.spOwn * observe.parity.steemUsd * 100) / 100
      : null,
  });

  const doc = { at: now, law: ROUTER_LAW, ...plan, makerGuard: guard };
  writeJson(ROUTER_FILE, doc);
  return doc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runRouter(), null, 2));
}
