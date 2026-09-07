"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SystemView — the machine room: daemon loops table, machine-proof matrix
// (with re-run), bridge/anchors, derived identity. Pure transparency.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  relTime,
  sendEncryptedCommand,
  useEmployment,
  useExec,
  useForkscan,
  useInfraStatus,
  useProofs,
  useSovereignBorrow,
  useSovereignCross,
  useSovereignMicrodex,
  useCase66,
  useSaosNet,
  useSovereignPaymaster,
  useSovereignRc,
  useSovereignReflex,
  useSovereignValue53,
  useWrapped,
  type AgentStatus,
  type BrainResponse,
} from "./api";
import { SelfhostCard } from "./selfhost-card";
import { HeReportCard } from "./he-report-card";

const LOOP_LABELS: Record<string, { label: string; what: string }> = {
  claim: { label: "דרישת-פרסים", what: "דורש פרסי תוכן/אצירה שהצטברו" },
  watcher: { label: "צופה-שוק", what: "מודד חלון-הזדמנות ומחיר" },
  transferWatch: { label: "צופה-העברות", what: "מזהה escrow/העברות נכנסות" },
  curation: { label: "אצירה", what: "מצביע לפוסטים נבחרים כש-VP גבוה" },
  factory: { label: "מפעל-זהויות", what: "מטמיע סוכן חדש כשיש טיקט+RC" },
  empire: { label: "סריקת-אימפריה", what: "מאתר חשבונות שהמפתחות שלך שולטים בהם" },
  dexMm: { label: "עשיית-שוק", what: "מצטט ומאזן את ספר SAOS בשרשרת" },
  bridge: { label: "גשר דו-שרשרתי", what: "מעגן כל פעולה על Hive + checkpoint" },
  armyClaim: { label: "צבא · דרישת-פרסים", what: "תובע פרסים לכל חשבון-צבא במפתח שלו" },
  armyCuration: { label: "צבא · אצירה משובצת", what: "כל חשבון מצביע על פס-אישי — בלי הצבעות-להקה" },
  armySweep: { label: "צבא · ריכוז-ערך", what: "יתרה נזילה מעל סף → עוברת לחשבון הראשי" },
  anchor: { label: "עוגן זהות חוצה-שרשראות", what: "חתימת EVM על אותו סוד → מוטמעת על Steem+Hive+Blurt כל 6h" },
  worldlog: { label: "יומן-עולם חתום-האש", what: "כל אירוע seq→sha256→prev על Steem+Hive — יומן בלתי-ניתן לזיוף" },
  commandBus: { label: "ערוץ-פקודה מוצפן", what: "memo ECDH → פענוח בצד החייל → saos_ack חתום" },
  fleetPace: { label: "פעימת-צי", what: "כל פעימה חייל אחד מצקצק fleet_ping במפתח שלו + מנתב נכס לבריכה (עמלה→LP)" },
  netTask: { label: "תור-משימות", what: "saos_task → הקצאה → פקודה מוצפנת → saos_result חתום" },
  liq: { label: "ממלכת-הנזילות", what: "ניתוב-חיילים (escrow→SAOS→LP) + ארביטראז' בריכה↔ספר" },
  genesis: { label: "מדרגת-ג'נזיס", what: "נכסים→SWAP.HIVE→BEE→הולדת SAOS על Hive-Engine" },
  fleetSell: { label: "נתיב-הצי (74)", what: "מנוע-ניתוב-בצורת-RC: פעולות-HE עוברות-דרך-חייל (מפתח-active + מאגר-RC משלו) כשהראש צמא — הזרימה-אף-פעם-לא-נעצרת · probe חי: רשת-3-רגליים מאומתת" },
  hivePower: { label: "ריבונות-RC ב-Hive", what: "מכונה אוטונומית SWAP.HIVE→HIVE→HP — מרימה maxRc עם שער-דלק ולמידת-וריאנט" },
  reflex: { label: "רפלקס-בלוק (54)", what: "טריגר-אוצר → 10 תגובות חתומות-מראש בבלוק N+1 · עוגן-Hive — אפס-אנרגיה-נזילה" },
  paymaster: { label: "PAYMASTER (62)", what: "המכונה משלמת גז ללקוחות: ממסר meta-tx + תדלוק אוטומטי + פנקס-ממו" },
  wrapped: { label: "WRAPPED (63)", what: "עגוני-ערך צמודים על הדקס: WSBD-1 (גיבוי SBD) + PHIVE-1 (נעילת-Hive) + maker BEE על Engine + לכידת-עמלות" },
  microdex: { label: "MICRODEX (65)", what: "חיילים חותמים-עצמם פעולות-דקס מיקרו (fill/order/pool_swap) במפתח-הפרסום-שלהם — שבירת-ריכוז-RC ותעסוקה-אוטונומית על הספר" },
  yield: { label: "YIELD (66)", what: "חלוקת-תשואה מעמלות-שנלכדו לפי תרומה-מדודה-מהשרשרת — הוכחת-מימון-עצמי ריבוני" },
  saosnet: { label: "SAOS-NET (68)", what: "הרשת-הריבונית שלנו: קרנל דטרמיניסטי · ג'נזיס-נגזר-מראיות · צ'קפוינטים מעוגנים Steem+Hive · חיילים-ולידטורים" },
  gitkeeper: { label: "gitkeeper (56)", what: "ביטוח-אובדן: שמירה-אוטומטית ל-origin כל 30 דק׳ — ה-repo הוא האמת" },
  guardian: { label: "guardian (82)", what: "אנטי-רולבק ל-origin/main + ריפוי-עצמי deps/env/דמון + שחזור-צי אפס-מגע מהחותמת" },
  chainAttest: { label: "עדות-חיה (82)", what: "height+stateRoot+commit מעידים על עצמם על Steem+Hive כל 30 דק׳ — העד שלא ניתן לשקרו" },
  heReport: { label: "דוח-עברי-חי (85)", what: "he_report.cjs כותב docs/REPORT_HE.md כל 30 דק׳ — סיכום עברי ב-repo ובקונסולה" },
  linkage: { label: "אחדות-הצי (87)", what: "כל חייל מקושר-היטב לראש: posting.account_auths ∋ headcorner ×steem+hive · תיקון-עצמי חתום (אפס-מחיקת-מפתחות) + RC-דיסציפלינה — מוגנים-מריקון עד-שמתחברים" },
};

/* 68 — SAOS-NET: הרשת-הריבונית שלנו (הקרקע למשהו גדול) */
function SaosNetCard() {
  const d = useSaosNet(true);
  const g = d?.genesis;
  const n = d?.node;
  const q = d?.quorum;
  const lastCp = n?.lastCheckpoint ?? null;
  const steemAnchor = lastCp?.anchors?.steem ?? null;
  const hiveAnchor = lastCp?.anchors?.hive ?? null;
  const rec = d?.recovery;
  const mir = n?.mirror ?? null;
  const sov = n?.sov ?? null;
  const bk = n?.book ?? null;
  const mirTotal = mir ? mir.sales + mir.yields + mir.poolAdds + mir.poolSwaps : 0;
  const econTotal = sov ? sov.floats + sov.orders + sov.fills + sov.matches : 0;
  return (
    <Card className="border-violet-900/40 bg-violet-400/[0.03]">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-violet-300">SAOS-NET — הרשת-הריבונית שלנו (68→70)</span>
          {sov && econTotal > 0 && (
            <Badge variant="outline" className="border-fuchsia-400/40 bg-fuchsia-400/10 px-1.5 py-0 font-mono text-[10px] text-fuchsia-300">
              STAGE-2 ECONOMY · {econTotal} ops
            </Badge>
          )}
          {steemAnchor && (
            <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 font-mono text-[10px] text-emerald-300">
              steem-anchor ✓ {String(steemAnchor).slice(0, 8)}…
            </Badge>
          )}
          {q && q.attestVerified > 0 && (
            <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 px-1.5 py-0 font-mono text-[10px] text-violet-300">
              quorum {q.attestVerified}/{q.attestTotal} attests ✓
            </Badge>
          )}
          {rec?.verdict === "REINCARNATION-READY" && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 font-mono text-[10px] text-amber-300">
              phoenix ✓ ready
            </Badge>
          )}
          {mir && mirTotal > 0 && (
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 font-mono text-[10px] text-cyan-300">
              mirror {mirTotal} events · sale {mir.sales} · yield {mir.yields} · LP {mir.poolAdds}
            </Badge>
          )}
        </div>
        {!d ? (
          <Skeleton className="mt-3 h-16 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-violet-200">הג'נזיס-הנגזר-מראיות (לא-מומצא — מה-replay)</div>
                <Badge variant="outline" className="border-zinc-800 bg-zinc-950/60 px-1.5 py-0 text-[9px] text-zinc-400">
                  saos-net/0
                </Badge>
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-violet-200" dir="ltr">
                genesisHash {String(g?.genesisHash ?? "—").slice(0, 20)}…
              </div>
              <div className="mt-1 font-mono text-[10px] text-zinc-300" dir="ltr">
                supply {g?.supplySaos ?? "—"} SAOS · {g?.counts?.accounts ?? "—"} accounts · {g?.counts?.wrappedSymbols ?? "—"} wrapped · {g?.counts?.lpHolders ?? "—"} LP
              </div>
              <div className="mt-1 font-mono text-[9px] text-zinc-500" dir="ltr">
                sources: {(g?.sources ?? []).join(" · ") || "—"}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-violet-200">הצומת החי (בלוקים + עיגונים)</div>
              <div className="mt-1.5 font-mono text-[10px] text-violet-200" dir="ltr">
                height {n?.height ?? "—"} · root {String(n?.stateRoot ?? "—").slice(0, 16)}… · beats {n?.beats ?? "—"}
              </div>
              <div className="mt-1 font-mono text-[9px]" dir="ltr">
                <span className={steemAnchor ? "text-emerald-300/80" : "text-zinc-500"}>steem: {steemAnchor ? "✓ " + String(steemAnchor).slice(0, 14) + "…" : "pending (RC-regen · fleet-fallback armed)"}</span>
                <span className={hiveAnchor && !String(hiveAnchor).startsWith("pending") ? " text-emerald-300/80" : " text-zinc-500"}> · hive: {hiveAnchor ? String(hiveAnchor).slice(0, 16) : "pending (fleet-RC)"}</span>
              </div>
              {lastCp && (
                <div className="mt-1 border-t border-zinc-800 pt-1.5 font-mono text-[9px] text-zinc-400" dir="ltr">
                  cp@{lastCp.height} · attests {lastCp.attests.filter((a) => a.verified).length}/{lastCp.attests.length} · {lastCp.attests.map((a) => "@" + a.by).join(", ") || "—"}
                </div>
              )}
              {d?.blocks && d.blocks.length > 0 && (
                <div className="mt-1 truncate font-mono text-[9px] text-zinc-500" dir="ltr">
                  last block {d.blocks[d.blocks.length - 1].height}: {d.blocks[d.blocks.length - 1].heartbeat ?? "—"}
                </div>
              )}
              {mir && (
                <div className="mt-1 border-t border-zinc-800 pt-1.5 font-mono text-[9px] text-cyan-200/80" dir="ltr">
                  STAGE-1 MIRROR: {mirTotal} host events → sovereign txs (failed {mir.failed} · beats {mir.beats})
                </div>
              )}
            </div>
            {bk && (
              <div className="rounded-lg border border-fuchsia-900/40 bg-fuchsia-400/[0.04] p-2.5 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-fuchsia-200">STAGE-2 ECONOMY — הספר-הריבוני סוחר (70)</div>
                  <Badge variant="outline" className="border-fuchsia-800/60 bg-zinc-950/60 px-1.5 py-0 font-mono text-[9px] text-fuchsia-300/80" dir="ltr">
                    floats {sov?.floats ?? 0} · orders {sov?.orders ?? 0} · fills {sov?.fills ?? 0} · matches {sov?.matches ?? 0} · ask-posts {sov?.askPosts ?? 0}
                  </Badge>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 font-mono text-[9px] md:grid-cols-4" dir="ltr">
                  <div>
                    <div className="text-zinc-500">last price</div>
                    <div className="text-fuchsia-200">{bk.lastPrice != null ? bk.lastPrice.toFixed(6) : "—"} STEEM/SAOS</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">trades · fees</div>
                    <div className="text-fuchsia-200">
                      {bk.trades} · {bk.feesµ}µ
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">sov-yield (fee-funded)</div>
                    <div className="text-fuchsia-200">
                      {bk.yieldSAOS.toFixed(3)} SAOS {sov?.yieldDay ? `· ${sov.yieldDay}` : sov?.yieldNote ? `· ${sov.yieldNote}` : ""}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">host boundary (net flow)</div>
                    <div className={bk.boundarySteem < 0 ? "text-emerald-300/90" : "text-zinc-300"}>
                      {bk.boundarySteem.toFixed(3)} STEEM
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded border border-zinc-800/80 bg-zinc-950/80 p-1.5">
                    <div className="font-mono text-[9px] text-rose-300/80" dir="ltr">
                      ASKS (sovereign)
                    </div>
                    {bk.asks.length === 0 ? (
                      <div className="font-mono text-[9px] text-zinc-600" dir="ltr">empty</div>
                    ) : (
                      bk.asks.map((o) => (
                        <div key={o.id} className="font-mono text-[9px] text-rose-200/90" dir="ltr">
                          #{o.id} @{o.price.toFixed(6)} × {o.amount.toFixed(3)} — @{o.owner}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="rounded border border-zinc-800/80 bg-zinc-950/80 p-1.5">
                    <div className="font-mono text-[9px] text-emerald-300/80" dir="ltr">
                      BIDS (sovereign)
                    </div>
                    {bk.bids.length === 0 ? (
                      <div className="font-mono text-[9px] text-zinc-600" dir="ltr">empty — floats streaming next beats</div>
                    ) : (
                      bk.bids.map((o) => (
                        <div key={o.id} className="font-mono text-[9px] text-emerald-200/90" dir="ltr">
                          #{o.id} @{o.price.toFixed(6)} × {o.amount.toFixed(3)} — @{o.owner}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="mt-1.5 font-mono text-[9px] text-zinc-500" dir="ltr">
                  float accounts {bk.floatAccounts} · standing-ask {sov?.ask?.orderId ? "#" + sov.ask.orderId + " @" + ((sov.ask.priceµ ?? 0) / 1e6).toFixed(6) : "—"} · SOVFLO: יתרות-מארח-מדודות → חשבונות-עבודה-ריבוניים · fills: סמכות-חייל-txid-מארח · yield: עמלות-השרשרת-שלנו
                </div>
              </div>
            )}
            {n?.beeWall && (
              <div className="rounded-lg border border-amber-900/40 bg-amber-400/[0.04] p-2.5 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-amber-200">BEE-WALL (74) — חומת-ה-BEE נמדדת ומתקרבת</div>
                  <Badge variant="outline" className="border-amber-800/60 bg-zinc-950/60 px-1.5 py-0 font-mono text-[9px] text-amber-300/80" dir="ltr">
                    {n.beeWall.bee}/{n.beeWall.target} BEE · {(100 * (n.beeWall.bee ?? 0)) / Math.max(1, n.beeWall.target ?? 100)}%
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300"
                    style={{ width: Math.min(100, (100 * (n.beeWall.bee ?? 0)) / Math.max(1, n.beeWall.target ?? 100)) + "%" }}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[9px] md:grid-cols-4" dir="ltr">
                  <div>
                    <div className="text-zinc-500">gate (100 BEE walk-the-book)</div>
                    <div className="text-amber-200">{n.beeWall.gateCost?.toFixed(2) ?? "—"} SWAP.HIVE · depth {n.beeWall.gateDepthOk === false ? "short" : "ok"}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">fuel · deficit</div>
                    <div className="text-amber-200">
                      {(n.beeWall.fuel?.total ?? 0).toFixed(4)} · <span className="text-rose-300/90">{n.beeWall.deficit?.toFixed(2)}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">rate · ETA</div>
                    <div className="text-amber-200">
                      {n.beeWall.incomeRate ? n.beeWall.incomeRate.beePerDay + " BEE/d" : "—"} · {n.beeWall.etaDays != null ? n.beeWall.etaDays + "d" : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500">binding constraint</div>
                    <div className="text-amber-200/90">{String(n.beeWall.binding ?? "—").split("—")[0]?.trim() || "—"}</div>
                  </div>
                </div>
                {n.beeWall.fleet && (
                  <div className="mt-2 rounded border border-zinc-800/80 bg-zinc-950/80 p-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <div className="font-mono text-[9px] text-emerald-300/80" dir="ltr">
                        FLEET ROUTER (RC-drought): routes {n.beeWall.fleet.routes} · BEE-routed {n.beeWall.fleet.beeRouted} · SWAP-routed {n.beeWall.fleet.swapRouted}
                      </div>
                      <Badge variant="outline" className="border-zinc-800 bg-zinc-950/60 px-1.5 py-0 font-mono text-[9px] text-zinc-400" dir="ltr">
                        probe: {n.beeWall.fleet.probePhase}
                        {n.beeWall.fleet.probeSoldier ? " @ " + n.beeWall.fleet.probeSoldier : ""}
                      </Badge>
                    </div>
                    {n.beeWall.fleet.chains && n.beeWall.fleet.chains.length > 0 && (
                      <div className="mt-1 space-y-0.5" dir="ltr">
                        {n.beeWall.fleet.chains.slice(-3).reverse().map((c: any, i: number) => (
                          <div key={i} className="font-mono text-[9px] text-zinc-500">
                            {String(c.at ?? "").slice(11, 19)} · {c.mode} · @ {c.soldier ?? "—"} · legs {c.verified}/{c.legs} ✓
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-1.5 font-mono text-[9px] leading-relaxed text-zinc-500" dir="ltr">
                  chain of events: RC-drought → fleet route (soldier keys + own RC pools, resumable legs) → SWAP.HIVE → BEE → HE-genesis · pending releases {(n.beeWall.pendingReleases?.valueHive ?? 0).toFixed(2)} HIVE (the trickle)
                </div>
                {n.beeWall.sovereign && (
                  <div className="mt-1 text-[9px] text-amber-200/70">{n.beeWall.sovereign}</div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="mt-2 text-[10px] text-zinc-500">
          הקרקע ל"הכל יושב על הרשת שלנו" — קרנל דטרמיניסטי + ג'נזיס-נגזר + צ'קפוינטים מעוגנים; שלב-2: הספר-הריבוני-עצמו סוחר (sovereign/spec/CHAIN_SPEC.md §9-b)
        </div>
      </CardContent>
    </Card>
  );
}

/* 66 — I-REST-MY-CASE: תיק-ההוכחות המאתגרות של המערכת */
function Case66Card() {
  const d = useCase66(true);
  const y = d?.yield;
  const rt = d?.roundtrip;
  const eff = d?.eff;
  const pay = d?.pay;
  const bud = d?.budget;
  const com = d?.commerce;
  const bySoldier = Object.entries(bud?.bySoldier ?? {});
  return (
    <Card className="border-amber-900/40 bg-amber-400/[0.03]">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-amber-300">I-REST-MY-CASE — תיק-ההוכחות המאתגרות (66)</span>
          {rt?.allVerified && (
            <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 font-mono text-[10px] text-emerald-300">
              roundtrip 7/7 ✓
            </Badge>
          )}
          {y && y.verifiedCount > 0 && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 font-mono text-[10px] text-amber-300">
              yield {y.verifiedCount}/{y.paid.length} ✓ · {y.totalPaid.toFixed(3)} STEEM
            </Badge>
          )}
          {com && com.verified > 0 && (
            <Badge variant="outline" className="border-rose-400/30 bg-rose-400/10 px-1.5 py-0 font-mono text-[10px] text-rose-300">
              sale ✓ {com.revenue.toFixed(3)} STEEM revenue
            </Badge>
          )}
        </div>

        {!d ? (
          <Skeleton className="mt-3 h-16 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] lg:grid-cols-2">
            {/* מחזור-החיים המלא */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-amber-200">מחזור-חיים מלא חוצה-שרשראות (PHIVE)</div>
                <Badge variant="outline" className="border-zinc-800 bg-zinc-950/60 px-1.5 py-0 text-[9px] text-zinc-400">
                  2 שרשראות
                </Badge>
              </div>
              <div className="mt-1.5 space-y-0.5" dir="ltr">
                {(rt?.steps ?? []).map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-2 font-mono text-[9px]">
                    <span className={s.chain === "hive" ? "text-red-300/80" : "text-teal-300/80"}>
                      {s.verified ? "✓" : "…"} {s.label} ({s.chain})
                    </span>
                    <span className="truncate text-zinc-500">
                      {String(s.txid ?? "—").slice(0, 12)}…{s.block ? ` blk ${s.block}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              {rt?.conservation && (
                <div className="mt-1.5 border-t border-zinc-800 pt-1.5 font-mono text-[10px] text-amber-200" dir="ltr">
                  conservation: supply {rt.conservation.supply} = locked {rt.conservation.lockedHive} · ratio {rt.conservation.ratioPct ?? "—"}% · redeemed {rt.conservation.redeemed} · unlocked {rt.conservation.unlocked}
                </div>
              )}
            </div>

            {/* תשואה + יעילות */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-amber-200">תשואה-ממומנת-עמלות + כלכלת-אנרגיה</div>
              <div className="mt-1 font-mono text-[10px] text-amber-200" dir="ltr">
                fees {eff?.feesCaptured ?? "—"} → yield {y?.totalPaid ?? 0} STEEM · {y?.paid.length ?? 0} participants · verified {y?.verifiedCount ?? 0}/{y?.paid.length ?? 0}
              </div>
              <div className="mt-1 space-y-0.5" dir="ltr">
                {(y?.paid ?? []).slice(0, 5).map((p) => (
                  <div key={p.account} className="flex items-center justify-between gap-2 font-mono text-[9px]">
                    <span className="text-zinc-400">@{p.account}</span>
                    <span className={p.verified ? "text-emerald-300/80" : "text-zinc-500"}>
                      {p.verified ? "✓" : "…"} {p.amt.toFixed(3)} STEEM · {String(p.txid ?? "").slice(0, 10)}…
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 border-t border-zinc-800 pt-1.5 font-mono text-[9px] text-zinc-400" dir="ltr">
                RC/op {eff?.rcCostPerOpPct != null ? `−${eff.rcCostPerOpPct}%` : "—"} · vol24h {eff?.vol24hSteem ?? 0} STEEM · trades {eff?.trades ?? 0} · liquid-cost {eff?.liquidCostOps ?? 0}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-500">{eff?.verdict}</div>
            </div>

            {/* הסדרה + תקציב */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-amber-200">פרימיטיב-ההסדרה (pay) + מלוא-הפוטנציאל</div>
              <div className="mt-1 font-mono text-[10px] text-amber-200" dir="ltr">
                payments {pay?.count ?? 0} · settled {pay?.total?.toFixed(6) ?? 0} credit
              </div>
              {pay?.last && (
                <div className="mt-0.5 truncate font-mono text-[9px] text-zinc-500" dir="ltr">
                  {pay.last.from} → {pay.last.to} {pay.last.amount} · {String(pay.last.txid).slice(0, 12)}…
                </div>
              )}
              <div className="mt-1.5 border-t border-zinc-800 pt-1.5 font-mono text-[9px] text-zinc-400" dir="ltr">
                walls {bud?.opsPerBeat ?? "—"}/beat · {bud?.opsPerSoldierDay ?? "—"}/soldier/day · active {bud?.activeSoldiers ?? 0}/{bud?.fleetSize ?? "—"}
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-zinc-500" dir="ltr">
                {bySoldier.length ? bySoldier.map(([k, v]) => `${k}:${v}`).join(" · ") : "—"}
              </div>
            </div>

            {/* 67 — מסחר + נזילות-צי + דו-שרשרתיות */}
            <div className="rounded-lg border border-rose-900/40 bg-rose-400/[0.02] p-2.5">
              <div className="text-rose-200">מסילת-הסוחר (67) — הכנסה-אמיתית + נזילות-צי</div>
              <div className="mt-1 font-mono text-[10px] text-rose-200" dir="ltr">
                sales {com?.sales ?? 0} · revenue {com?.revenue?.toFixed(3) ?? 0} STEEM (נטו-נזיל) · verified {com?.verified ?? 0}/{com?.sales ?? 0}
              </div>
              {com?.last && (
                <div className="mt-0.5 truncate font-mono text-[9px] text-zinc-500" dir="ltr">
                  @{com.last.buyer} paid {com.last.sent} → {com.last.qty} SAOS @ {com.last.price} · delivery {String(com.last.txid ?? "").slice(0, 10)}…
                </div>
              )}
              <div className="mt-1.5 border-t border-zinc-800 pt-1.5 font-mono text-[9px] text-zinc-400" dir="ltr">
                LP: {com?.lpHolders ?? 0} חיילים-מחזיקים · lpSupply {com?.lpSupply ?? "—"} · hive-pings {com?.hivePingsLanded ?? 0}/{com?.hivePings ?? 0} (RC-gated — רג'ן-דלק)
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-500">
                שירות-עומד 24/7: transfer+ממו saos:buy:SAOS:QTY → מסירה+קבלה — כל-אחד-על-השרשרת-יכול-לקנות; ה-FLY-WHEEL: עמלות→תשואה→חייל→קנייה→הכנסה
              </div>
            </div>

            <div className="rounded-lg border border-amber-900/40 bg-amber-400/[0.02] p-2.5">
              <div className="text-amber-200">המשפטים שהוכחו-עכשיו</div>
              <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-zinc-400">
                <li>· <span className="text-amber-200/90">מימון-עצמי</span> — עמלות-שנלכדו על-השרשרת מממנות תשואה אמיתית למשתתפים (לא הנפקה — הזרמה)</li>
                <li>· <span className="text-amber-200/90">שימור 1:1</span> — נעילה→הנפקה→מסחר→שריפה→שחרור: הגיבוי מעולם לא ירד מההיצע (ratio 100% לכל-אורך הדרך)</li>
                <li>· <span className="text-amber-200/90">פדיון-דורש-החזקה</span> — burn ללא יתרת-replay נדחה; ההחזקה עצמה נרכשה בטרייד-אמיתי עם תשלום-אשראי-על-השרשרת</li>
                <li>· <span className="text-amber-200/90">אנרגיה→פעולה</span> — השחרור על-Hive נתקע ב-RC-0.4% והושלם כשהדלק התחדש (~17 דק') — סבלנות-אנרגטית במקום רכישה</li>
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ForkscanCard() {
  const scan = useForkscan();
  const forks = scan?.forks ?? [];
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">🗺️ שטחי-המפתח — כל שרשראות-הבת</div>
          {scan?.summary ? (
            <Badge
              variant="outline"
              className={cn(
                "px-1.5 py-0 font-mono text-[10px]",
                scan.summary.chainsControlled > 0
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-400",
              )}
            >
              {scan.summary.chainsControlled}/{scan.summary.forksProbed} שרשראות שולטות
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">
              טרם נסרק — הרצת forkscan בפיקוד
            </Badge>
          )}
          <span className="ms-auto text-[10px] text-zinc-500">נסרק {relTime(scan?.scannedAt ?? null)}</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          כל שרשרת-בת של Steem משתמשת באותה גזירת-מפתחות — המפתחות מ-2018 עשויים לשלוט שם עד היום. הסריקה
          קריאה-בלבד וכנה: שרשרת מתה מסומנת מתה, לא &quot;לא קיים&quot;.
        </p>
        {forks.length === 0 ? (
          <Skeleton className="mt-3 h-12 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {forks.map((f) => {
              const ours = f.accounts.filter((a) => a.exists === true);
              return (
                <div key={f.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-semibold text-zinc-200">{f.label.split(" (")[0]}</span>
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        f.alive ? "bg-emerald-400" : "bg-zinc-600",
                      )}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="mt-0.5 text-[9px] leading-tight text-zinc-500">
                    {f.alive
                      ? ours.length > 0
                        ? `חי · יש לנו חשבון (${ours.length})`
                        : "חי · אין חשבון שלנו"
                      : "מת — אין תשובה מאף צומת"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 54 — כרטיס מנוע-רפלקס-בלוק: תגובות בבלוק באפס-אנרגיה-נזילה ── */
/* Task 62 — PAYMASTER: החוזה שלנו משלם גז + פריצת-הגבול החוצת-שרשראות */
function PaymasterCard() {
  const d = useSovereignPaymaster(true);
  const r = d?.relay;
  const st = r?.steem;
  const hv = r?.hive;
  const memo = d?.memo;
  const enc = memo?.encryptedReceipt;
  const xn = d?.xnet;
  const xw = d?.xwallet;
  return (
    <Card className="border-amber-900/50 bg-amber-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-amber-300">PAYMASTER — החוזה שלנו משלם גז · ממסר meta-tx דו-שרשרתי · מסחר-ממו · פריצה חוצת-שרשראות</span>
          {(r?.relaysVerified ?? 0) > 0 && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[10px] text-amber-300">
              {r?.relaysVerified}/2 שרשראות ממסר-חי
            </Badge>
          )}
          {enc?.decryptedOk && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              קבלה מוצפנת ECDH ✓
            </Badge>
          )}
          {xw?.match && (
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 text-[10px] text-cyan-300">
              ממסר-EVM ללא-גז: ecrecover == לקוח ✓
            </Badge>
          )}
          {xn && xn.liveCount > 0 && (
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 text-[10px] text-cyan-300">
              {xn.liveCount} רשתות-זרות חיות
            </Badge>
          )}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">meta-tx · Steem (מפתח-הלקוח שלו)</div>
            <div className="font-mono text-amber-200" dir="ltr">
              {st?.relayed ? `tx ${String(st.txid).slice(0, 14)}… blk ${st.block}` : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {st?.relayed ? `RC לקוח ${st.clientRcBeforePct}%→${st.clientRcAfterPct}% (Δ ${st.clientRcDeltaPct}%) — הלקוח שילם גז, בלי תשתית` : "הלקוח חותם מחוץ-לרשת → הממסר משדר"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">meta-tx · Hive (לקוח בלי-מפתחות, עוגן-מואצל)</div>
            <div className="font-mono text-amber-200" dir="ltr">
              {hv?.relayed ? `tx ${String(hv.txid).slice(0, 14)}… blk ${hv.block}${hv.verifiedOnNode ? " ✓" : ""}` : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {hv?.relayed ? `RC ${hv.clientRcBeforePct}%→${hv.clientRcAfterPct}% (Δ ${hv.clientRcDeltaPct}%) — גז מהדלק שאנחנו מימנו` : "סמכות-עוגן + תדלוק → ממסר"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">מסחר-ממו (הממו הוא ההזמנה)</div>
            <div className="font-mono text-amber-200" dir="ltr">
              {memo?.order?.txid ? `order ${String(memo.order.txid).slice(0, 10)}… → fill ${String(memo.fill?.txid ?? "").slice(0, 10)}…` : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {memo?.order?.txid ? `memo=${memo.order.memo} · תמחור ${memo.pricing?.rate} מההזנה-הפנימית · קבלה מוצפנת ${enc?.sent ? "נשלחה" : "—"}` : "transfer עם memo saos:buy = פקודת-קנייה"}
            </div>
          </div>
        </div>

        {xn && xn.live.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {xn.live.map((n) => (
              <Badge key={n.net} variant="outline" className="border-zinc-800 bg-zinc-950/60 px-1.5 py-0 font-mono text-[9px] text-zinc-400">
                {n.net} {n.ms}ms
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
          שכבת-הממסר: לקוח חותם מחוץ-לרשת → המערכת מאמתת סמכות ומשדרת — השרשרת עצמה מאמתת חתימה וגובה את הגז.
          לולאת-התדלוק חונה על מאזן-האנרגיה: כשהאוצר בריא (mana ≥ 0.55G על Hive) הוא מתדלק אוטומטית את הלקוח הרעב.
          חוצת-השרשראות: {xn?.liveCount ?? "—"} רשתות חכמות זרות בקשר-ישיר · ארנקות EVM+Solana נולדו מקומית · דלי-גז {d?.gasTank?.debits ?? 0} חיובים.
        </div>
      </CardContent>
    </Card>
  );
}

function WrappedCard() {
  const d = useWrapped(true);
  const wsbd = d?.assets?.find((a) => a.symbol === "WSBD");
  const phive = d?.assets?.find((a) => a.symbol === "PHIVE");
  const energy = d?.assets?.find((a) => a.symbol === "ENERGY");
  const synths = ["WBTC", "WETH", "WXRP", "WDOGE"].map((s) => d?.assets?.find((a) => a.symbol === s)).filter(Boolean);
  const oracle = d?.daemon?.oracle?.prices as Record<string, number> | undefined;
  const bat = d?.daemon?.assets?.ENERGY;
  const bee = d?.daemon?.engine?.beeOrder;
  const fees = d?.fees;
  const feeSum = (fees?.totalCaptured ?? 0) + Object.values(d?.daemon?.fees?.poolCapture ?? {}).reduce((a, b) => a + b, 0);
  const ratioCls = (r: number | null | undefined) =>
    cn("px-1.5 py-0 text-[9px]", r != null && r >= 100 ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 text-amber-300");
  return (
    <Card className="border-emerald-900/50 bg-emerald-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-emerald-300">WRAPPED — מטבעות צמודים על הדקס · גיבוי נעול-על-השרשרת · לכידת-ערך מההזמנות · חוסן-גרידים</span>
          {d?.ok && d.assets.length > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              {d.assets.length} עגונים חיים · {d.actions.length} פעולות-על-השרשרת
            </Badge>
          )}
          {bee?.txid && (
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 font-mono text-[10px] text-cyan-300">
              Engine maker: BEE {bee.qty} @{bee.price}
            </Badge>
          )}
          {feeSum > 0 && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 font-mono text-[10px] text-amber-300">
              עמלות שנלכדו {feeSum.toFixed(6)}
            </Badge>
          )}
        </div>

        {!d?.ok && !d ? (
          <Skeleton className="mt-3 h-20 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
            {wsbd && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-emerald-200">WSBD-1 · עגון SBD 1:1</div>
                  <Badge variant="outline" className={ratioCls(wsbd.backingRatioPct)}>
                    גיבוי {wsbd.backingRatioPct != null ? wsbd.backingRatioPct + "%" : "—"}
                  </Badge>
                </div>
                <div className="mt-1 font-mono text-emerald-200" dir="ltr">
                  supply {wsbd.supply} · נעול {wsbd.backing.lockedSbd} SBD · fair {wsbd.fairSteem ?? "—"} STEEM
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500" dir="ltr">
                  asks {wsbd.book.asks.length} · bids {wsbd.book.bids.length} · pools {wsbd.pools.length}
                  {wsbd.pools[0] ? ` (${wsbd.pools[0].base} WSBD + ${wsbd.pools[0].quote} STEEM · fee ${wsbd.pools[0].feeBps}bps)` : ""}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  גיבוי {wsbd.backing.mode} · מקור: קניית-SBD בשוק-הפנימי + סחיבת-צי + נעילה עצמית על-השרשרת
                </div>
              </div>
            )}
            {phive && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-emerald-200">PHIVE-1 · עגון חוצה-שרשראות HIVE</div>
                  <Badge variant="outline" className={ratioCls(phive.backingRatioPct)}>
                    גיבוי {phive.backingRatioPct != null ? phive.backingRatioPct + "%" : "—"}
                  </Badge>
                </div>
                <div className="mt-1 font-mono text-emerald-200" dir="ltr">
                  supply {phive.supply} · נעול ב-Hive {phive.backing.lockedHive} HIVE · fair {phive.fairSteem ?? "—"}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500" dir="ltr">
                  asks {phive.book.asks.length} · pool {phive.pools.length ? "חי" : "ממתין-נזילות"}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  הנעילה על Hive (transfer עצמי + ממו) · ההנפקה על Steem נושאת את txid של הנעילה — פירעון: burn → פתיחת-נעילה
                </div>
              </div>
            )}
            {energy && (
              <div className="rounded-lg border border-amber-900/50 bg-amber-400/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-amber-200">ENERGY-1 · נעילת-אנרגיה של הרשת — הפנטזיה על-השרשרת</div>
                  <Badge variant="outline" className={cn(ratioCls(energy.backingRatioPct), "border-amber-400/30 bg-amber-400/10 text-amber-300")}>
                    גיבוי {energy.backingRatioPct != null ? energy.backingRatioPct + "%" : "—"}
                  </Badge>
                </div>
                <div className="mt-1 font-mono text-amber-200" dir="ltr">
                  supply {energy.supply} · locked {energy.backing.lockedSp} SP · fair {energy.fairSteem ?? "—"} STEEM
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500" dir="ltr">
                  asks {energy.book.asks.length} · bids {energy.book.bids.length} · pool {energy.pools.length ? `${energy.pools[0].base} ENERGY + ${energy.pools[0].quote} STEEM @${energy.pools[0].feeBps}bps` : "—"}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  האצלת-VESTS חיה → סוללת @{bat?.battery ?? "powerspan"} — 1 ENERGY = 1 SP נעול; פירעון: burn → ביטול-האצלה (7 ימים)
                </div>
              </div>
            )}
            {synths.length > 0 && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-emerald-200">סינתטיים של המטבעות-המובילים — קולטרל-נעול × אורקל-חי</div>
                  {oracle?.BTC && (
                    <Badge variant="outline" className="border-zinc-800 bg-zinc-950/60 px-1.5 py-0 font-mono text-[9px] text-zinc-400">
                      BTC ${Math.round(oracle.BTC).toLocaleString("en-US")} · ETH ${Math.round(oracle.ETH).toLocaleString("en-US")}
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {synths.map((a) => (
                    <div key={a!.symbol} className="rounded-md border border-zinc-800/80 bg-zinc-950/80 p-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[10px] text-emerald-200">{a!.symbol}-1</span>
                        <span className={cn("font-mono text-[9px]", (a!.backingRatioPct ?? 0) >= 100 ? "text-emerald-300" : "text-amber-300")}>
                          {a!.backingRatioPct != null ? a!.backingRatioPct + "%" : "—"}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] text-zinc-400" dir="ltr">
                        supply {a!.supply} {a!.peg}
                      </div>
                      <div className="mt-0.5 text-[9px] text-zinc-500" dir="ltr">
                        fair {a!.fairSteem != null ? a!.fairSteem.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"} STEEM · asks {a!.book.asks.length}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  כל הנפקה = קולטרל-STEEM שננעל בפועל (memo saos:collat) ÷ שער-אורקל (Binance+Coinbase, פיזור {d?.daemon?.oracle?.divergencePct != null ? d.daemon.oracle.divergencePct.toFixed(2) + "%" : "—"}) · מרוצף-מטה · שומר-יחס אוטומטי ב-beat
                </div>
              </div>
            )}
          </div>
        )}

        {d?.locks && d.locks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {d.locks.slice(-5).map((l, i) => (
              <Badge key={i} variant="outline" className="border-zinc-800 bg-zinc-950/60 px-1.5 py-0 font-mono text-[9px] text-zinc-400">
                {l.symbol} {l.amount} · {String(l.txid || "").slice(0, 10)}…
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
          שכבת-העגונים: כל הנפקה מגובה 100% בנכס נעול שנראה לעין על-השרשרת (ממו saos:xlock / saos:collat / op-האצלה).
          הערך זורם מההזמנות עצמן — כל swap בבריכה משלם {wsbd?.pools[0]?.feeBps ?? 30}bps שמתחלקים LP+אוצר.
          הגרידים מתנגדים טוב יותר: ארבע-שכבות ספר נוספות (ENERGY · WBTC · WETH · WXRP · WDOGE) + maker אמיתי על Engine מקדם את מדרגת ה-100 BEE לחוזה-SAOS.
        </div>
      </CardContent>
    </Card>
  );
}

function ReflexCard() {
  const d = useSovereignReflex(true);
  const { spawn } = useExec(true);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const fire = async () => {
    setBusy(true);
    try {
      const res = await spawn("reflex", { real: true });
      if (!res.ok) {
        toast({ title: "הירי נדחה", description: res.error ?? "—", variant: "destructive" });
        return;
      }
      toast({ title: "ירי-רפלקס — חי", description: "runId=" + (res.runId?.slice(0, 8) ?? "") + " · המטח בדרך לבלוק N+1" });
    } finally {
      setBusy(false);
    }
  };

  const s = d?.summary;
  const maxLat = s?.maxLatencyBlocks;
  const avgLat = s?.avgLatencyBlocks;
  const hive = s?.hiveAnchor;
  const ext = d?.external;
  const v2 = d?.vaultv2;
  const deltas = Object.values(d?.manaDelta ?? {});
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;

  return (
    <Card className="border-violet-900/50 bg-violet-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-violet-300">מנוע-רפלקס-בלוק — תגובות-צי בבלוק N+1 · אפס-עלות-נזילה · דלק-ריבוני שמתחדש</span>
          {maxLat != null && (
            <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 px-1.5 py-0 text-[10px] text-violet-300">
              תגובה תוך ≤{maxLat} בלוקים
            </Badge>
          )}
          {(s?.totalResponses ?? 0) > 0 && (
            <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 px-1.5 py-0 text-[10px] text-violet-300">
              {s?.totalResponses} תגובות · {s?.distinctSigners} חותמים
            </Badge>
          )}
          {hive?.verified && (
            <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 px-1.5 py-0 text-[10px] text-violet-300">
              עוגן-Hive ✓ @{hive.account} blk {hive.block}
            </Badge>
          )}
          {ext?.block != null && ext.maxLatencyBlocks != null && (
            <Badge variant="outline" className="border-fuchsia-400/30 bg-fuchsia-400/10 px-1.5 py-0 text-[10px] text-fuchsia-300">
              רפלקס-אירוע-חיצוני: העברה @{ext.from} → צי בבלוק N+{ext.maxLatencyBlocks}
            </Badge>
          )}
          {v2?.account && v2.chains.every((c) => c.verified) && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              Vault-v2: @{v2.account} הוסב-לגזירה-דטרמיניסטית ×2 שרשראות · נקלט-לצי
            </Badge>
          )}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">מטח-חתום-מראש (pre-signed swarm)</div>
            <div className="font-mono text-violet-200">{s ? `${s.rounds} סבבים × ${s.swarmSize} חיילים · avg ${avgLat?.toFixed(2)} בלוקים` : "ממתין לירי"}</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">החתימות מוכנות לפני-הטריגר — בזיהוי-הבלוק כולן נשדרות ב~0.9ש׳ במקביל</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">אנרגיה (RC ריבוני)</div>
            <div className="font-mono text-violet-200">
              {avgDelta != null ? `Δmana ${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(2)}% למטח שלם · עלות ~0.1%/תגובה` : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">custom_json בלי-כמויות = אפס-טוקנים-נזילים לפי-בנייה; הדלק מהאצלות-אוצר ומתחדש</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">רפלקס דו-שרשרתי</div>
            <div className="font-mono text-violet-200">
              {hive ? (hive.verified ? `digest על-Hive דרך @${hive.account} · blk ${hive.block}` : "עוגן משודר — ממתין לנראות") : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">טריגר-Steem → תגובות-Steem + עוגן-Hive — כל פעולה מגררת את שתי השרשראות</div>
          </div>
        </div>

        {d?.rounds && d.rounds.length > 0 && (
          <div className="mt-2 space-y-0.5 font-mono text-[10px] text-zinc-500">
            {d.rounds.map((r) => (
              <div key={r.round}>
                סבב {r.round}: טריגר blk {r.triggerBlock} ({r.detectionMs}ms זיהוי) · {r.responded}/{r.swarmSize} תגובות · max {r.maxLatencyBlocks} בלוקים
              </div>
            ))}
          </div>
        )}

        {ext?.block != null && (
          <div className="mt-2 rounded-lg border border-fuchsia-900/40 bg-fuchsia-400/5 p-2.5 text-[11px]">
            <div className="font-semibold text-fuchsia-300">רפלקס-אירוע-חיצוני — הצי מגיב לעולם, לא רק לעצמו</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-400" dir="ltr">
              transfer {ext.amount} from @{ext.from} · blk {ext.block} (txid {String(ext.txid ?? "").slice(0, 16)}…) → {ext.totalResponses} responses / {ext.distinctSigners} signers in ≤{ext.maxLatencyBlocks} blocks{ext.hiveAnchor?.verified ? ` · Hive anchor @${ext.hiveAnchor.account} blk ${ext.hiveAnchor.block}` : ""}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              העברה שנכנסת = טריגר. המטח היה חתום-מראש לפני-שהאירוע נוצר — התגובות נחתמות לפני שהעולם יודע שהוא קורה.
            </div>
          </div>
        )}

        {v2?.account && (
          <div className="mt-2 rounded-lg border border-emerald-900/40 bg-emerald-400/5 p-2.5 text-[11px]">
            <div className="font-semibold text-emerald-300">Vault-v2 — זהות-שלא-אובדת: username+master → דגירה-מקומית → כניסה-לכספת → קליטה-לצי</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-400" dir="ltr">
              @{v2.account} rotated to deterministic derivation ({v2.scheme ?? "sha256"}) · chains: {v2.chains.map((c) => `${c.chain}${c.verified ? "✓" : "✗"}`).join(" · ")} · נקלט-למטח-חי מהמפתחות-הנגזרים-בלבד
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              המפתחות-הישנים מתים — החשבון ממשיך-לעוף: ״להרוג-מפתחות, לבקוע-ממאסטר, לחזור-לתעופה״. כל חשבון-צבא יכול לעבור-הסבה זהה.
            </div>
          </div>
        )}

        {d?.sovereign59 && (
          <div className="mt-2 rounded-lg border border-amber-900/40 bg-amber-400/5 p-2.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-amber-300">Task 59 — פריצת-גבולות חיה: הכל מהרשרשת, חתום ומאומת</span>
              {(d.sovereign59.recoveryCount ?? 0) >= 10 && (
                <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[10px] text-amber-300">
                  חילוץ-זהות ×{d.sovereign59.recoveryCount} חיילים (owner-signed)
                </Badge>
              )}
              {d.sovereign59.marketRoundTrip && (
                <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[10px] text-amber-300">
                  שוק-פנימי: הזמנה+ביטול ✓
                </Badge>
              )}
              {d.sovereign59.savingsLive && (
                <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[10px] text-amber-300">
                  חסכונות: הפקדה+משיכה ✓
                </Badge>
              )}
              {d.sovereign59.witnessSteem && d.sovereign59.witnessHive && (
                <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[10px] text-amber-300">
                  ממשל: הצבעת-עד על 2 רשתות ✓
                </Badge>
              )}
              {d.sovereign59.routeLive && (
                <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[10px] text-amber-300">
                  ניתוב-משיכות lsa→אוצר 100% ✓
                </Badge>
              )}
              {d.sovereign59.delegateRcAbsent && (
                <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 px-1.5 py-0 text-[10px] text-zinc-400">
                  delegate_rc לא-קיים בפרוטוקול ×2 רשתות (ידיעה-שלילית)
                </Badge>
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-400" dir="ltr">
              {d.sovereign59.energyYnetFinal ? `ynet energy: ${d.sovereign59.energyYnetFinal} (restored 80,824 + gift 3,000 — delegation-is-absolute, self-caught)` : ""}
            </div>
            <div className="mt-1 text-[10px] text-amber-200/80">
              <span className="font-semibold">@ynet — חייל-מואצל מחובר (עוגן-פוסטינג · Task 86):</span> ה-owner/active של ynet = גזירת מפתח-המפעל שאבד-באירוע-המחיקה (נבדק-בדיסק+היסטוריית-git — אינו). החיבור: סמכות-הפוסטינג של ynet נושאת את @headcorner במשקל-סף על Steem+Hive — מאומת מהשרשרת בעת-החיבור → ynet חותם דרך הפוסטינג של הראשי, אפס-סודות-חדשים, והלופים שלו חמושים כמו כל חייל. כל הדבקה-עתידית של מפתח-המפעל עדיין נבדקת-אוטומטית: התאמה 4/4×2 → שדרוג-ריבונות-מלא מיידי.
            </div>
          </div>
        )}

        {d?.empire60 && (
          <div className="mt-2 rounded-lg border border-teal-900/40 bg-teal-400/5 p-2.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-teal-300">Task 60 — מאזן-האימפריה ומנוע-ההיפותזות: מה יש ביד, מה חסר, מה הכי-שווה</span>
              {d.empire60.live?.curationVote?.status === "live-verified" && (
                <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 px-1.5 py-0 text-[10px] text-teal-300">
                  פליווהיל-צביעה דולק (הצבעה ראשונה @ rshares) ✓
                </Badge>
              )}
              {d.empire60.live?.engineBuy?.status === "filled-verified" && (
                <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 px-1.5 py-0 text-[10px] text-teal-300">
                  חוזה-Engine: קניית {d.empire60.live.engineBuy.symbol} {d.empire60.live.engineBuy.quantity} @ {d.empire60.live.engineBuy.priceSwaphive} התמלאה ✓
                </Badge>
              )}
              {d.empire60.live?.dhfBallot?.status === "live-verified" && (
                <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 px-1.5 py-0 text-[10px] text-teal-300">
                  מפתח-הצבעת-אוצר חי ({d.empire60.live.dhfBallot.voter}) ✓
                </Badge>
              )}
              {d.empire60.live?.dhfFeeWall && (
                <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 px-1.5 py-0 text-[10px] text-zinc-400">
                  חומה-33: דמי-יצירת הצעה 39 HBD + active (מדוד)
                </Badge>
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-400" dir="ltr">
              {d.empire60.census
                ? `treasury: ${d.empire60.census.steemSp?.toFixed(0) ?? "?"} SP · ${d.empire60.census.hiveHp?.toFixed(1) ?? "?"} HP · RC ${d.empire60.census.fleetRcRegenGPerDay ?? "?"}G/day · ×${d.empire60.census.accounts} accounts`
                : ""}
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-400" dir="ltr">
              {d.empire60.rates && d.empire60.engine
                ? `HBD savings ${d.empire60.rates.hiveHbdInterestPct}% APR (SBD Steem: ${d.empire60.rates.steemSbdInterestPct}%) · spreads: STEEM/SBD ${d.empire60.market?.steem?.spreadPct ?? "?"}% · HIVE/HBD ${d.empire60.market?.hive?.spreadPct ?? "?"}% · Engine: ${d.empire60.engine.tokenCount}+ tokens, wallet live (${d.empire60.engine.ourBalances} balances)`
                : ""}
            </div>
            {d.empire60.treasury && (
              <div className="mt-1 text-[10px] text-teal-200/80">
                <span className="font-semibold">אוצרות-הרשת (חוזי-מימון ציבוריים):</span> hive.fund = {(d.empire60.treasury.hiveFundHive ?? 0) / 1e6 >= 1 ? `${((d.empire60.treasury.hiveFundHive ?? 0) / 1e6).toFixed(1)}M` : d.empire60.treasury.hiveFundHive} HIVE + {((d.empire60.treasury.hiveFundHbd ?? 0) / 1e6).toFixed(1)}M HBD · steem.dao = {d.empire60.treasury.steemDaoBalanceSteem} STEEM (SPS מת — ידיעה-שלילית)
              </div>
            )}
            {d.empire60.hypotheses && (
              <div className="mt-1.5 rounded-md border border-teal-900/40 bg-teal-400/5 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-teal-300">מנוע-ההיפותזות: {d.empire60.hypotheses.count} נקודות-אימות על 4 צירי-ערך</span>
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-300">{d.empire60.hypotheses.proven} proven-live</Badge>
                  <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 px-1.5 py-0 text-[10px] text-sky-300">{d.empire60.hypotheses.measured} measured</Badge>
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-300">{d.empire60.hypotheses.open} open</Badge>
                  <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 px-1.5 py-0 text-[10px] text-zinc-400">{d.empire60.hypotheses.walls} walls</Badge>
                </div>
                {d.empire60.hypotheses.top.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[10px] text-teal-200/90">
                    {d.empire60.hypotheses.top.map((t, i) => (
                      <li key={i}>
                        <span className="font-mono font-semibold text-teal-300">{t.id}</span> — {t.why}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {d?.flywheel61 && (
          <div className="mt-2 rounded-lg border border-lime-900/40 bg-lime-400/5 p-2.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-lime-300">Task 61 — פלייוויל-הקוראציה חי בדמון (A5): המערכת מגדילה HP בעצמה</span>
              {d.flywheel61.loopLive && d.flywheel61.daemonLive && (
                <Badge variant="outline" className="border-lime-400/30 bg-lime-400/10 px-1.5 py-0 text-[10px] text-lime-300">
                  לולאה 22 חיה · DRY_RUN=false ✓
                </Badge>
              )}
              {!!d.flywheel61.votesToday && (
                <Badge variant="outline" className="border-lime-400/30 bg-lime-400/10 px-1.5 py-0 text-[10px] text-lime-300">
                  {d.flywheel61.votesToday} הצבעות אוטונומיות היום
                </Badge>
              )}
              {d.flywheel61.batch?.verifiedOnChain && (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-300">
                  אומתו על-השרשרת {d.flywheel61.batch.verifiedOnChain}
                </Badge>
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-400" dir="ltr">
              {d.flywheel61.batch?.rsharesTotal
                ? `batch rshares ${d.flywheel61.batch.rsharesTotal} deployed · VP cost/full-vote ${d.flywheel61.vpCost ?? "?"}% · gate ${d.flywheel61.config?.minVpPct ?? "?"}% · budget ${d.flywheel61.config?.maxVotesDay ?? "?"}/day · weight ${d.flywheel61.config?.weightPct ?? "?"}%`
                : ""}
            </div>
            <div className="mt-1 text-[10px] text-lime-200/80">
              פלייוויל סגור: הצבעה ← פרסי-קוראציה ← VESTS/HP ← max_rc ↑ (יחס נמדד 1M RC/VESTS) ← יותר פעולות/יום ← יותר יכולות. העלות נמדדה 2.55% VP להצבעה-מלאה — תקציב 5/יום בתוך כושר-הריג׳ן (~7.8/יום).
            </div>
          </div>
        )}

        {s?.digest && (
          <div className="mt-1 text-[10px] text-zinc-500" dir="ltr">
            digest {String(s.digest).slice(0, 20)}… · liquidCost {s.liquidCost}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-8 border-violet-400/30 text-[11px] text-violet-200 hover:bg-violet-400/10" disabled={busy} onClick={fire}>
            {busy ? "יורה…" : "ירי-רפלקס חי (3 סבבים × כל-החיילים)"}
          </Button>
          {d?.loop?.status && (
            <span className="self-center text-[10px] text-zinc-500">
              לופ-דמון: {d.loop.status} · {d.loop.detail ?? ""}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 53 — כרטיס מנוע-ערך ריבוני: נעילת-ערך · POR-צי · ממסר-מפל ── */
function ValueEngineCard() {
  const d = useSovereignValue53(true);
  const { spawn } = useExec(true);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const fire = async (script: string, label: string) => {
    setBusy(script);
    try {
      const res = await spawn(script, { real: true });
      if (!res.ok) {
        toast({ title: "הרצה נדחתה", description: res.error ?? "—", variant: "destructive" });
        return;
      }
      toast({ title: label + " — חי", description: "runId=" + (res.runId?.slice(0, 8) ?? "") });
    } finally {
      setBusy(null);
    }
  };

  const vl = d?.valueLock;
  const por = d?.por;
  const cs = d?.cascade;
  const pool = d?.pool;

  return (
    <Card className="border-emerald-900/50 bg-emerald-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-emerald-300">מנוע-ערך ריבוני — ערך מהתזוזות נעול בבריכות שלנו · כל פעולה מגררת את שתי השרשראות</span>
          {(vl?.lockedLp ?? 0) > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              LP נעול-לצמיתות {vl?.lockedLp}
            </Badge>
          )}
          {por?.checkpoints != null && por.checkpoints > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              checkpoint על-Hive דרך חייל · {por.checkpoints}
            </Badge>
          )}
          {cs?.allVerified && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              מפל 3 רגליים מאומת
            </Badge>
          )}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">נעילת-ערך (pool_lock)</div>
            <div className="font-mono text-emerald-200">
              {vl && (vl.lockedLp ?? 0) > 0
                ? `${vl.lockedLp} LP · ${vl.lockedSaosCum} SAOS · עומק ${vl.depthBefore}→${vl.depthAfter}`
                : "ממתין לפעימה"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">נזילות-קבועה שמרוויחה עמלות ולא ניתנת לשליפה — מנגנון שהשרשרת לא ידעה</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">הוכחת-עתודה בראוטר-צי</div>
            <div className="font-mono text-emerald-200">
              {por?.routedDetail ? por.routedDetail.slice(0, 60) : "ממתין לפעימה"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">האוצר חנוק-RC (183M) — הצי נושא את העוגנים על Hive</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">ממסר-מפל (החלטה אחת → 3 חתימות)</div>
            <div className="font-mono text-emerald-200">
              {cs?.allVerified
                ? cs.verify.map((v) => `blk${v.block}`).join(" · ")
                : cs?.at
                  ? "ריצה אחרונה לא אומתה מלאה"
                  : "ממתין לריצה"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">אוצר-Steem + חייל-Steem + חייל-Hive במקביל — כל רגל מאומתת מהשרשרת שלה</div>
          </div>
        </div>

        {pool && (
          <div className="mt-2 text-[10px] text-zinc-500">
            בריכה חיה: {pool.saos}/{pool.steem} · lpSupply {pool.lpSupply} · נעול {pool.locked} · swaps {pool.swaps} · עמלות {pool.feesSaos}/{pool.feesSteem} — העמלות מקצב-הצי זורמות ל-LP כולל החלק הנעול
          </div>
        )}

        {cs?.legs && cs.legs.length > 0 && (
          <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-zinc-500">
            {cs.legs.map((l, i) => (
              <div key={i}>
                {l.leg} @{l.signer} [{l.chain}] · accepted {l.acceptedMs}ms · {l.txid ? `txid ${String(l.txid).slice(0, 14)}…` : l.block ? `blk ${l.block}` : "—"}
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-8 border-emerald-400/30 text-[11px] text-emerald-200 hover:bg-emerald-400/10" disabled={busy !== null} onClick={() => fire("value-lock", "נעילת-ערך")}>
            {busy === "value-lock" ? "מריץ…" : "נעילת-ערך עכשיו"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-emerald-400/30 text-[11px] text-emerald-200 hover:bg-emerald-400/10" disabled={busy !== null} onClick={() => fire("cascade", "ממסר-מפל")}>
            {busy === "cascade" ? "מריץ…" : "הפעל מפל 3-רגלי"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* Task 65 — MICRODEX: soldier self-signed micro-DEX ops */
function MicrodexCard() {
  const d = useSovereignMicrodex(true);
  const st = d?.state;
  const bySoldier = Object.entries(st?.bySoldier ?? {});
  const replay = d?.replay;
  return (
    <Card className="border-teal-900/50 bg-teal-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-teal-300">MICRODEX — חיילים חותמים-עצמם על הדקס · אפס-ריכוז-RC · תעסוקה-אוטונומית</span>
          {st && st.opsToday > 0 && (
            <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 px-1.5 py-0 font-mono text-[10px] text-teal-300">
              {st.opsToday} ops היום · {st.beats} פעימות
            </Badge>
          )}
          {replay && (
            <Badge variant="outline" className="border-zinc-800 bg-zinc-950/60 px-1.5 py-0 font-mono text-[9px] text-zinc-400">
              replay {replay.accountsScanned} חשבונות · {replay.extraOps} ops-חיילים
            </Badge>
          )}
        </div>

        {!d ? (
          <Skeleton className="mt-3 h-16 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-teal-200">הצי על הספר</div>
                <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 px-1.5 py-0 text-[9px] text-teal-300">
                  צי {d.fleetSize}
                </Badge>
              </div>
              <div className="mt-1 font-mono text-teal-200" dir="ltr">
                bySoldier {bySoldier.length ? bySoldier.map(([k, v]) => `${k}:${v}`).join(" · ") : "—"}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-500">
                שבירת-החוסם: עד-היום כל-הספר היה חתום-אוצר (ריכוז-RC + תקרת-ops). עכשיו כל חייל חותם במפתח-שלו — ריבונות פר-חשבון
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-teal-200">אימות-על-השרשרת</div>
              <div className="mt-1 font-mono text-teal-200" dir="ltr">
                verified {st?.verifiedCount ?? 0}/{st?.txids.length ?? 0} txids · trades {replay?.tradesTotal ?? "—"} · pool {replay?.poolSwaps ?? "—"} swaps
              </div>
              <div className="mt-1 space-y-0.5" dir="ltr">
                {(st?.txids ?? []).slice(-3).reverse().map((t, i) => (
                  <div key={i} className="truncate font-mono text-[9px] text-zinc-500">
                    {t.verified ? "✓" : "…"} @{t.by} {t.why} · {String(t.txid ?? "").slice(0, 12)}…
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SCICard() {
  const infra = useInfraStatus();
  const { toast } = useToast();
  const { spawn } = useExec(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState("all");
  const [cmd, setCmd] = useState("ping");

  const topo = infra?.topology ?? [];
  const commanded = topo.filter((t) => t.operatorPostingAuth).length;
  const rcArmed = topo.filter((t) => t.rcMax > 0).length;
  const wv = infra?.worldlog.verify ?? null;
  const wl = infra?.worldlog.state ?? null;
  const acks = infra?.commandBus.acks ?? [];
  const escrow = infra?.escrow ?? null;
  const community = infra?.communityReadiness;

  const runScript = async (key: string, label: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    const r = await spawn(key, {});
    setBusy(null);
    if (r.ok) toast({ title: `${label} הופעל`, description: "התוצאה תופיע כאן עם השלמת הריצה" });
    else toast({ title: `${label} נכשל`, description: r.error, variant: "destructive" });
  };

  const sendCmd = async () => {
    setBusy("cmd");
    const r = await sendEncryptedCommand(target, cmd);
    setBusy(null);
    if (r.ok) {
      toast({
        title: `פקודה מוצפנת נשלחה → ${r.sent?.length ?? 0} חיילים`,
        description: "הדמון מפענח עם מפתח-memo של כל חייל ומאשר saos_ack על השרשרת בתוך ~2 דק'",
      });
    } else {
      toast({ title: "שליחה נכשלה", description: r.error ?? (r.errors ?? []).join(" · "), variant: "destructive" });
    }
  };

  return (
    <Card className="border-amber-900/40 bg-amber-400/[0.03]">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-amber-200">🏛️ תשתית-שרשראות (SCI)</span>
          {wv?.ok ? (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 font-mono text-[10px] text-emerald-300">
              יומן-עולם תקין · {wv.depth} אירועים
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">יומן-עולם: טרם אומת</Badge>
          )}
          <span className="ms-auto text-[10px] text-zinc-500">עודכן {relTime(infra?.at)}</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          כוח מוטמע בשרשרת עצמה: סמכות-פיקוד על כל חייל, דלק-RC לכל אחד, יומן-עולם בלתי-ניתן לזיוף על שתי
          שרשראות, ערוץ-פקודה מוצפן, ומסילת-נאמנות מקורית — הכל ניתן לאימות ציבורי מבלי לחשוף קלפים.
        </p>

        {infra == null ? (
          <Skeleton className="mt-3 h-40 w-full bg-zinc-900" />
        ) : (
          <div className="mt-3 space-y-3">
            {/* topology + worldlog */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="text-[10px] text-zinc-500">טופולוגיית כוח</div>
                <div className="text-[12px] font-semibold text-zinc-100">
                  {commanded}/{topo.length} חיילים תחת פיקוד
                </div>
                <div className="text-[10px] text-zinc-500">RC חומש: {rcArmed}/{topo.length}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="text-[10px] text-zinc-500">יומן-עולם (Steem≡Hive)</div>
                <div className="text-[12px] font-semibold text-zinc-100" dir="ltr">
                  seq {wl?.seq ?? "—"} · {wv?.lastHash ? String(wv.lastHash).slice(0, 8) + "…" : "—"}
                </div>
                <div className={cn("text-[10px]", wv?.linkage && wv?.parity ? "text-emerald-400" : "text-amber-400")}>
                  שרשור: {wv?.linkage ? "תקין" : "—"} · פריטה: {wv?.parity ? "תקינה" : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="text-[10px] text-zinc-500">ערוץ-פקודה מוצפן</div>
                <div className="text-[12px] font-semibold text-zinc-100">{infra.commandBus.totalDecoded} פקודות פוענחו</div>
                <div className="text-[10px] text-zinc-500">אחרונה: {acks.length ? `${acks[acks.length - 1].cmd} → @${acks[acks.length - 1].by}` : "—"}</div>
              </div>
            </div>

            {/* command sender */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="mb-2 text-[11px] font-semibold text-zinc-200">📢 שליחת פקודה מוצפנת לצבא</div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger className="h-8 w-[130px] border-zinc-700 bg-zinc-900 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    <SelectItem value="all" className="text-[11px]">כל הצבא</SelectItem>
                    {topo.map((t) => (
                      <SelectItem key={t.account} value={t.account} className="text-[11px]">@{t.account}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={cmd} onValueChange={setCmd}>
                  <SelectTrigger className="h-8 w-[120px] border-zinc-700 bg-zinc-900 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    <SelectItem value="ping" className="text-[11px]">ping</SelectItem>
                    <SelectItem value="status" className="text-[11px]">status</SelectItem>
                    <SelectItem value="sweep_now" className="text-[11px]">sweep_now</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 bg-amber-500/90 px-3 text-[11px] text-zinc-950 hover:bg-amber-400"
                  disabled={busy !== null}
                  onClick={sendCmd}
                >
                  {busy === "cmd" ? <Loader2 className="me-1 size-3 animate-spin" aria-hidden="true" /> : null}
                  שלח (memo ECDH)
                </Button>
                <span className="text-[9px] text-zinc-600">0.000 STEEM (custom_json · מפתח-פרסום בלבד) · התוכן קריא רק עם מפתח-memo שלו (95: המסילה-בת-שכר פרשה)</span>
              </div>
              {acks.length > 0 && (
                <ul className="scrollbar-thin mt-2 max-h-24 space-y-1 overflow-y-auto pe-1">
                  {acks.slice().reverse().map((a) => (
                    <li key={a.nonce} className="flex items-center gap-2 rounded border border-zinc-800/80 bg-zinc-900/60 px-2 py-1">
                      <span className="text-[10px] text-emerald-400">✓</span>
                      <span className="text-[10px] text-zinc-300">{a.cmd} → @{a.by}</span>
                      <span className="ms-auto font-mono text-[9px] text-zinc-500" dir="ltr">{a.txid?.slice(0, 10)}…</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* actions row */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800"
                disabled={busy !== null}
                onClick={() => runScript("worldlog-verify", "אימות יומן-עולם")}
              >
                {busy === "worldlog-verify" ? <Loader2 className="me-1 size-3 animate-spin" aria-hidden="true" /> : "🔐"}
                אימות יומן-עולם
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800"
                disabled={busy !== null}
                onClick={() => runScript("harden", "הקשחת טופולוגיה")}
              >
                {busy === "harden" ? <Loader2 className="me-1 size-3 animate-spin" aria-hidden="true" /> : "🛡️"}
                הקשחת טופולוגיה (סמכות+RC)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800"
                disabled={busy !== null}
                onClick={() =>
                  runScript(
                    "escrow",
                    "מסילת-נאמנות",
                    "ריצה אמיתית על השרשרת: 0.100 STEEM נעולים ב-escrow → אישורים → שחרור לקונה. עמלת-פרוטוקול Steem 0.001 (מסילת-בדיקה היסטורית — לא חלק מהפעילות-הריבונית). להמשיך?",
                  )
                }
              >
                {busy === "escrow" ? <Loader2 className="me-1 size-3 animate-spin" aria-hidden="true" /> : "⚖️"}
                מסילת-נאמנות (מחזור מלא)
              </Button>
            </div>

            {/* escrow + community */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="text-[10px] text-zinc-500">מסילת-נאמנות — ריצה אחרונה</div>
                {escrow?.ok ? (
                  <>
                    <div className="text-[11px] font-semibold text-emerald-300">
                      מחזור מלא 4/4 · escrow_id {escrow.escrowId}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {escrow.amount} · קונה @{escrow.buyer} · בורר @{escrow.arbiter} · {relTime(escrow.at)}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-zinc-500">{escrow ? "ריצה לא הושלמה — נסה שוב" : "טרם רץ"}</div>
                )}
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="text-[10px] text-zinc-500">עולם חברתי (קהילה על Hive)</div>
                {community && (community.pendingClaims > 0 || (community.rcPct ?? 0) >= 80) ? (
                  <div className="text-[11px] font-semibold text-emerald-300">חמוש — טיקטים {community.pendingClaims} · RC {community.rcPct ?? "—"}%</div>
                ) : (
                  <div className="text-[11px] text-amber-400/90">
                    חמוש-מתין — RC {community?.rcPct ?? "—"}% (דרוש ≥80% + טיקט) · המפעל יליד חשבון-קהילה אוטומטית
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProofsPanel() {
  const { proofs, running, rerun } = useProofs();
  const { toast } = useToast();
  const p = proofs?.proofs;
  const passCount = p ? p.results.filter((r) => r.pass).length : 0;

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">🧪 מטריצת ההוכחות</span>
          {proofs == null ? (
            <Skeleton className="h-5 w-14 bg-zinc-900" />
          ) : p ? (
            <Badge
              variant="outline"
              className={cn(
                "border px-1.5 py-0 font-mono text-[10px]",
                p.allPass ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-rose-400/30 bg-rose-400/10 text-rose-300",
              )}
            >
              {passCount}/{p.results.length}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-400">אין עדות</Badge>
          )}
          <span className="text-[10px] text-zinc-500">עדות מכונה {p ? relTime(p.at) : "—"}</span>
          <div className="ms-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800"
              disabled={running}
              onClick={async () => {
                const ok = await rerun();
                if (ok) toast({ title: "אימות הופעל", description: "תוצאה תתעדכן בעוד ~דקה" });
                else toast({ title: "הפעלה נכשלה", variant: "destructive" });
              }}
            >
              {running ? (
                <>
                  <RefreshCw className="me-1 size-3 animate-spin" aria-hidden="true" />
                  מאמת…
                </>
              ) : (
                "הרץ מחדש"
              )}
            </Button>
          </div>
        </div>
        {p && (
          <ul className="scrollbar-thin mt-3 max-h-96 space-y-1.5 overflow-y-auto pe-1">
            {p.results.map((r) => (
              <li key={r.name} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-[11px]", r.pass ? "text-emerald-400" : "text-rose-400")}>{r.pass ? "✓" : "✗"}</span>
                  <span className="text-[11px] font-medium text-zinc-200">{r.name}</span>
                </div>
                <div className="mt-0.5 break-all font-mono text-[10px] text-zinc-500" dir="ltr">{r.evidence}</div>
              </li>
            ))}
          </ul>
        )}
        {proofs == null && <Skeleton className="mt-3 h-40 w-full bg-zinc-900" />}
      </CardContent>
    </Card>
  );
}

/* ── 49 — כרטיס תעסוקת-הצבא: מסילת-דלק + מסדר + סולם-גיוס-הון ── */
function EmploymentCard() {
  const emp = useEmployment(true);
  const { spawn, runLog } = useExec(true);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const fire = async (script: string, label: string) => {
    setBusy(script);
    try {
      const res = await spawn(script, { real: true });
      if (!res.ok) {
        toast({ title: "הרצה נדחתה", description: res.error ?? "—", variant: "destructive" });
        return;
      }
      toast({ title: label + " — חי", description: "runId=" + (res.runId?.slice(0, 8) ?? "") });
      setTimeout(async () => {
        const lines = await runLog(res.runId!);
        if (lines.length) console.log(lines.join("\n"));
      }, 4000);
    } finally {
      setBusy(null);
    }
  };

  const f = emp?.fuel ?? null;
  const m = emp?.muster ?? null;
  const lad = emp?.ladder ?? null;
  const live = emp?.live ?? null;
  const soldiers = live?.soldiers ?? [];
  const shown = showAll ? soldiers : soldiers.slice(0, 5);
  const escrowedCount = emp?.score.escrowed ?? 0;
  const fleet = live?.employedFleet ?? 0;

  return (
    <Card className="border-amber-900/50 bg-amber-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-amber-300">⚙️ תעסוקת-הצבא — מסילת-הדלק</span>
          <Badge
            variant="outline"
            className={cn(
              "px-1.5 py-0 font-mono text-[10px]",
              escrowedCount >= fleet && fleet > 0
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-300",
            )}
          >
            מועסקים {escrowedCount}/{fleet || "—"}
          </Badge>
          {f?.delegationConfirmed && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              דלק {f.delegationConfirmed}
            </Badge>
          )}
        </div>

        {/* מסילת-הדלק */}
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">SP מוקצים</div>
            <div className="font-mono text-amber-200">{f ? `${f.soldiers}×${f.spPerSoldier} = ${f.soldiers * f.spPerSoldier}` : "—"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">הון-חוזר</div>
            <div className="font-mono text-amber-200">{f?.capital?.total != null ? f.capital.total.toFixed(3) + " STEEM" : "—"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">SAOS בידי חיילים</div>
            <div className="font-mono text-amber-200">{live ? soldiers.reduce((s, x) => s + x.saos, 0).toFixed(3) : "—"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">מניות-LP חיילים</div>
            <div className="font-mono text-amber-200">{live ? live.withLp : "—"}</div>
          </div>
        </div>
        {f?.delegations?.txid && (
          <div className="mt-1.5 break-all font-mono text-[10px] text-zinc-500" dir="ltr">
            delegate txid: {f.delegations.txid} · fuel txid: {f.capital?.txid ?? "—"} · memo saos:fuel · מאומת on-chain
          </div>
        )}

        {/* שורות-חיילים */}
        <div className="scrollbar-thin mt-2 max-h-56 space-y-1 overflow-y-auto pe-1">
          {shown.map((s) => (
            <div key={s.username} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[11px]">
              <span className="w-24 shrink-0 font-medium text-zinc-200">@{s.username}</span>
              <span className="font-mono text-zinc-500" title="escrow במסדר">esc {s.escrowMuster != null ? s.escrowMuster.toFixed(3) : "—"}</span>
              <span className="font-mono text-zinc-500" title="קרדיט-DEX">crd {s.credit.toFixed(3)}</span>
              <span className="font-mono text-emerald-400/80" title="SAOS נזיל">{s.saos.toFixed(3)} SAOS</span>
              <span className={cn("font-mono", (s.lpShares ?? 0) > 0 ? "text-amber-300" : "text-zinc-600")} title="מניות-בריכה">
                {s.lpShares != null && s.lpShares > 0 ? "LP " + s.lpShares.toFixed(3) : "LP —"}
              </span>
              <span className="ms-auto truncate font-mono text-[9px] text-zinc-600" dir="ltr" title={s.escrowTxid ?? ""}>
                {s.escrowTxid ? s.escrowTxid.slice(0, 10) + "…" : "—"}
              </span>
            </div>
          ))}
          {soldiers.length === 0 && <div className="text-[11px] text-zinc-500">אין נתוני-תעסוקה עדיין — הרץ מסילת-דלק</div>}
        </div>
        {soldiers.length > 5 && (
          <Button variant="ghost" size="sm" className="mt-1 h-6 px-2 text-[10px] text-zinc-400" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "הצג פחות" : `הצג את כל ${soldiers.length} החיילים`}
          </Button>
        )}

        {/* סולם-גיוס-הון */}
        {lad && (
          <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
            <div className="font-medium text-zinc-300">סולם-גיוס-הון HE · {relTime(lad.at)}</div>
            <div className="mt-0.5 text-zinc-500">
              {lad.orders.length > 0
                ? lad.orders.map((o) => `${o.symbol}${o.error ? " ✗" : " ✓"}`).join(" · ")
                : "—"}
              {lad.skip.length > 0 && ` · דולגו: ${lad.skip.map((s) => s.symbol).join(", ")}`}
            </div>
            {lad.swapHiveAfter != null && (
              <div className="mt-0.5 font-mono text-[10px] text-zinc-500" dir="ltr">
                SWAP.HIVE {lad.swapHiveBefore} → {lad.swapHiveAfter} (Δ={lad.swapHiveDelta})
              </div>
            )}
            <div className="mt-0.5 text-[10px] text-zinc-600">
              RC-gated כנה: כש-RC של Hive אוזל — ההזמנות נדחות וממתינות לרג׳ן. העדות: history + tradesHistory.
            </div>
          </div>
        )}

        {/* פעולות */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" className="h-7 border-amber-400/30 bg-amber-400/10 px-2 text-[11px] text-amber-200 hover:bg-amber-400/20" disabled={busy != null} onClick={() => fire("fuel", "מסילת-דלק")}>
            {busy === "fuel" ? <Loader2 className="h-3 w-3 animate-spin" /> : "⛽ מסילת-דלק"}
          </Button>
          <Button size="sm" className="h-7 border-amber-400/30 bg-amber-400/10 px-2 text-[11px] text-amber-200 hover:bg-amber-400/20" disabled={busy != null} onClick={() => fire("muster", "מסדר-תעסוקה")}>
            {busy === "muster" ? <Loader2 className="h-3 w-3 animate-spin" /> : "🪖 מסדר-תעסוקה"}
          </Button>
          <Button size="sm" className="h-7 border-amber-400/30 bg-amber-400/10 px-2 text-[11px] text-amber-200 hover:bg-amber-400/20" disabled={busy != null} onClick={() => fire("he-ladder", "סולם-גיוס-הון")}>
            {busy === "he-ladder" ? <Loader2 className="h-3 w-3 animate-spin" /> : "🪜 סולם-גיוס-הון"}
          </Button>
        </div>
        {live?.liqLastAction && (
          <div className="mt-1.5 text-[10px] text-zinc-500">לולאת-נזילות: {live.liqLastAction}</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 50 — כרטיס ריבונות-RC ── */
function SovereignRcCard() {
  const src = useSovereignRc(true);
  const { spawn, runLog } = useExec(true);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const fire = async (script: string, label: string) => {
    setBusy(script);
    try {
      const res = await spawn(script, { real: true });
      if (!res.ok) {
        toast({ title: "הרצה נדחתה", description: res.error ?? "—", variant: "destructive" });
        return;
      }
      toast({ title: label + " — חי", description: "runId=" + (res.runId?.slice(0, 8) ?? "") });
      setTimeout(async () => {
        const lines = await runLog(res.runId!);
        if (lines.length) console.log(lines.join("\n"));
      }, 4000);
    } finally {
      setBusy(null);
    }
  };

  const m = src?.map;
  const t = m?.treasury;
  const salvo = src?.salvo;
  const bat = src?.batch;
  const run = src?.runner;
  const chk = src?.chunk;
  const pw = src?.powerup;
  const opsPerDay = m?.throughput?.fleetOpsPerDayCompact ?? null;
  const soldiers = m?.soldiers ?? [];
  const shown = soldiers.slice(0, 6);
  const crossed = salvo?.crossed ?? false;

  return (
    <Card className="border-emerald-900/50 bg-emerald-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-emerald-300">🛡️ ריבונות-RC — הצי מעל המגבלה</span>
          <Badge
            variant="outline"
            className={cn(
              "px-1.5 py-0 font-mono text-[10px]",
              crossed ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-zinc-700 bg-zinc-800/60 text-zinc-400",
            )}
          >
            {crossed ? `חומת-5/בלוק נפרצה ×${((salvo?.blockEvidence?.ourSaosOpsInBlock ?? 0) / Math.max(1, salvo?.singleWall ?? 5)).toFixed(1)}` : "ממתין למטח"}
          </Badge>
          {chk?.verified && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              חומת-8192B נפרצה
            </Badge>
          )}
        </div>

        {/* מפת-דלק */}
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">RC אוצר (Steem)</div>
            <div className="font-mono text-emerald-200">{t ? `${((t.rcNow ?? 0) / 1e9).toFixed(0)}G (${t.pct}%)` : "—"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">RC צי ({soldiers.length} חיילים)</div>
            <div className="font-mono text-emerald-200">{m?.fleetRcNow != null ? `${(m.fleetRcNow / 1e9).toFixed(0)}G` : "—"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">RC Hive (הבריכה-החנוקה)</div>
            <div className="font-mono text-amber-200">{m?.hive ? `${(m.hive.rcNow / 1e9).toFixed(2)}G / ${(m.hive.maxRc / 1e9).toFixed(1)}G` : "—"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">תפוקה קיימת-עצמית</div>
            <div className="font-mono text-emerald-200">{opsPerDay != null ? `≈${opsPerDay.toLocaleString()} ops/יום` : "—"}</div>
          </div>
        </div>

        {/* חיילים — שורות RC */}
        <div className="scrollbar-thin mt-2 max-h-44 space-y-1 overflow-y-auto pe-1">
          {shown.map((s) => (
            <div key={s.account} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[11px]">
              <span className="w-24 shrink-0 font-medium text-zinc-200">@{s.account}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.min(100, s.pct)}%` }} />
              </div>
              <span className="w-24 text-end font-mono text-zinc-500" dir="ltr">
                {(s.rcNow / 1e9).toFixed(0)}G ({s.pct}%)
              </span>
            </div>
          ))}
          {soldiers.length === 0 && <div className="text-[11px] text-zinc-500">הרץ מפת-דלק למדידה ראשונה</div>}
        </div>

        {/* תוצאות-חיות */}
        <div className="mt-2 space-y-1 text-[11px]">
          {salvo?.blockEvidence && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              ⚡ <span className="font-semibold">מטח-צי:</span> {salvo.blockEvidence.ourSaosOpsInBlock} ops שלנו בבלוק {salvo.maxBlock} (חומת-חשבון-יחיד={salvo.singleWall}) · {salvo.fired} חותמים-עצמאיים ·{" "}
              <span className="font-mono text-[10px] text-zinc-500" dir="ltr">
                {salvo.txids.filter((x) => x.txid).slice(0, 2).map((x) => x.txid.slice(0, 10) + "…").join(" · ")}
              </span>
            </div>
          )}
          {bat?.verified && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              📦 <span className="font-semibold">batch:</span> טרנזקציית-@{bat.soldier} = {bat.opsInTx} ops (בלוק {bat.block}) · עלות-op-קומפקטי נמדדה: {bat.rcCostPerOp != null ? `${(bat.rcCostPerOp / 1e6).toFixed(1)}M RC` : "—"}
            </div>
          )}
          {run?.anchored && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              ⚙️ <span className="font-semibold">מנוע-עומסים ריבוני:</span> {run.count} ריצות מקומיות ב-{run.ms}ms (אפס-RC) → עוגן אחד: {run.opsInTx} ops בבלוק {run.block} · דחיסה ×{run.compression} · digest מאומת on-chain
            </div>
          )}
          {chk?.verified && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              🧩 <span className="font-semibold">צ'אנקים:</span> מניפסט-מצב {chk.bytes?.toLocaleString()}B (×{( (chk.bytes ?? 0) / 8192).toFixed(1)} חומת-8192B) דרך {chk.chunks} חיילים · הורכב מהשרשרת — sha256 מתאים
            </div>
          )}
          {pw?.result?.verified && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              ⏫ <span className="font-semibold">powerup-Hive:</span> {pw.result.amountPowered} → HP · rcMax {( (pw.result.rcMaxBefore ?? 0) / 1e9).toFixed(2)}G→{((pw.result.rcMaxAfter ?? 0) / 1e9).toFixed(2)}G (+{pw.result.rcRegenGainPct}%)
            </div>
          )}
          {pw?.machine && !pw.result?.verified && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-400">
              ⏳ <span className="font-semibold">מכונת-powerup (דמון):</span> שלב {pw.machine.stage} · וריאנט {pw.machine.variant} — כשה-RC של Hive יתאושש המכונה מרימה את SWAP.HIVE→HP לבד
            </div>
          )}
        </div>

        {/* חומות → פתרונות ריבוניים */}
        <div className="scrollbar-thin mt-2 max-h-48 space-y-1 overflow-y-auto pe-1">
          {(src?.walls ?? []).map((w, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[10.5px]">
              <div className="font-medium text-zinc-300">🧱 {w.wall}</div>
              <div className="mt-0.5 text-zinc-500">נמדד: {w.measured}</div>
              <div className="mt-0.5 text-emerald-300/90">→ ריבוני: {w.sovereign}</div>
            </div>
          ))}
        </div>

        {/* פעולות */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" className="h-7 border-emerald-400/30 bg-emerald-400/10 px-2 text-[11px] text-emerald-200 hover:bg-emerald-400/20" disabled={busy != null} onClick={() => fire("rc-map", "מפת-דלק")}>
            {busy === "rc-map" ? <Loader2 className="h-3 w-3 animate-spin" /> : "🗺️ מפת-דלק"}
          </Button>
          <Button size="sm" className="h-7 border-emerald-400/30 bg-emerald-400/10 px-2 text-[11px] text-emerald-200 hover:bg-emerald-400/20" disabled={busy != null} onClick={() => fire("rc-salvo", "מטח-צי")}>
            {busy === "rc-salvo" ? <Loader2 className="h-3 w-3 animate-spin" /> : "⚡ מטח-צי"}
          </Button>
          <Button size="sm" className="h-7 border-emerald-400/30 bg-emerald-400/10 px-2 text-[11px] text-emerald-200 hover:bg-emerald-400/20" disabled={busy != null} onClick={() => fire("runner", "מנוע-עומסים")}>
            {busy === "runner" ? <Loader2 className="h-3 w-3 animate-spin" /> : "⚙️ מנוע-עומסים"}
          </Button>
          <Button size="sm" className="h-7 border-emerald-400/30 bg-emerald-400/10 px-2 text-[11px] text-emerald-200 hover:bg-emerald-400/20" disabled={busy != null} onClick={() => fire("chunk", "צ'אנקים")}>
            {busy === "chunk" ? <Loader2 className="h-3 w-3 animate-spin" /> : "🧩 צ'אנקים"}
          </Button>
        </div>
        <div className="mt-1.5 text-[10px] text-zinc-600">
          היתרון-מעל-משתמש-יחיד: חשבון אחד מוגבל ל-5 ops/בלוק ול-regen-עצמו — הצי שלנו חותם במקביל, מאריז טרנזקציות ומריץ הכל במנוע-מקומי באפס-עלות.
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 51 — כרטיס ריבונות מעל-השרשראות: פיצול-שרדים · שחזור-עולם · ביצועים ── */
function CrossSovereignCard() {
  const d = useSovereignCross(true);
  const { spawn } = useExec(true);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const fire = async (script: string, label: string) => {
    setBusy(script);
    try {
      const res = await spawn(script, { real: true });
      if (!res.ok) {
        toast({ title: "הרצה נדחתה", description: res.error ?? "—", variant: "destructive" });
        return;
      }
      toast({ title: label + " — חי", description: "runId=" + (res.runId?.slice(0, 8) ?? "") });
    } finally {
      setBusy(null);
    }
  };

  const c = d?.cross;
  const r = d?.rebuild;
  const p = d?.perf;
  const engine = p?.engine;
  const inclS = p?.inclusion?.steem;
  const inclH = p?.inclusion?.hive;

  return (
    <Card className="border-cyan-900/50 bg-cyan-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-cyan-300">⛓️ ריבונות מעל-השרשראות — המצב שלנו גבוה מכל רשת</span>
          {c?.rootMatch && (
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 text-[10px] text-cyan-300">
              אובייקט-חוצה-שרשראות מאומת
            </Badge>
          )}
          {c?.firstSoldierHiveSignature && (
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 text-[10px] text-cyan-300">
              חתימות-חייל ראשונות על Hive
            </Badge>
          )}
          {r?.allPass && (
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0 text-[10px] text-cyan-300">
              עולם שנבנה מהשרשרת {r.verdict}
            </Badge>
          )}
        </div>

        {/* שלושת ההוכחות */}
        <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">פיצול-שרדים בין-שרשרתי</div>
            <div className="font-mono text-cyan-200">
              {c?.rootMatch ? `${c.reassembledBytes ?? "—"}B · ${c.shardCount} שברים · 3+3` : "ממתין לריצה"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">אף שרשרת לא מחזיקה את האובייקט לבדה</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">שחזור-עולם מההיסטוריה הציבורית</div>
            <div className="font-mono text-cyan-200">{r ? `${r.verdict ?? "—"} · ${r.corpus?.ops ?? "—"} ops` : "ממתין לריצה"}</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">מנוע-עצמאי שני מאמת את השרשרת כמסד-הנתונים</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">מנוע ריבוני — אפס RC</div>
            <div className="font-mono text-cyan-200">{engine ? `${(engine.opsPerSec / 1000).toFixed(0)}K ops/s (${engine.usPerOp}µs)` : "ממתין למדידה"}</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">הריצות אצלנו — השרשרת רק מעגנת</div>
          </div>
        </div>

        {/* פירוט חי */}
        <div className="mt-2 space-y-1 text-[11px]">
          {c?.rootMatch && c.shards?.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              🧬 <span className="font-semibold">שברי המצב:</span>{" "}
              {c.shards.map((s) => (
                <span key={s.i} className="me-1.5 inline-block font-mono text-[10px] text-zinc-500" dir="ltr">
                  #{s.i}→{s.chain}@{s.signer}
                </span>
              ))}
              <div className="mt-1 text-[10px] text-zinc-500">
                שורש sha256: <span className="font-mono" dir="ltr">{c.root?.slice(0, 20)}…</span> · {c.manifestBytes}B הורכבו בחזרה בשלמותם מהיסטוריה ציבורית של שתי השרשראות · מקטעי-מצב: {c.manifestSections?.length}
              </div>
            </div>
          )}
          {r?.allPass && r.comparison?.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              ♻️ <span className="font-semibold">השרשרת = מסד-הנתונים:</span> supply {r.supply} SAOS · bestAsk {r.bestAsk} · {r.trades} trades · {r.comparison.filter((m) => m.ok).length}/{r.comparison.length} השוואות תואמות בין שני מנועי-שידור-חוזר בלתי-תלויים
            </div>
          )}
          {inclS?.latencyMs != null && inclH?.latencyMs != null && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              ⏱️ <span className="font-semibold">חבירה-לבלוק (נמדדה):</span> Steem {(inclS.latencyMs / 1000).toFixed(1)}s בלוק {inclS.block} · Hive {(inclH.latencyMs / 1000).toFixed(1)}s בלוק {inclH.block} · מרוץ-RPC {p?.rpc?.bestSingleMs}ms→{p?.rpc?.raceAllMs}ms
            </div>
          )}
          {p?.anchor?.txid && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-zinc-300">
              ⚓ <span className="font-semibold">דוח-הביצועים מעוגן on-chain:</span> <span className="font-mono text-[10px] text-zinc-500" dir="ltr">{p.anchor.txid.slice(0, 18)}…</span> · digest <span className="font-mono text-[10px] text-zinc-500" dir="ltr">{p.anchor.digest?.slice(0, 14)}…</span>
            </div>
          )}
        </div>

        {/* פעולות */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" className="h-7 border-cyan-400/30 bg-cyan-400/10 px-2 text-[11px] text-cyan-200 hover:bg-cyan-400/20" disabled={busy != null} onClick={() => fire("cross-shard", "פיצול-שרדים")}>
            {busy === "cross-shard" ? <Loader2 className="h-3 w-3 animate-spin" /> : "🧬 פיצול-שרדים חי"}
          </Button>
          <Button size="sm" className="h-7 border-cyan-400/30 bg-cyan-400/10 px-2 text-[11px] text-cyan-200 hover:bg-cyan-400/20" disabled={busy != null} onClick={() => fire("cross-collect", "הרכבה-מחדש")}>
            {busy === "cross-collect" ? <Loader2 className="h-3 w-3 animate-spin" /> : "♻️ הרכבה-מחדש"}
          </Button>
          <Button size="sm" className="h-7 border-cyan-400/30 bg-cyan-400/10 px-2 text-[11px] text-cyan-200 hover:bg-cyan-400/20" disabled={busy != null} onClick={() => fire("rebuild", "שחזור-עולם")}>
            {busy === "rebuild" ? <Loader2 className="h-3 w-3 animate-spin" /> : "🌍 שחזור-עולם"}
          </Button>
          <Button size="sm" className="h-7 border-cyan-400/30 bg-cyan-400/10 px-2 text-[11px] text-cyan-200 hover:bg-cyan-400/20" disabled={busy != null} onClick={() => fire("perf", "מדידת-ביצועים")}>
            {busy === "perf" ? <Loader2 className="h-3 w-3 animate-spin" /> : "⏱️ מדידת-ביצועים"}
          </Button>
        </div>
        <div className="mt-1.5 text-[10px] text-zinc-600">
          העיקרון: הריצות חיות במנוע-שלנו (אפס-RC/תלות), המצב מפוזר על שתי שרשראות (אף אחת לא יכולה להגביל), וההוכחה נבנית מחדש ע״י כל צד-שלישי מההיסטוריה הציבורית.
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 52 — כרטיס מפעל-ההלוואות: החלון החי · הסף · המטח-40 ── */
function BorrowCard() {
  const d = useSovereignBorrow(true);
  const { spawn } = useExec(true);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const fire = async (script: string, label: string) => {
    setBusy(script);
    try {
      const res = await spawn(script, { real: true });
      if (!res.ok) {
        toast({ title: "הרצה נדחתה", description: res.error ?? "—", variant: "destructive" });
        return;
      }
      toast({ title: label + " — חי", description: "runId=" + (res.runId?.slice(0, 8) ?? "") });
    } finally {
      setBusy(null);
    }
  };

  const w = d?.borrowWindow;
  const t = d?.threshold;
  const s = d?.salvo52;
  const statusLabel =
    w?.status === "minted" ? "minted ✓"
    : w?.status === "claimed-ticket-held" ? "טיקט נתבע — שורד על-השרשרת"
    : w?.status === "wall-not-crossed" ? "חומה לא-נחצת (מדוד) — סף-SP חמוש"
    : w?.status ?? "—";

  return (
    <Card className="border-amber-900/50 bg-amber-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-amber-300">🏦 מפעל-ההלוואות — האוצר מלווה דלק לעצמו ומטביע</span>
          {w && (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[10px] text-amber-300">
              חלון-חי: {statusLabel}
            </Badge>
          )}
          {s?.heaviest && s.heaviest.ops >= 5 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              מטח-40: {s.heaviest.ops} ops בבלוק {s.heaviest.block} (×{(s.heaviest.ops / 5).toFixed(1)} מהחומה)
            </Badge>
          )}
          {w && w.restored >= w.frozen && w.frozen > 0 && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">
              פריקה-נקייה {w.restored}/{w.frozen}
            </Badge>
          )}
        </div>

        {!d ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : (
          <>
            {/* מד-הסף: האוצר מול 9,920,604 vests — המפתח למינט-דרך-הלוואה */}
            {t && (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-zinc-950/60 p-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">סף borrow-mint: {t.vests.toLocaleString()} vests ≈ 6,136 SP עצמיים</span>
                  <span className={cn("font-mono", t.pct >= 100 ? "text-emerald-400" : "text-amber-300")}>{t.pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className={cn("h-full rounded-full", t.pct >= 100 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: Math.min(100, t.pct) + "%" }} />
                </div>
                <div className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                  עצמי-נוכחי {Math.round(t.ownVests).toLocaleString()} vests · {t.pendingReturnsNote} · מעל הסף הדמון מטביע לבד (FACTORY_BORROW_VESTS)
                </div>
              </div>
            )}

            {/* תמצית החלון */}
            {w && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="text-zinc-500">יוצר</div>
                  <div className="font-mono text-zinc-200">@{w.creator}</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="text-zinc-500">הקפאת-דלק → שחרור</div>
                  <div className="font-mono text-zinc-200">{w.frozen} → {w.restored}</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="text-zinc-500">טיקט / מינט</div>
                  <div className="font-mono text-zinc-200">
                    {w.claim?.tickets != null ? `tickets=${w.claim.tickets}` : "—"} · {w.mint?.verified ? "minted" : w.mint ? "unverified" : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="text-zinc-500">חלונות-חיים</div>
                  <div className="font-mono text-zinc-200">{w.runs}</div>
                </div>
              </div>
            )}

            {/* המטח-52 */}
            {s && (
              <div className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                מטח: <span className="font-mono text-zinc-200">{s.ourOps} ops</span> מ-<span className="font-mono text-zinc-200">{s.signers?.length ?? 0} חותמים-עצמאיים</span>
                {s.heaviest ? <> · בלוק-כבד: <span className="font-mono text-emerald-300">{s.heaviest.ops} ops</span> בבלוק <span className="font-mono">{s.heaviest.block}</span> — אימות בסריקת-בלוק ישירה (get_transaction מפגר — נמדד)</> : " · ממתין לאימות"}
              </div>
            )}

            {/* חומות-מדודות → פתרון-ריבוני */}
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 [scrollbar-width:thin]">
              {(d?.measuredWalls ?? []).map((x) => (
                <div key={x.wall} className="border-b border-zinc-900 py-1.5 text-[11px] last:border-0">
                  <span className="font-semibold text-amber-300">{x.wall}</span>
                  <span className="text-zinc-500"> → {x.measured}</span>
                  <div className="text-[10px] text-emerald-400/80">פתרון: {x.solution}</div>
                </div>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-8 border-amber-400/30 text-[11px] text-amber-200 hover:bg-amber-400/10" disabled={busy !== null} onClick={() => fire("mint-borrow", "חלון-ההלוואה")}>
                {busy === "mint-borrow" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🏦"} חלון-הלוואה-חי
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-amber-400/30 text-[11px] text-amber-200 hover:bg-amber-400/10" disabled={busy !== null} onClick={() => fire("salvo52", "מטח-צי")}>
                {busy === "salvo52" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "⚡"} מטח-צי 10×4
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 48 — כרטיס מפעל דור-שני + פעימת-צי ── */
function FleetCard({ status }: { status: AgentStatus | null }) {
  const { data: exec, spawn, runLog } = useExec(true);
  const { toast } = useToast();
  const [name, setName] = useState("hcnova2");
  const [busy, setBusy] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const fleet = status?.fleet ?? null;
  const loops = status?.loops ?? {};
  const fp = loops["fleetPace"];
  const rcPct = status?.rc?.pct ?? null;
  const tickets = status?.tickets ?? 0;
  const agents = status?.factory?.agents ?? [];

  const fire = async (mode: string, params: Record<string, unknown>, live: boolean) => {
    setBusy(mode + (live ? ":live" : ""));
    try {
      const res = await spawn("factory2", { mode, real: live, ...params });
      if (!res.ok) {
        toast({ title: "הרצה נדחתה", description: res.error ?? "—", variant: "destructive" });
        return null;
      }
      toast({ title: live ? "שידור חי בוצע — בדוק את הלוג" : "הרצה נורתה", description: "runId=" + (res.runId?.slice(0, 8) ?? "") });
      return res.runId ?? null;
    } finally {
      setBusy(null);
    }
  };

  const showLog = async (runId: string) => {
    const toggleOff = runId === logFor;
    setLogFor(toggleOff ? null : runId);
    if (toggleOff) return;
    let lines = await runLog(runId);
    if (lines.length === 0) {
      // התהליך נולד הרגע — נותנים לו שניות לכתוב את הפלט הראשון
      await new Promise((r) => setTimeout(r, 2500));
      lines = await runLog(runId);
    }
    setLogLines(lines);
  };

  const runs = exec?.runs ?? [];
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  const factory2At = exec?.results?.factory2?.at ?? null;

  return (
    <Card className="border-violet-900/50 bg-violet-400/5">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-violet-300">🧬 מפעל דור-שני + פעימת-צי</span>
          <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">דטרמיניסטי ✓</Badge>
          <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">עוגן-חילוץ ✓</Badge>
          <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-300">גיבוי-כספת ✓</Badge>
        </div>

        {/* postmortem hcnova1 */}
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px] leading-relaxed">
          <div className="font-medium text-zinc-300">ניתוח-שלד: hcnova1</div>
          <div className="mt-0.5 text-zinc-500">
            נולד 3.9 במפעל-דור-1 (מפתחות random, שמורים מקומית בלבד) → המפתחות אבדו ב-reset של הסביבה →
            זומבי בלתי-ניתן לשחזור. <span className="text-emerald-400">הטיפול: 50 SP הוחזרו לאוצר</span> (txid d87c96f9…, חוזר אחרי 7 ימי-צינון).
            מדור-שני: מפתחות נגזרים מ-FACTORY_MASTER (שחזירים לנצח) + headcorner בסמכות-owner (חילוץ תמידי) + רישום בכספת.
          </div>
        </div>

        {/* fleet strip */}
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">גודל-צי</div>
            <div className="font-mono text-violet-200">{fleet?.size ?? status?.army?.size ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">פינגים היום</div>
            <div className="font-mono text-violet-200">{fleet?.pingsToday ?? 0}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">פינג אחרון</div>
            <div className="font-mono text-violet-200">{fleet?.lastPingBy ? "@" + fleet.lastPingBy : "—"}</div>
            <div className="text-[9px] text-zinc-600">{relTime(fleet?.lastPingAt ?? null)}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">ניתוב-עמלות</div>
            <div className="truncate font-mono text-violet-200" dir="ltr" title={fleet?.routed ?? ""}>{fleet?.routed ?? "—"}</div>
          </div>
        </div>
        {fleet?.lastTxid && (
          <div className="mt-1.5 break-all font-mono text-[10px] text-zinc-500" dir="ltr">
            fleet_ping txid: {fleet.lastTxid} · חתום במפתח החייל עצמו, מאומת get_transaction
          </div>
        )}
        {fp && (
          <div className="mt-1.5 text-[10px] text-zinc-500">
            לולאת-פעימה: {fp.detail} <span className="text-zinc-600">({relTime(fp.lastRun)})</span>
          </div>
        )}

        {/* factory state */}
        <div className="mt-2 text-[11px] text-zinc-400">
          אוצר: RC {rcPct != null ? rcPct.toFixed(1) + "%" : "—"} · טיקטים: {tickets} · סוכנים: {agents.length ? agents.map((a) => "@" + a).join(", ") : "—"}
        </div>
        <div className="mt-0.5 text-[10px] text-zinc-600">
          חומת-פרוטוקול נמדדה: תביעת-חשבון = 6T RC (≈3,571 SP) — חיילים רחוקים פי-160 → המפעל מטביע אוטונומית כשהאוצר מלא-דלק (gate 80%).
        </div>

        {/* actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-40 border-zinc-800 bg-zinc-950 text-[11px]"
            placeholder="שם הבוט הבא"
            dir="ltr"
            aria-label="שם חשבון הבוט"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-violet-400/30 bg-violet-400/10 text-[11px] text-violet-200 hover:bg-violet-400/20"
            disabled={busy != null || !name.trim()}
            onClick={async () => {
              const id = await fire("derive", { name: name.trim() }, false);
              if (id) await showLog(id);
            }}
          >
            הוכח-שחזור
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-300 hover:bg-zinc-800"
            disabled={busy != null}
            onClick={() => void fire("claim", { creator: "haran" }, true)}
          >
            {busy === "claim:live" ? <Loader2 className="size-3 animate-spin" /> : null}
            מדוד תביעת-טיקט חייל
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-amber-400/30 bg-amber-400/10 text-[11px] text-amber-200 hover:bg-amber-400/20"
            disabled={busy != null || !name.trim()}
            onClick={() => {
              if (window.confirm("שחזור-הקצבה חי: undelegate כל ה-SP מ-@" + name.trim() + " חזרה לאוצר?")) {
                void fire("reclaim", { name: name.trim() }, true);
              }
            }}
          >
            {busy === "reclaim:live" ? <Loader2 className="size-3 animate-spin" /> : null}
            גבה הקצבה
          </Button>
          <Button
            size="sm"
            className="h-8 bg-violet-500 text-[11px] text-white hover:bg-violet-400"
            disabled={busy != null || !name.trim()}
            onClick={() => {
              if (window.confirm("לידת דור-שני חיה: @" + name.trim() + " נוצר על השרשרת עם מפתחות דטרמיניסטיים + עוגן-חילוץ?")) {
                void fire("mint", { name: name.trim(), creator: "headcorner", sp: 0.5, topup: 4.5 }, true);
              }
            }}
          >
            {busy === "mint:live" ? <Loader2 className="size-3 animate-spin" /> : null}
            לידת דור-שני
          </Button>
        </div>
        <div className="mt-1 text-[10px] text-zinc-600">
          הוכח-שחזור = בטוח (קריאה בלבד) · מדידת-תביעה תיכשל בכנות על חומת-RC · גבייה/לידה = שידור חי עם דיאלוג-אישור ·
          ריצה אחרונה: {factory2At ? relTime(factory2At) : "—"}
        </div>

        {/* last run log */}
        {lastRun && (
          <div className="mt-2">
            <button
              type="button"
              className="text-[10px] text-zinc-500 underline decoration-dotted hover:text-zinc-300"
              onClick={() => void showLog(lastRun.id)}
            >
              {logFor === lastRun.id ? "הסתר לוג" : "לוג ריצה אחרונה"} · {lastRun.label}
            </button>
            {logFor === lastRun.id && (
              <pre className="scrollbar-thin mt-1 max-h-40 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-left font-mono text-[10px] leading-relaxed text-zinc-400" dir="ltr">
                {logLines.slice(-40).join("\n") || "(אין פלט עדיין)"}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SystemView({
  status,
  brain,
}: {
  status: AgentStatus | null;
  brain: BrainResponse | null;
}) {
  const loops = status?.loops ?? {};
  const identity = status?.identity;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold text-zinc-100">🛰️ מערכת</h1>
        <p className="text-[11px] text-zinc-500">
          חדר-המכונות: מה שהדמון עושה בפועל, עם אילו הוכחות, ואיך הזהות נגזרת
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* loops */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[13px] font-semibold text-zinc-100">⚙️ לולאות הדמון</span>
              <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 font-mono text-[10px] text-zinc-400">
                {Object.keys(loops).length}
              </Badge>
              <span className="ms-auto text-[10px] text-zinc-500">עודכן {relTime(status?.updatedAt)}</span>
            </div>
            <ul className="scrollbar-thin max-h-[28rem] space-y-1.5 overflow-y-auto pe-1">
              {Object.entries(loops).map(([name, loop]) => {
                const meta = LOOP_LABELS[name] ?? { label: name, what: "" };
                return (
                  <li key={name} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          loop.status === "ok"
                            ? "bg-emerald-400"
                            : loop.status === "skipped" || loop.status === "dry" || loop.status === "idle" || loop.status === "disabled"
                              ? "bg-amber-400"
                              : "bg-rose-500",
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-[12px] font-medium text-zinc-200">{meta.label}</span>
                      <span className="ms-auto text-[9px] text-zinc-500">{relTime(loop.lastRun)}</span>
                    </div>
                    <div className="mt-0.5 ps-3.5 text-[10px] text-zinc-500">
                      {meta.what && <span className="text-zinc-600">{meta.what} · </span>}
                      {loop.detail}
                    </div>
                    {loop.counters && Object.keys(loop.counters).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 ps-3.5">
                        {Object.entries(loop.counters).map(([k, v]) => (
                          <span key={k} className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" dir="ltr">
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
              {Object.keys(loops).length === 0 && (
                <li className="rounded-lg border border-dashed border-zinc-800 px-3 py-8 text-center text-[11px] text-zinc-600">
                  אין דיווח — הדמון יקום אוטומטית בפעימת הבאה
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {/* identity */}
          <Card className="border-teal-900/50 bg-teal-400/5">
            <CardContent className="p-4">
              <div className="text-[13px] font-semibold text-teal-300">🌐 זהות מפתח-אחד</div>
              {identity == null ? (
                <Skeleton className="mt-2 h-16 w-full bg-zinc-900" />
              ) : (
                <div className="mt-2 space-y-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-zinc-500">Steem posting:</span>
                    <span className="break-all font-mono text-teal-200/90" dir="ltr">{identity.steemPub}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-zinc-500">EVM (keccak256 נגזר):</span>
                    <span className="break-all font-mono text-teal-200/90" dir="ltr">{identity.evmAddress}</span>
                  </div>
                  <div className="text-zinc-500">
                    צד-שרשרת: {identity.heTokens} טוקנים ≈ {identity.heValueSwapHive.toFixed(4)} SWAP.HIVE · נזיל {identity.heSwapHive.toFixed(4)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* bridge */}
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="p-4">
              <div className="text-[13px] font-semibold text-zinc-100">🌉 גשר Steem → Hive</div>
              {(() => {
                const b = loops["bridge"];
                return (
                  <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
                    <div>{b ? b.detail : "אין דיווח"}</div>
                    <div className="text-[10px] text-zinc-600">
                      כל פעולת SAOS נחתמת גם על Hive (עיגון) + checkpoint proof-of-reserve כל 6 שעות —
                      כל אחד יכול לחשב מחדש את הריפליי ולהשוות.
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* forkscan — same-key territories */}
          <ForkscanCard />

          {/* 48 — factory v2 + fleet pace */}
          <FleetCard status={status} />

          {/* 49 — תעסוקת-הצבא */}
          <EmploymentCard />

          {/* 50 — ריבונות-RC */}
          <SovereignRcCard />

          {/* 51 — ריבונות מעל-השרשראות */}
          <CrossSovereignCard />

          {/* 52 — מפעל-ההלוואות */}
          <BorrowCard />

          {/* 53 — מנוע-ערך ריבוני */}
          <ValueEngineCard />

          {/* 54 — מנוע-רפלקס-בלוק */}
          <ReflexCard />

          {/* 62 — PAYMASTER: החוזה משלם גז + פריצה חוצת-שרשראות */}
          <PaymasterCard />

          {/* 63 — WRAPPED: מטבעות צמודים על הדקס + לכידת-עמלות */}
          <WrappedCard />

          {/* 65 — MICRODEX: חיילים חותמים-עצמם פעולות-דקס מיקרו */}
          <MicrodexCard />

          {/* 66 — I-REST-MY-CASE: תיק-ההוכחות המאתגרות */}
          <Case66Card />

          {/* 68 — SAOS-NET: הרשת-הריבונית שלנו (הקרקע למשהו גדול) */}
          <SaosNetCard />

          {/* 84 — SELF-HOST: הרשת יושבת על השרת של עצמה — מדע-ההיסק */}
          <SelfhostCard />

          {/* 85 — דוח-הריבונות בעברית: חי ב-repo + בקונסולה */}
          <HeReportCard />

          {/* SCI — chain infrastructure */}
          <SCICard />

          {/* vault/access */}
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="p-4">
              <div className="text-[13px] font-semibold text-zinc-100">🔐 גישה</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="text-zinc-500">posting</div>
                  <div className={brain?.autonomy?.keyConfigured ? "font-mono text-emerald-400" : "text-zinc-500"} dir="ltr">
                    {brain?.autonomy?.keyConfigured ? `✓ ${brain.autonomy.keyMasked}` : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="text-zinc-500">active</div>
                  <div className={brain?.autonomy?.activeKeyInVault ? "font-mono text-emerald-400" : "text-zinc-500"} dir="ltr">
                    {brain?.autonomy?.activeKeyInVault ? `✓ ${brain.autonomy.activeKeyMasked}` : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                ה-WIF לא עוזב את המכונה. הקונסולה מציגה טביעות-אצבע ממוסכות בלבד.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ProofsPanel />
    </div>
  );
}
