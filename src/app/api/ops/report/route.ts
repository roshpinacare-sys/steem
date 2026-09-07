import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getLiveAccount } from "@/lib/steem/steem-live";
import {
  WINDOW_KEY,
  WINDOW_OPEN_THRESHOLD_PCT,
  getMarketSnapshot,
} from "@/lib/steem/market-snapshot";

export const dynamic = "force-dynamic";

/**
 * Console v2 — weekly operator report (docs/CONSOLE_PLAN.md §7 v2).
 * Assembles runbook progress + capital P&L + live account + BOT-3 window
 * history into one Hebrew markdown document, and returns it next to the
 * structured data so the UI can copy/download it. READ-ONLY.
 *
 * GET /api/ops/report?username=headcorner
 *   → { ok, generatedAt, username, markdown,
 *       report: { window, runbook, capital, account, opportunities } }
 */

const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;

const IL_TIME = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  dateStyle: "short",
  timeStyle: "short",
});

function sign(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function int(n: number): string {
  return n.toLocaleString("en-US");
}

export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "headcorner")
    .trim()
    .replace(/^@/, "");
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ ok: false, error: "שם משתמש לא תקין" }, { status: 400 });
  }

  try {
    // Live sources run in parallel; each failure degrades its own section.
    const [liveRes, snapRes, tasks, capital, samples, alerts] = await Promise.all([
      getLiveAccount(username).catch(() => null),
      getMarketSnapshot().catch(() => null),
      db.opsTask.findMany({ orderBy: [{ order: "asc" }] }),
      db.capitalEvent.findMany({ orderBy: [{ occurredAt: "desc" }], take: 50 }),
      db.windowSample.findMany({
        where: { key: WINDOW_KEY, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
      db.watchAlert.findMany({
        where: { key: WINDOW_KEY },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    // ── Window section ────────────────────────────────────────────────────
    const edges = samples.map((s) => s.edgePct).sort((a, b) => a - b);
    const windowMd: string[] = [];
    if (snapRes) {
      windowMd.push(
        `מצב: ${snapRes.openExec ? "פתוח" : "סגור"} (סף ${WINDOW_OPEN_THRESHOLD_PCT}% ניתן-לביצוע) · feed מפעיל ${snapRes.feed.toFixed(4)} · bid ${snapRes.bidTop.toFixed(5)}`,
      );
      windowMd.push(
        `edge: ספר-על ${sign(snapRes.edgeInternalPct)} · ניתן-לביצוע ב-100 SBD ${sign(snapRes.execEdgePct)} · נפח 24 שע' ${snapRes.vol24h ? `${snapRes.vol24h.sbd.toFixed(0)} SBD (${snapRes.vol24h.trades} עסקאות)` : "לא זמין"}`,
      );
      windowMd.push(
        `ציטוט עדים (top-21) ${snapRes.witnessQuoteMedian.toFixed(4)} — סדרת הציטוטים אינה ה-feed המפעיל (רוסט: docs/ROAST.md)`,
      );
    } else {
      windowMd.push("מצב: הסריקה החיה נכשלה כרגע");
    }
    windowMd.push(
      `דגימות 7 ימים: ${samples.length}${edges.length ? ` · טווח edge: ${sign(edges[0])} … ${sign(edges[edges.length - 1])}` : ""}`,
    );
    if (alerts.length) {
      windowMd.push("התראות אחרונות:");
      for (const a of alerts) {
        windowMd.push(`- ${IL_TIME.format(a.createdAt)} — ${a.message}`);
      }
    } else {
      windowMd.push("התראות: עדיין אין מעברי חלון שנרשמו.");
    }

    // ── Runbook section ───────────────────────────────────────────────────
    const byStatus = { todo: 0, active: 0, done: 0, blocked: 0 };
    for (const t of tasks) {
      if (t.status in byStatus) byStatus[t.status as keyof typeof byStatus] += 1;
    }
    const donePct = tasks.length ? Math.round((byStatus.done / tasks.length) * 100) : 0;
    const next = tasks
      .filter((t) => t.status === "todo" || t.status === "active")
      .sort((a, b) => a.order - b.order)
      .slice(0, 3);
    const runbookMd = [
      `התקדמות: ${byStatus.done}/${tasks.length} הושלמו (${donePct}%) · בעבודה ${byStatus.active} · חסומות ${byStatus.blocked}`,
      ...next.map((t) => `- הצעד הבא #${t.order} [${t.phase}] ${t.title} (${t.status})`),
      ...(next.length === 0 ? ["- אין משימות פתוחות — כל הראנבוק סגור."] : []),
    ];

    // ── Capital section ───────────────────────────────────────────────────
    const sums = { deposit: 0, convert_result: 0, reward: 0, expense: 0 };
    for (const e of capital) sums[e.kind as keyof typeof sums] += e.amountUsd;
    const net = sums.deposit + sums.convert_result + sums.reward - sums.expense;
    const cycleCount = capital.filter((e) => e.kind === "convert_result").length;
    const capitalMd = [
      `הפקדות ${usd(sums.deposit)} · תוצאות מחזור ${usd(sums.convert_result)} · פרסים ${usd(sums.reward)} · הוצאות ${usd(sums.expense)}`,
      `P&L נטו: ${usd(net)} · מחזורי המרה שרושמו: ${cycleCount}`,
      ...(capital.length
        ? [`אירוע אחרון: ${capital[0].note || capital[0].kind} — ${usd(capital[0].amountUsd)} (${IL_TIME.format(capital[0].occurredAt)})`]
        : ["יומן ההון ריק — התחל ברישום הפקדה."]),
    ];

    // ── Account section (live) ────────────────────────────────────────────
    let accountMd: string[];
    let oppClaim: string | null = null;
    let oppHygiene: string | null = null;
    if (liveRes?.ok) {
      const b = liveRes.balances;
      // pendingSp is already in SP units (vests pre-converted in steem-live)
      const pendingUsd =
        b.pendingSteem * liveRes.chain.steemUsd +
        b.pendingSbd * liveRes.chain.sbdUsd +
        b.pendingSp * liveRes.chain.steemUsd;
      const stale = liveRes.security.staleAuths;
      accountMd = [
        `SP יעיל ${int(b.spEffective)} (עצמי ${int(b.spOwn)} · נכנס ${int(b.spIn)} · יוצא ${int(b.spOut)}) · נזיל ${b.steem.toFixed(3)} STEEM · ${b.sbd.toFixed(3)} SBD`,
        `VP ${liveRes.power.votingPower.toFixed(2)}% · RC ${liveRes.power.rcPct.toFixed(1)}% · פרסים ממתינים ${b.pendingSp.toFixed(1)} SP + ${b.pendingSteem.toFixed(3)} STEEM + ${b.pendingSbd.toFixed(3)} SBD (${usd(pendingUsd)})`,
        `הרשאות posting: ${liveRes.security.postingAuths.length} (${stale} מיושנות) · בלוק ${int(liveRes.chain.headBlock)}`,
      ];
      oppClaim =
        b.pendingSteem + b.pendingSbd + b.pendingSp > 0.0001
          ? `תביעת פרסים — מוכן (${usd(pendingUsd)}) [posting]`
          : null;
      oppHygiene =
        stale > 0 ? `ניקוי הרשאות — ${stale} מיושנות [owner אופליין]` : null;
    } else {
      accountMd = ["החשבון החי לא זמין כרגע (שגיאת RPC)."];
    }

    // ── Opportunities ─────────────────────────────────────────────────────
    const opportunities: string[] = [];
    if (oppClaim) opportunities.push(oppClaim);
    if (snapRes?.openExec)
      opportunities.push(
        `BOT-3 — חלון פתוח ${sign(snapRes.execEdgePct)} ניתן-לביצוע ב-100 SBD למחזור 3.5 יום [active]`,
      );
    if (oppHygiene) opportunities.push(oppHygiene);
    opportunities.push("ברית-עדים (S7) — מילוי 30 הצבעות עדים [posting]");
    if (cycleCount === 0)
      opportunities.push("רישום המחזור הראשון ביומן ההון לאחר הביצוע [none]");

    const markdown = [
      `# SAOS — דוח שבועי (Console v2)`,
      `נוצר: ${IL_TIME.format(new Date())} (Asia/Jerusalem) · חשבון: @${username}`,
      ``,
      `## 1. חלון BOT-3`,
      ...windowMd,
      ``,
      `## 2. ראנבוק`,
      ...runbookMd,
      ``,
      `## 3. יומן הון`,
      ...capitalMd,
      ``,
      `## 4. חשבון @${username} (חי)`,
      ...accountMd,
      ``,
      `## 5. הזדמנויות מוכנות`,
      ...opportunities.map((o, i) => `${i + 1}. ${o}`),
      ``,
      `---`,
      `קריאה-בלבד מהשרשרת · החתימה תמיד אצל המפעיל · docs/CONSOLE_PLAN.md`,
    ].join("\n");

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      username,
      markdown,
      report: {
        window: {
          open: snapRes?.openExec ?? null,
          edgePct: snapRes?.edgeInternalPct ?? null,
          execEdgePct: snapRes?.execEdgePct ?? null,
          feed: snapRes?.feed ?? null,
          bidTop: snapRes?.bidTop ?? null,
          witnessQuoteMedian: snapRes?.witnessQuoteMedian ?? null,
          vol24hSbd: snapRes?.vol24h?.sbd ?? null,
          samples7d: samples.length,
          maxEdge7d: edges.length ? edges[edges.length - 1] : null,
          minEdge7d: edges.length ? edges[0] : null,
          alerts: alerts.length,
        },
        runbook: { total: tasks.length, ...byStatus, donePct },
        capital: { ...sums, netUsd: net, cycleCount },
        account: liveRes?.ok
          ? {
              spEffective: liveRes.balances.spEffective,
              votingPower: liveRes.power.votingPower,
              rcPct: liveRes.power.rcPct,
              pendingSp: liveRes.balances.pendingSp,
              staleAuths: liveRes.security.staleAuths,
              headBlock: liveRes.chain.headBlock,
            }
          : null,
        opportunities,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת דוח" },
      { status: 502 },
    );
  }
}
