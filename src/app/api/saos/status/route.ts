import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * T-22 · THIN PROXY — THE ONE-BODY LAW (שכבות-שמדברות-שפה-אחת).
 * History: this route re-implemented engine domain logic (a second
 * pnlFromFills, second chain readers, FOUR hardcoded "headcorner" account
 * strings) — exactly the "layers killing each other in different languages"
 * the operator ordered killed. Now: every domain fact is computed ONCE by
 * the engine (/status on :3040 — its own doctrine account, its own laws);
 * this route only RENDERS the engine's truth into the cockpit's contract
 * (field-picking + display strings). If the engine is down, the last-good
 * response is served STALE-marked — never silently re-measured here.
 */
const ENGINE_HTTP = "http://127.0.0.1:3040";
const CACHE_TTL_MS = 45_000;
let cache: { at: number; data: unknown; good: boolean } | null = null;

async function engineStatus(): Promise<{ up: boolean; data: Record<string, unknown> | null }> {
  try {
    const r = await fetch(`${ENGINE_HTTP}/status`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!r.ok) return { up: false, data: null };
    return { up: true, data: (await r.json()) as Record<string, unknown> };
  } catch {
    return { up: false, data: null };
  }
}

export async function GET() {
  if (cache && cache.good && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  const { up, data: s } = await engineStatus();
  if (!up || !s) {
    /* honest degradation: last-good stale-marked, engine marked DOWN (we just
     * measured it down — the cached body's old engine.up=true must never
     * survive as a lie), or a hard down answer */
    if (cache?.good) {
      const prev = (cache.data as Record<string, unknown>).engine as Record<string, unknown> | null;
      const stale = { ...(cache.data as Record<string, unknown>), stale: true, engine: { ...(prev ?? {}), up: false, note: "המנוע כבוי כרגע — נתוני-האחרון-הטוב מוצגים stale" }, asof: new Date().toISOString() };
      return NextResponse.json(stale);
    }
    return NextResponse.json({
      ok: false, asof: new Date().toISOString(), engine: { up: false },
      sources: { kind: "thin-proxy", engineHttp: ENGINE_HTTP },
      notes: ["המנוע אינו זמין — אין מדידה-עוקפת-מנוע (חוק-הגוף-האחד)"],
    }, { status: 503 });
  }

  const observe = (s.observe ?? null) as Record<string, any> | null;
  const offer = (s.offer ?? null) as Record<string, any> | null;
  const daily = (s.daily ?? null) as Record<string, any> | null;
  const convertPlan = (s.convertPlan ?? null) as Record<string, any> | null;
  const live = (s.live ?? {}) as Record<string, any>;
  const orders = live.orders ?? [];
  const orderTotals = orders.reduce(
    (acc: { askedSteem: number; bidSbd: number }, o: { side: string; base: string }) => {
      const amt = Number(String(o.base).split(" ")[0]) || 0;
      if (o.side === "ask") acc.askedSteem = Math.round((acc.askedSteem + amt) * 1e3) / 1e3;
      else acc.bidSbd = Math.round((acc.bidSbd + amt) * 1e3) / 1e3;
      return acc;
    },
    { askedSteem: 0, bidSbd: 0 }
  );

  /* display composition (presentation only — the numbers are the engine's) */
  const fuelUsdPerDay = observe?.fuel?.fuelUsdPerDay ?? null;
  const authorUsdPerDay = observe?.fuel?.authorUsdPerDay ?? null;
  const rails = {
    fuel: fuelUsdPerDay,
    author: authorUsdPerDay,
    fuelWindowNote: observe?.fuel?.windowNote ?? null,
    fuelHistory:
      (observe?.fuel?.curationOps ?? 0) > 0
        ? `מסילת-הדלק חיה — ${observe.fuel.curationOps} פעולות-קיורציה בחלון-המדידה (${observe.fuel.windowSpanDays}d)`
        : "המסילה חמושה; חתימה-חסומה עד אימות-אישורי (שער-הדוקטרינה) — ההקמה: הדבקת סיסמת-master עדכנית בקונסול הארנק",
    deployedSteem: orderTotals.askedSteem,
    bidSbd: orderTotals.bidSbd,
    bookEmpty: orders.length === 0,
    bookNote: orders.length === 0 ? "הספר ריק — הנזילים ממתינים לאימות-חתימה; התוכנית OFFER-READY מוכנה במחזור" : null,
    convert: convertPlan
      ? {
          verdict: convertPlan.verdict ?? null,
          reason: convertPlan.reason ?? null,
          amountSbd: convertPlan.amountSbd ?? 0,
          marketSbdUsd: convertPlan.marketSbdUsd ?? null,
          impliedSbdUsd: convertPlan.impliedSbdUsd ?? null,
          marketSourceNote: convertPlan.marketSourceNote ?? null,
          at: convertPlan.at ?? null,
        }
      : null,
    autonomy: daily
      ? {
          ok: daily.ok ?? false,
          lastCycle: daily.finishedAt ?? daily.startedAt ?? null,
          steps: Object.fromEntries(
            Object.entries(daily.steps ?? {}).map(([k, v]: [string, any]) => [k, v?.ok === false ? "fail" : v?.skipped ? "skip" : "ok"])
          ),
        }
      : null,
    note: "כל המספרים מחושבים פעם-אחת במנוע :3040 — שכבת-התצוגה מציגה, לא מודדת",
  };
  const measuredPerDay =
    (daily?.rollup?.measuredTotalUsdPerDay as number | undefined) ?? null;

  /* public-only reshapes of engine truth (field-picking, zero math) */
  const curator = (s.curator ?? null) as Record<string, any> | null;
  const curatorPublic = curator
    ? {
        verdict: curator.verdict ?? null,
        day: curator.day ?? null,
        votesToday: Array.isArray(curator.votesToday) ? curator.votesToday.length : 0,
        totalVotes: curator.totalVotes ?? 0,
        vpEff: curator.vpEff ?? null,
        maxPerDay: curator.maxPerDay ?? null,
        txid: curator.txid ?? null,
        candidatesScanned: curator.candidatesScanned ?? null,
        lastVotes: (curator.votesToday ?? []).slice(-5).map((v: any) => ({ author: v.author, permlink: v.permlink, weight: v.weight, txid: v.txid })),
        rejectedTop: curator.rejectedTop ?? null,
      }
    : null;
  const intel = (s.intel ?? null) as Record<string, any> | null;
  const intelPublic = {
    at: intel?.at ?? null,
    decisions: (intel?.decisions ?? []).map((d: any) => ({ kind: d.kind, decision: d.decision, reason: d.reason })),
    book: intel?.book ?? null,
    spreadBpsRec: intel?.spreadBpsRec ?? null,
  };
  const learn = (s.learning ?? null) as Record<string, any> | null;
  const learningPublic = learn
    ? {
        verdict: learn.verdict ?? null,
        at: learn.at ?? null,
        runsTotal: learn.runsTotal ?? 0,
        lessons: (learn.lessons ?? []).slice(0, 4).map((l: any) => ({ id: l.id, severity: l.severity, lesson: l.lesson, evidence: l.evidence, action: l.action, resolved: l.resolved ?? null })),
        tuningsApplied: learn.tuningsApplied ?? [],
        tunings: learn.tunings ?? null,
        lessonsTotal: learn.lessonsTotal ?? null,
        cycleMetrics: {
          okRate: learn.metrics?.cycles?.okRate ?? null,
          window: learn.metrics?.cycles?.window ?? 0,
          failReasons: learn.metrics?.cycles?.failReasons ?? null,
          msP50: learn.metrics?.cycles?.msP50 ?? null,
        },
      }
    : null;
  const disc = (s.discovery ?? null) as Record<string, any> | null;
  const discoveryPublic = disc
    ? {
        verdict: disc.verdict ?? null,
        at: disc.at ?? null,
        opportunities: (disc.opportunities ?? []).slice(0, 4).map((o: any) => ({ id: o.id, kind: o.kind, potentialClass: o.potentialClass, evidence: o.evidence, potential: o.potential, gate: o.gate })),
        topTags: (disc.tagBoard ?? []).slice(0, 5).map((t: any) => ({ tag: t.tag, payoutsSbd: t.payoutsSbd })),
        curationEst: disc.curationEst ?? null,
      }
    : null;
  const hyperRaw = (s.hyper ?? {}) as Record<string, any>;
  const hyper = { ...hyperRaw.runtime, ops: hyperRaw.ops ?? null, running: hyperRaw.running ?? null, startedAt: hyperRaw.startedAt ?? null };
  const soldiersRaw = (s.soldiers ?? null) as Record<string, any> | null;
  const soldiersPublic = soldiersRaw
    ? {
        deployed: !!soldiersRaw.deployed,
        at: soldiersRaw.at ?? null,
        /* T-80: per-account custody + the freeze verdict pass through — the
         * cockpit must show keyless soldiers as FROZEN, never as deployed */
        accounts: (soldiersRaw.accounts ?? []).map((a: any) => ({ name: a.name, fingerprint: a.fingerprint, custody: a.custody ?? null })),
        frozen: soldiersRaw.frozen ?? (soldiersRaw.accounts ?? []).every((a: any) => a.custody !== "verified"),
        verdict: soldiersRaw.verdict ?? null,
        t80: soldiersRaw.t80 ?? null,
        fundingTxid: soldiersRaw.fundingTxid ?? null,
        fundedEach: soldiersRaw.fundedEach ?? null,
      }
    : null;
  const rolesRaw = (s.roles ?? null) as Record<string, any> | null;
  const econRaw = (s.economics ?? null) as Record<string, any> | null;

  const data = {
    ok: true,
    asof: new Date().toISOString(),
    account: s.account ?? null,
    engine: { up: true, info: { service: "saos-engine", doctrine: "one-body" }, keyless: false },
    grid: s.state ?? null,
    observe,
    offer,
    live: {
      orders,
      orderTotals,
      balances: live.balances ?? null,
      rc: live.rcPct != null ? { rcPct: live.rcPct } : null,
      chainReadOk: !!live.chainReadOk,
    },
    profit: s.profit ?? null,
    rails,
    daily,
    measuredPerDay,
    events: s.events ?? [],
    execution: { ...(s.execution ?? null), log: s.execLog ?? [] },
    soldiers: soldiersPublic,
    curator: curatorPublic,
    intel: intelPublic,
    learning: learningPublic,
    adaptation: s.adaptation ?? null, /* R210: learned-rule state (verdicts only) */
    discovery: discoveryPublic,
    fleet: s.fleet ?? null,
    credential: s.credential ?? null,
    spoilage: s.spoilage ?? null,
    hyper,
    /* T-21/22: roster + rails + the standing teams + the measured RC curve */
    roles: rolesRaw
      ? {
          verdict: rolesRaw.verdict ?? null,
          active: rolesRaw.active ?? null,
          total: rolesRaw.total ?? null,
          ladderNote: rolesRaw.ladderNote ?? null,
          roster: (rolesRaw.roster ?? []).slice(0, 12),
        }
      : null,
    economics: econRaw
      ? {
          asof: econRaw.asof ?? null,
          rails: (econRaw.rails ?? []).map((r: any) => ({
            id: r.id, label: r.label, measuredUsdPerDay: r.measuredUsdPerDay ?? null,
            estUsdPerDay: r.estUsdPerDay ?? null, confidence: r.confidence, note: r.note,
          })),
          totalMeasuredUsdPerDay: econRaw.totalMeasuredUsdPerDay ?? null,
          totalEstUsdPerDay: econRaw.totalEstUsdPerDay ?? null,
          measuredCount: econRaw.measuredCount ?? null,
          estimatedCount: econRaw.estimatedCount ?? null,
          blockedCount: econRaw.blockedCount ?? null,
          law: econRaw.law ?? null,
          payoutClock: econRaw.payoutClock ?? null,
          pendingRewards: econRaw.pendingRewards ?? null,
          x2: econRaw.x2 ?? null,
        }
      : null,
    webintel: s.webintel ?? null,
    content: s.content ?? null,
    rcTank: s.rcTank ?? null,
    payouts: s.payouts ?? null,
    weave: s.weave ?? null,
    sources: { kind: "thin-proxy-one-body", engineHttp: ENGINE_HTTP, doctrineAccount: s.account ?? null },
    notes: [
      "חוק-הגוף-האחד (T-22): כל עובדת-דומיין מחושבת פעם-אחת במנוע — שכבה-זו מציגה בלבד",
      "אמת-שרשרת בלבד; אישורי-חתימה מוחזקים-מנוע, מוגבלים-דוקטרינה, לעולם לא נרשמים",
    ],
  };
  cache = { at: Date.now(), data, good: true };
  return NextResponse.json(data);
}
