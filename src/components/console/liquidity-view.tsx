"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LiquidityView (Task 47) — ממלכת-הנזילות: בריכת-AMM על אוטובוס saos, grid-MM
// מעוגן-כושר-פירעון, ניתוב-חיילים (escrow→SAOS→LP→עמלות), ארנק רשתות-אחרות
// (HE) לגרירת-ערך, ומדרגת-הג'נזיס. הכל נמדד מה-replay — לא מהבטחות.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Droplets, GitBranch, Layers, RefreshCw, Shuffle, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import { fmtNum, relTime, runExec, useLiq } from "./api";

function Tile({ label, value, sub, accent = "text-zinc-100" }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${accent}`} dir="ltr">
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: typeof Droplets; title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-emerald-400" aria-hidden="true" />
      <div>
        <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
        <p className="text-[10px] text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}

export function LiquidityView() {
  const liq = useLiq();
  const { toast } = useToast();
  const [seeding, setSeeding] = useState(false);

  const pool = liq?.mainPool ?? null;
  const dex = liq?.dex ?? null;
  const floor =
    dex?.solvency && dex.solvency.issuerLiquidSteem != null && dex.mine
      ? null
      : null;
  // רצפת-פירעון מחושבת מהמדידות: אוצר-נזיל ÷ היצע-נגזר (מהיתרות-הריפליי)
  const supplyTotal =
    (dex?.balances ?? []).reduce((s, b) => s + b.saos + b.locked, 0) || 0;
  const issuerSteem = dex?.solvency?.issuerLiquidSteem ?? null;
  const floorSteem = supplyTotal > 0 && issuerSteem && issuerSteem > 0 ? issuerSteem / supplyTotal : null;
  const fairSteem = floorSteem != null ? floorSteem * 1.25 : null;
  const poolMid = pool && pool.saos > 0 ? pool.steem / pool.saos : null;
  void floor;

  const seed = async (live: boolean) => {
    setSeeding(true);
    try {
      const res = await fetch("/api/ops/agent/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "liq", params: live ? { real: true } : undefined }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && (j.ok ?? true)) {
        toast({ title: live ? "זריעת-נזילות חיה הופעלה" : "זריעה-יבשה הופעלה", description: "התוצאה תופיע ביומן-ההרצות בעוד רגע" });
      } else {
        toast({ title: "הפעלה נדחתה", description: j.error ?? "שגיאה לא ידועה", variant: "destructive" });
      }
    } finally {
      setSeeding(false);
    }
  };

  if (!liq) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  const asks = dex?.book?.asks ?? [];
  const bids = dex?.book?.bids ?? [];
  const trades = dex?.trades ?? [];
  const routing = liq.routing;
  const lps = pool?.lp ?? [];
  const lpRows = lps.filter((l) => l.shares > 0);
  const soldierLps = lpRows.filter((l) => l.account !== liq.issuer);

  return (
    <div className="space-y-5">
      {/* כותרת + מחירים */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-black text-zinc-100">
                <Droplets className="size-5 text-emerald-400" aria-hidden="true" />
                ממלכת הנזילות
              </h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                בריכת-AMM על אוטובוס <span className="font-mono" dir="ltr">saos/v1</span> · grid-MM מעוגן-כושר-פירעון · חיילים כספקי-נזילות · לכידת-עמלות נמדדת
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="border-zinc-700" disabled={seeding} onClick={() => seed(false)}>
                <RefreshCw className={`size-3.5 ${seeding ? "animate-spin" : ""}`} aria-hidden="true" />
                זריעה-יבשה
              </Button>
              <Button size="sm" className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" disabled={seeding} onClick={() => seed(true)}>
                זריעת-נזילות חיה
              </Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="מחיר-הוגן (עוגן-פירעון ×1.25)" value={fairSteem != null ? `${fmtNum(fairSteem, 4)} STEEM` : "—"} sub={floorSteem != null ? `רצפה ${fmtNum(floorSteem, 4)}` : "רצפה לא נמדדה"} accent="text-amber-300" />
            <Tile label="מחיר אחרון בספר" value={dex?.stats?.lastPrice != null ? `${fmtNum(dex.stats.lastPrice, 4)}` : "—"} sub={`ספרייה ${dex?.stats?.spreadPct != null ? fmtNum(dex.stats.spreadPct, 2) + "%" : "—"}`} />
            <Tile label="מרכז בריכה (x·y=k)" value={poolMid != null ? fmtNum(poolMid, 4) : "—"} sub={pool ? `k=${fmtNum(pool.saos * pool.steem, 2)}` : "אין בריכה"} accent="text-emerald-300" />
            <Tile label="עמלות שנלכדו (30bps)" value={`${fmtNum(pool?.feesSteem ?? 0, 6)} / ${fmtNum(pool?.feesSaos ?? 0, 3)}`} sub="STEEM / SAOS — לתוך הבריכה" accent="text-emerald-300" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* בריכת AMM */}
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="p-4">
            <SectionTitle icon={Droplets} title="בריכת SAOS:STEEM" sub="חוזה-חכם על-השרשרת: x·y=k, עמלה 0.3% נכנסת לבריכה (ל-LP)" />
            {pool ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Tile label="עתודת SAOS" value={fmtNum(pool.saos, 3)} />
                  <Tile label="עתודת STEEM" value={fmtNum(pool.steem, 4)} />
                  <Tile label="מניות-LP" value={fmtNum(pool.lpSupply, 2)} />
                  <Tile label="החלפות (swaps)" value={String(pool.swaps)} />
                </div>
                <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                      <tr>
                        <th className="px-2.5 py-1.5 text-right font-medium">ספק-נזילות</th>
                        <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">Shares</th>
                        <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lpRows.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-2.5 py-2 text-center text-zinc-600">אין ספקים עדיין</td>
                        </tr>
                      )}
                      {lpRows.map((l) => (
                        <tr key={l.account} className="border-t border-zinc-800/70">
                          <td className="px-2.5 py-1.5 font-mono text-zinc-300" dir="ltr">@{l.account}</td>
                          <td className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-400" dir="ltr">{fmtNum(l.shares, 3)}</td>
                          <td className="px-2.5 py-1.5 font-mono tabular-nums text-emerald-300" dir="ltr">{fmtNum(pool.lpSupply > 0 ? (l.shares / pool.lpSupply) * 100 : 0, 1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[10px] text-zinc-600">
                  חיילים-LP: <span className="font-mono" dir="ltr">{soldierLps.length}</span> · העמלות מתגלגלות לעתודות — חלקם היחסי של ה-LP גדל עם כל החלפה
                </p>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
                אין בריכה עדיין — לחץ <span className="font-semibold text-emerald-400">זריעת-נזילות חיה</span> להקמת הבריכה הראשונה על-השרשרת
              </div>
            )}
          </CardContent>
        </Card>

        {/* רשת-Grid */}
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="p-4">
            <SectionTitle icon={Layers} title="רשת-הפקודות (Grid MM)" sub="רמות סביב ההוגן — הספר הוא replay של ההיסטוריה הציבורית" />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="max-h-52 overflow-y-auto rounded-lg border border-zinc-800">
                <div className="sticky top-0 bg-zinc-900 px-2.5 py-1.5 text-[10px] font-semibold text-rose-300">מדפי-מכירה (asks)</div>
                {asks.length === 0 && <div className="px-2.5 py-2 text-[11px] text-zinc-600">אין</div>}
                {asks.map((o) => (
                  <div key={o.oid} className="flex items-center justify-between border-t border-zinc-800/70 px-2.5 py-1.5 text-[11px]">
                    <span className="font-mono tabular-nums text-rose-300" dir="ltr">{fmtNum(o.price, 4)}</span>
                    <span className="font-mono tabular-nums text-zinc-400" dir="ltr">{fmtNum(o.remaining, 3)} SAOS</span>
                    <span className="font-mono text-[9px] text-zinc-600" dir="ltr">@{o.owner}</span>
                  </div>
                ))}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-zinc-800">
                <div className="sticky top-0 bg-zinc-900 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-300">הצעות-קנייה (bids)</div>
                {bids.length === 0 && <div className="px-2.5 py-2 text-[11px] text-zinc-600">אין</div>}
                {bids.map((o) => (
                  <div key={o.oid} className="flex items-center justify-between border-t border-zinc-800/70 px-2.5 py-1.5 text-[11px]">
                    <span className="font-mono tabular-nums text-emerald-300" dir="ltr">{fmtNum(o.price, 4)}</span>
                    <span className="font-mono tabular-nums text-zinc-400" dir="ltr">{fmtNum(o.remaining, 3)} SAOS</span>
                    <span className="font-mono text-[9px] text-zinc-600" dir="ltr">@{o.owner}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-2 text-[10px] text-zinc-600">
              ה-ask התקוע ההיסטורי (1551 STEEM) בוטל אוטומטית — תיקון-על: אף מדף לא נשאר מחוץ לרשת · מכסת-שידורים יומית {liq.mm.broadcastsToday}/24
            </p>
          </CardContent>
        </Card>

        {/* ניתוב-חיילים */}
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="p-4">
            <SectionTitle icon={Users} title="ניתוב-חיילים לכלכלה הסגורה" sub="שכר/יתרה → escrow → קרדיט → SAOS → מניות-LP → עמלות" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="escrow היום" value={String(routing.escrowsToday)} sub="חיילים הפקידו STEEM" accent="text-emerald-300" />
              <Tile label="חיילי-LP" value={String(soldierLps.length)} sub="מחזיקי מניות-בריכה" accent="text-emerald-300" />
              <Tile label="ארביטראז' היום" value={String(routing.arbsToday)} sub="בריכה↔ספר" accent="text-amber-300" />
              <Tile label="מילויים היום" value={String(liq.mm.fillsToday)} sub="המרות קרדיט→SAOS" />
            </div>
            <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-zinc-800">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                  <tr>
                    <th className="px-2.5 py-1.5 text-right font-medium">חייל</th>
                    <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">escrow (STEEM)</th>
                    <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">LP shares</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(routing.escrowedBySoldier).length === 0 && Object.keys(routing.lpGranted).length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2.5 py-2 text-center text-zinc-600">עדיין לא נותבו חיילים — הלולאה תפעל אוטומטית כשיהיה עודף-STEEM</td>
                    </tr>
                  )}
                  {Object.entries(routing.escrowedBySoldier).map(([acc, rec]) => (
                    <tr key={acc} className="border-t border-zinc-800/70">
                      <td className="px-2.5 py-1.5 font-mono text-zinc-300" dir="ltr">@{acc}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-400" dir="ltr">{fmtNum(rec.amt ?? 0, 3)}{rec.txid ? ` · ${String(rec.txid).slice(0, 8)}…` : ""}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-emerald-300" dir="ltr">{routing.lpGranted[acc] != null && routing.lpGranted[acc] > 0 ? fmtNum(routing.lpGranted[acc], 3) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {routing.lastAction && <p className="mt-2 text-[10px] text-zinc-600">פעולה אחרונה: {routing.lastAction}</p>}
          </CardContent>
        </Card>

        {/* רשתות-אחרות: HE + מדרגה + גשר */}
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="p-4">
            <SectionTitle icon={GitBranch} title="גרירת-ערך מרשתות אחרות" sub="ארנק Hive-Engine (מועמדי-צמדים/מדרגה) · מדרגת-הג'נזיס · הגשר" />
            <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-zinc-800">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                  <tr>
                    <th className="px-2.5 py-1.5 text-right font-medium">חשבון</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">מטבע</th>
                    <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">Balance</th>
                    <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">Staked</th>
                  </tr>
                </thead>
                <tbody>
                  {liq.heWallet.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2.5 py-2 text-center text-zinc-600">ארנק-HE ריק / לא נמדד</td>
                    </tr>
                  )}
                  {liq.heWallet.slice(0, 24).map((r) => (
                    <tr key={r.account + r.symbol} className="border-t border-zinc-800/70">
                      <td className="px-2.5 py-1.5 font-mono text-zinc-300" dir="ltr">@{r.account}</td>
                      <td className="px-2.5 py-1.5"><Badge variant="outline" className="border-zinc-700 px-1 py-0 font-mono text-[9px] text-amber-300">{r.symbol}</Badge></td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-400" dir="ltr">{fmtNum(r.balance, 3)}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-500" dir="ltr">{fmtNum(r.stake, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Tile label="SWAP.HIVE במדרגה" value={liq.ladder.swapHive != null ? fmtNum(liq.ladder.swapHive, 3) : "—"} sub="מכירות→BEE→SAOS-HE" />
              <Tile label="BEE שנאסף" value={liq.ladder.bee != null ? fmtNum(liq.ladder.bee, 2) : "—"} sub={liq.ladder.token?.created ? "SAOS-HE קיים!" : "יעד 100 → ג'נזיס"} accent="text-amber-300" />
              <Tile label="עוגני-גשר" value={liq.bridge.anchoredTotal != null ? String(liq.bridge.anchoredTotal) : "—"} sub="Steem→Hive פריטה" accent="text-emerald-300" />
            </div>
            <p className="mt-2 text-[10px] text-zinc-600">
              מסילת-ה-on-ramp פתוחה לכל אחד: transfer STEEM ← memo <span className="font-mono" dir="ltr">saos:escrow</span> ← קרדיט בדקס שלנו. שימוש חוזר באמצעים מכל רשת — בלי עמלות.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* מילויים אחרונים */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-4">
          <SectionTitle icon={Shuffle} title="מילויים אחרונים בספר" sub="כל מילוי מאומת ב-replay הציבורי — txid לכל עסקה" />
          {trades.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-xs text-zinc-600">אין מילויים עדיין — הרשת חדשה</div>
          ) : (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-zinc-800">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                  <tr>
                    <th className="px-2.5 py-1.5 text-right font-medium">זמן</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">מייקר / טייקר</th>
                    <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">Amount</th>
                    <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">Price</th>
                    <th className="px-2.5 py-1.5 text-left font-medium" dir="ltr">txid</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.idx} className="border-t border-zinc-800/70">
                      <td className="px-2.5 py-1.5 text-zinc-500">{relTime(t.time)}</td>
                      <td className="px-2.5 py-1.5 font-mono text-zinc-400" dir="ltr">@{t.maker}→@{t.taker}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-300" dir="ltr">{fmtNum(t.amount, 3)}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums text-amber-300" dir="ltr">{fmtNum(t.price, 4)}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[9px] text-zinc-600" dir="ltr">{t.txid ? t.txid.slice(0, 10) + "…" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[10px] text-zinc-600">
            סה״כ עסקאות ב-replay: <span className="font-mono" dir="ltr">{dex?.stats?.tradesTotal ?? 0}</span> · נפח-24h: <span className="font-mono" dir="ltr">{fmtNum(dex?.stats?.vol24hSaos ?? 0, 3)} SAOS / {fmtNum(dex?.stats?.vol24hSteem ?? 0, 4)} STEEM</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
