'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, Coins, Gauge, Gavel, GitBranch, Layers, PiggyBank, Route, ShieldCheck, Store, Users } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import { RailRow } from './RailRow'

/**
 * T-75 · רשת-ה-DEX שלנו — the network DEX card.
 * Self-fetching from /api/saos/dex (thin proxy to mini-services/saos-dex :3037).
 * Rendering law: every number the service measured renders as measured; every
 * gated rail renders GATED with its unlock — nothing is presented as swapable
 * when its settlement path is not armed ("ערך אמיתי ולא סתם שקר").
 * Tone law: emerald = armed/measured, amber = gated/plan, rose = down. No blue/indigo.
 */

type DexStatus = {
  ok?: boolean
  at?: string
  stale?: boolean
  engine?: { up?: boolean; at?: string | null; stale?: boolean }
  escrow?: {
    ok?: boolean; checked?: number
    law?: string
    backing?: Record<string, { internal?: number; covered?: number; gated?: boolean; backing?: { source: string; amount: number }[]; note?: string }>
  }
  pools?: Record<string, { assets?: string[]; reserveA?: number; reserveB?: number; feeBps?: number; backed?: boolean; mid?: number | null; note?: string }>
  rails?: Record<string, { status?: string; cls?: string; note?: string; unlock?: string | null }>
  grids?: { at?: string; stacks?: { id: string; parity?: number | null; guardAction?: string | null; plan?: { verdict?: string; asks?: { side: string; price: number; qty: number }[]; bids?: { side: string; price: number; qty: number }[]; laws?: string[] } }[] }
  arb?: { venues?: { id: string; pair: string[]; mid: number; status: string; source: string; kind?: string; touch?: { bestAsk: number; bestBid: number; askDepth?: number | null; bidDepth?: number | null } | null; calib?: string | null; driftBps?: number | null }[]; quarantined?: string[]; arbGuardLaw?: string; executable?: number; opportunities?: { pair: string; buy: string; sell: string; edgeBps: number; netBps: number; cls: string; kind?: string; verdict: string; touch?: { buyAt: number; sellAt: number } | null; impact?: string | null; maxNotional?: number | null; depthVerdict?: string | null; depthWhy?: string | null }[] }
  leaderboard?: { id: string; kind: string; trades: number; volumeIn: number; feesPaid: number }[]
  settlement?: { queueTail?: { id: string; side: string; price: number; qty: number; status: string; orderid?: number }[]; receipts?: { verdict?: string; results?: { id: string; orderid?: number; side?: string; qty?: string; txid?: string | null; at?: string }[]; refuses?: { id: string; refuse: string }[] } | null }
  deposits?: { lastBlock?: number | null; credits?: { at?: string; from?: string; amount?: string; agent?: string; txid?: string | null }[]; pending?: { at?: string; from?: string; amount?: string; why?: string }[]; law?: string; memo?: string }
  credit?: { supply?: number; faceUsd?: number; minRedeem?: number; redemptionLaw?: string; minted?: { amount: number; ref: string; reason: string; at: string }[] }
  batch?: {
    windowMs?: number
    current?: { id?: string; openedAt?: string; orders?: number; closesInMs?: number }
    lastClosed?: { id?: string; verdict?: string; clearingPrice?: number | null; matchedQty?: number; feeQuote?: number; digest?: string | null; closedAt?: string } | null
    law?: string
  }
  intake?: {
    at?: string
    converts?: { verdict?: string; source?: string | null; landing?: { verdict?: string; totalSbd?: number; nextAt?: string | null; waves?: { day: string; sbd: number; count: number; windowUtc: string; within24h: boolean }[]; law?: string } }
    drillWave1?: { wave?: { day: string; sbd: number; within24h: boolean } | null; result?: DrillResult }
    drillTotal?: { result?: DrillResult }
    routerMap?: {
      networks?: { chain: string; name: string; acceptAny: boolean; assets: { sym: string; accept: string; acceptWhy: string; unlock: string | null; swapToValue: { verdict: string; path: string[] | null; gated: boolean }; largeAmountLaw: string }[]; law: string }[]
      law?: string
    }
    law?: string
  }
  blurtOtc?: {
    at?: string
    rail?: { status?: string; unlock?: string | null; inventory?: number; price?: number | null; laws?: string[] }
    plan?: { verdict?: string; why?: string; priceSbdPerBlurt?: number; spreadBps?: number; asks?: { price: number; qty: number; notionalSbd: number }[]; bids?: { price: number; qty: number; notionalSbd: number }[]; laws?: string[]; law?: string }
    deliveryLaw?: string
    source?: string
  }
  heCalibration?: {
    verdict?: string
    why?: string
    rows?: { sym: string; verdict: string; impliedUsd?: number; anchorUsd?: number; driftBps?: number; spreadBps?: number | null; why?: string }[]
    law?: string
  }
  ticks?: { count?: number; last?: { at?: string; parity?: number | null; opportunities?: number } | null; heartbeat?: { at?: string; verdict?: string; law?: string } }
}

type DrillResult = {
  verdict?: string
  intake?: { SBD?: number; STEEM?: number }
  pre?: { poolA?: number; poolB?: number; asks?: number; bids?: number }
  post?: { poolA?: number; poolB?: number; askTop?: { price: number; qty: number } | null; asks?: number; bids?: number }
  armCandidates?: { ask?: { lawful?: boolean; refuse?: string | null; price?: number | null; qty?: number | null }; bid?: { lawful?: boolean; refuse?: string | null } }
  escrowProjected?: { ok?: boolean; coveredSteem?: number; coveredSbd?: number }
  neverShrink?: boolean
  expected?: { topAskNotionalQuote?: number; drainBand?: number[] | null }
}

const n6 = (v?: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6) : '—')
const n3 = (v?: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—')
// touched prices span 0.0005…1,569,104 — 4 significant digits keep every leg readable
const fmtTouch = (v?: number | null) => (typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toPrecision(4))) : '—')

const railTone = (cls?: string) => (cls === 'armed' ? 'emerald' : cls === 'gated' ? 'amber' : 'slate') as const

export function DexCard() {
  const [dex, setDex] = useState<DexStatus | null>(null)
  const [down, setDown] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setBusy(true)
      const r = await fetch('/api/saos/dex', { cache: 'no-store' })
      const j = (await r.json()) as DexStatus
      if (r.ok && j?.ok) { setDex(j); setDown(false) } else if (!r.ok && !j?.ok) { setDown(true) }
    } catch { setDown(true) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const up = !!dex?.engine?.up
  const escrowOk = dex?.escrow?.ok !== false
  const pools = Object.entries(dex?.pools ?? {})
  const livePools = pools.filter(([, p]) => p.backed)
  const rails = Object.entries(dex?.rails ?? {})
  const armedRails = rails.filter(([, r]) => r.cls === 'armed')
  const stack = dex?.grids?.stacks?.[0]
  const opps = dex?.arb?.opportunities ?? []
  const execOpps = opps.filter((o) => o.kind === 'TRADEABLE')
  const signalOpps = opps.filter((o) => o.kind === 'SIGNAL')
  const venues = dex?.arb?.venues ?? []
  const receipts = dex?.settlement?.receipts
  const queue = dex?.settlement?.queueTail ?? []
  const queued = queue.filter((q) => q.status === 'queued')
  const steemBacking = dex?.escrow?.backing?.STEEM
  const sbdBacking = dex?.escrow?.backing?.SBD

  return (
    <SectionCard
      icon={Layers}
      tone={down ? 'rose' : up ? 'emerald' : 'amber'}
      title={<>רשת-ה-DEX שלנו · סוופים-אמת <span dir="ltr" className="text-slate-500">(T-75)</span></>}
      actions={
        <StatusBadge tone={down ? 'rose' : up ? 'emerald' : 'amber'}>
          {down ? 'שירות-מנותק' : up ? 'חי · משכן-מסונכרן' : 'זמן-קצה'}
        </StatusBadge>
      }
    >
      {down && <p className="text-[11px] text-rose-300">שירות-ה-DEX אינו זמין — אין מדידה-עוקפת-שירות (חוק-הגוף-האחד).</p>}

      {!down && dex && (
        <div className="space-y-3">
          {/* law strip */}
          <p className="text-[11px] leading-relaxed text-slate-500">{dex.escrow?.law ?? ''} · {dex.rails?.['steem-limit-order']?.note ?? ''}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>דופק: <b className="tnum text-slate-300">{dex.ticks?.count ?? 0}</b> טיקים</span>
            {dex.ticks?.heartbeat && (
              <StatusBadge tone={dex.ticks.heartbeat.verdict === 'FRESH' ? 'emerald' : 'amber'}>{dex.ticks.heartbeat.verdict === 'FRESH' ? 'דופק-חי' : 'דופק-עוקב'}</StatusBadge>
            )}
            <span className="text-slate-600">· דופק-נגרר-בקשות — אין-מוות-שקט (T-60 הלקח)</span>
          </div>

          {/* headline stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="פאריטי-חי" value={n6(stack?.parity)} tone="emerald" ltr hint="SBD ל-STEEM — מדידת-המנוע" />
            <Stat label="בריכות-חיות" value={`${livePools.length}/${pools.length}`} tone="emerald" ltr hint="פאריטי-פרופורציונלי מהמשכן" />
            <Stat label="מסילות-חמושות" value={`${armedRails.length}/${rails.length}`} tone={armedRails.length ? 'emerald' : 'amber'} ltr hint="השאר: gated עם-פתיחה-מנומקת" />
            <Stat label="הזדמנויות-מימוש" value={String(execOpps.length)} tone={execOpps.length ? 'emerald' : 'slate'} ltr hint={`${venues.length} מקומות-שוק · ${signalOpps.length} אותות-הוגנות (לא-מימוש)`} />
          </div>

          {/* escrow */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <ShieldCheck className={escrowOk ? 'h-3.5 w-3.5 text-emerald-400' : 'h-3.5 w-3.5 text-rose-400'} aria-hidden />
              <b className={escrowOk ? 'text-emerald-300' : 'text-rose-300'}>חוק-המשכן {escrowOk ? 'שומר' : 'נפרץ'}</b>
              <span className="text-slate-600">· נבדקו {dex.escrow?.checked ?? 0} מטבעות</span>
            </div>
            <RailRow label="STEEM · כיסוי-שרשרת / בריכה / פנוי-לסוכנים" value={`${n3(steemBacking?.backing?.[0]?.amount ?? null)} / ${n3(steemBacking?.internal)} / ${n3(steemBacking?.covered)}`} ltr />
            <RailRow label="SBD · כיסוי-שרשרת / בריכה / פנוי-לסוכנים" value={`${n3(sbdBacking?.backing?.[0]?.amount ?? null)} / ${n3(sbdBacking?.internal)} / ${n3(sbdBacking?.covered)}`} ltr className="mt-1" />
            <p className="mt-2 text-[10px] text-slate-600">אפס-הדפסה-עצמית: הרשת אינה מחזיקה מבפנים יותר מהמשכן-הנמדד — HIVE/HBD/BLURT/SWAP.* נפתחים רק עם-הפקדה-מאומתת (שער-המפעיל).</p>
          </div>

          {/* opposing grids */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <GitBranch className="h-3.5 w-3.5 text-amber-300" aria-hidden />
              <b className="text-slate-200">סריגים-מתנגדים</b>
              <span className="text-slate-600">{stack?.id ?? ''}</span>
              {stack?.guardAction && <StatusBadge tone="amber">{stack.guardAction}</StatusBadge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>אסקים-כשרים: <b className="tnum text-slate-200">{stack?.plan?.asks?.length ?? 0}</b> (מעל פאריטי+רצפת-עלות)</span>
              <span>בידים-כשרות: <b className="tnum text-slate-200">{stack?.plan?.bids?.length ?? 0}</b> (מתחת-פאריטי)</span>
            </div>
            {(stack?.plan?.asks ?? []).slice(0, 1).map((a, i) => (
              <RailRow key={`a${i}`} label="רמת-אסק-ראשה" value={`${n3(a.qty)} STEEM @ ${n6(a.price)}`} ltr className="mt-1" />
            ))}
            {(stack?.plan?.laws ?? []).slice(0, 2).map((l, i) => (
              <p key={i} className="mt-1 text-[10px] text-slate-600">· {l}</p>
            ))}
          </div>

          {/* batch (mini-CoW) */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <Gavel className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
              <b className="text-slate-200">מחבת-CoW · מחיר-ניקוי אחיד</b>
              {dex.batch?.lastClosed?.verdict && (
                <StatusBadge tone={dex.batch.lastClosed.verdict === 'CLEARED' ? 'emerald' : dex.batch.lastClosed.verdict === 'REFUSE-BAND' ? 'amber' : 'slate'}>
                  {dex.batch.lastClosed.verdict}
                </StatusBadge>
              )}
            </div>
            <RailRow
              label="מחבת-פתוחה · הזמנות · נסגרת-בעוד"
              value={`${dex.batch?.current?.id ?? '—'} · ${dex.batch?.current?.orders ?? 0} · ${Math.ceil((dex.batch?.current?.closesInMs ?? 0) / 60_000)} דק׳`}
              ltr
            />
            {dex.batch?.lastClosed && (
              <RailRow
                label="מחבת-אחרונה · מחיר-ניקוי · נמדד · עמלה · digest"
                value={`${dex.batch.lastClosed.id ?? '—'} · ${n6(dex.batch.lastClosed.clearingPrice ?? null)} · ${n3(dex.batch.lastClosed.matchedQty ?? null)} · ${n3(dex.batch.lastClosed.feeQuote ?? null)} · ${dex.batch.lastClosed.digest ?? '—'}`}
                ltr
                className="mt-1"
                tone={dex.batch.lastClosed.verdict === 'CLEARED' ? 'emerald' : 'slate'}
              />
            )}
            <p className="mt-2 text-[10px] text-slate-600">{dex.batch?.law ?? ''} — כל-מחבתה סגורה ניתנת-לחישוב-חוזר מהקלטים שלה (ארטיפקט-אמון, דפוס-CoW).</p>
          </div>

          {/* capital-intake drill (T-75d) — the money event, proven before it lands */}
          {dex.intake && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                <PiggyBank className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                <b className="text-slate-200">תרגיל-קליטת-הון · אירוע-הכסף הנמדד</b>
                {dex.intake.drillWave1?.result?.verdict && (
                  <StatusBadge tone={dex.intake.drillWave1.result.verdict === 'DRILL-OK' ? 'emerald' : 'rose'}>{dex.intake.drillWave1.result.verdict}</StatusBadge>
                )}
              </div>
              <RailRow
                label="המרות-נעולות · סה״כ נוחת · גל-הבא"
                value={`${dex.intake.converts?.landing?.totalSbd != null ? n3(dex.intake.converts.landing.totalSbd) : '—'} SBD · ${(dex.intake.converts?.landing?.nextAt ?? '—').slice(0, 16).replace('T', ' ')}`}
                ltr
              />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(dex.intake.converts?.landing?.waves ?? []).map((w) => (
                  <span key={w.day} className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300" dir="ltr">
                    {w.day}: {w.sbd.toFixed(3)} SBD · {w.windowUtc} UTC{w.within24h ? ' · ≤24h' : ''}
                  </span>
                ))}
              </div>
              {dex.intake.drillWave1?.result && (
                <RailRow
                  label="תרגיל-יבש (גל-ראשון) · בריכה-אחרי · אסק-ראשה · כיסוי-נבוא SBD"
                  value={`${n3(dex.intake.drillWave1.result.post?.poolA ?? null)}/${n3(dex.intake.drillWave1.result.post?.poolB ?? null)} · ${dex.intake.drillWave1.result.post?.askTop ? `${n3(dex.intake.drillWave1.result.post.askTop.qty)}@${n6(dex.intake.drillWave1.result.post.askTop.price)}` : '—'} · ${n3(dex.intake.drillWave1.result.escrowProjected?.coveredSbd ?? null)}`}
                  ltr
                  className="mt-1"
                  tone="emerald"
                />
              )}
              <p className="mt-2 text-[10px] text-slate-600">הכסף נוחת → המנוע קורא יתרות-חי → הבריכה נפרשת-מחדש פאריטי-פרופורציונלית → הסריג נטען. התרגיל מוכיח את זה עכשיו, באפס-סיכון — חוקי-המסילה החיים בדיוק (bid נדחה תחת PAUSE-FLOW גם כאן).</p>
            </div>
          )}

          {/* inbound router map (T-75d) — receive & swap on every network, honest */}
          {dex.intake?.routerMap && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                <Route className="h-3.5 w-3.5 text-amber-300" aria-hidden />
                <b className="text-slate-200">מפת-ראוטרים-נכנסים · כל-הרשתות</b>
              </div>
              <div className="space-y-1">
                {(dex.intake.routerMap.networks ?? []).flatMap((n) =>
                  n.assets.map((a) => (
                    <div key={`${n.chain}-${a.sym}`} className="flex items-start justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <b className="text-slate-300" dir="ltr">{a.sym}</b>
                        <span className="text-slate-600"> · {n.name}</span>
                        <p className="truncate text-[10px] text-slate-600" title={a.unlock ?? a.acceptWhy}>{a.swapToValue.verdict === 'SWAPABLE-NOW' ? 'ניתן-להחלפה-עכשיו' : a.swapToValue.verdict === 'GATED-PATH' ? 'מסילה-סגורה' : 'אין-נזילות-עדיין'} · {a.unlock ?? a.acceptWhy}</p>
                      </div>
                      <StatusBadge tone={a.accept === 'ACCEPT' ? 'emerald' : 'amber'}>{a.accept === 'ACCEPT' ? 'מתקבל' : 'ממתין-מנומק'}</StatusBadge>
                    </div>
                  ))
                )}
              </div>
              <p className="mt-2 text-[10px] text-slate-600">{dex.intake.routerMap.law ?? ''}</p>
            </div>
          )}

          {/* blurt escrow-OTC desk (T-75e) — the only market Blurt has, honest */}
          {dex.blurtOtc && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                <Store className="h-3.5 w-3.5 text-amber-300" aria-hidden />
                <b className="text-slate-200">דלפק-OTC ל-Blurt · השוק-היחיד שלו</b>
                {dex.blurtOtc.rail?.status && (
                  <StatusBadge tone={dex.blurtOtc.rail.status === 'ARMED' ? 'emerald' : dex.blurtOtc.rail.status === 'QUOTED-INTERNAL' ? 'emerald' : 'amber'}>
                    {dex.blurtOtc.rail.status}
                  </StatusBadge>
                )}
              </div>
              <RailRow
                label="מחיר-נמדד SBD/BLURT · מלאי-משכן · פריסת-דלפק"
                value={`${n6(dex.blurtOtc.rail?.price ?? null)} · ${n3(dex.blurtOtc.rail?.inventory ?? null)} · ${dex.blurtOtc.plan?.verdict ?? '—'}`}
                ltr
              />
              {dex.blurtOtc.plan?.verdict === 'OTC-QUOTED' && (
                <RailRow
                  label="דו-צדדי · אסקים/בידים (≤ משכן / ≤ כספת)"
                  value={`${dex.blurtOtc.plan.asks?.length ?? 0} / ${dex.blurtOtc.plan.bids?.length ?? 0} · מרווח ${Math.round(dex.blurtOtc.plan.spreadBps ?? 0)}bps`}
                  ltr
                  className="mt-1"
                />
              )}
              <p className="mt-1 truncate text-[10px] text-slate-600" title={dex.blurtOtc.rail?.unlock ?? dex.blurtOtc.plan?.why}>
                {dex.blurtOtc.rail?.unlock ?? dex.blurtOtc.plan?.why ?? ''}
              </p>
              <p className="mt-1 text-[10px] text-slate-600">ל-Blurt אין שוק-פנימי כלל (נמדד) — הרשת יכולה להיות השוק-היחיד שלו, ביושר: אסק ≤ משכן-BLURT · ביד ≤ כספת-SBD · אספקה = transfer-BLURT אמיתי מהמשכן.</p>
            </div>
          )}

          {/* HE pond calibration (T-75e) — thin wrapped books never lie silently */}
          {dex.heCalibration && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                <Gauge className="h-3.5 w-3.5 text-slate-300" aria-hidden />
                <b className="text-slate-200">כיול-הבריכות-העטופות · Hive-Engine</b>
                {dex.heCalibration.verdict && (
                  <StatusBadge tone={dex.heCalibration.verdict === 'ALL-CALIBRATED' ? 'emerald' : dex.heCalibration.verdict === 'DRIFT-DETECTED' ? 'amber' : 'slate'}>
                    {dex.heCalibration.verdict}
                  </StatusBadge>
                )}
              </div>
              <div className="space-y-1">
                {(dex.heCalibration.rows ?? []).slice(0, 6).map((r) => (
                  <div key={r.sym} className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="min-w-0">
                      <b className="text-slate-300" dir="ltr">{r.sym}</b>
                      <span className="tnum text-slate-500" dir="ltr">
                        {r.impliedUsd != null ? ` · implied $${r.impliedUsd < 1 ? r.impliedUsd.toFixed(6) : r.impliedUsd.toFixed(2)}` : ''}
                        {r.anchorUsd != null ? ` vs $${r.anchorUsd < 1 ? r.anchorUsd.toFixed(6) : r.anchorUsd.toFixed(2)}` : ''}
                      </span>
                    </div>
                    <StatusBadge tone={r.verdict === 'CALIBRATED' ? 'emerald' : r.verdict === 'DRIFTED' ? 'amber' : 'slate'}>
                      {r.driftBps != null ? `${r.driftBps > 0 ? '+' : ''}${Math.round(r.driftBps)}bps` : r.verdict}
                    </StatusBadge>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-slate-600">מחיר-מרומז-מהספר (SWAP.HIVE→HIVE→USD) מול-עוגן-דולר בלתי-תלוי — סטייה-מעבר-לרצועה מוקלדת: ספרים-דקים לא משקרים בשקט (T-75-r §8 → חוק-חי).</p>
            </div>
          )}

          {/* arb web */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <ArrowLeftRight className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
              <b className="text-slate-200">רשת-הארביטראז לסוכנים וחיילים</b>
              <span className="text-slate-600">· {venues.length} מקומות-שוק</span>
              {(dex.arb?.quarantined ?? []).length > 0 && (
                <StatusBadge tone="amber">הסגר-סטייה: {(dex.arb.quarantined ?? []).length}</StatusBadge>
              )}
            </div>
            {/* T-75f venue chips — measured/oracle/quarantined at a glance */}
            <div className="mb-2 flex flex-wrap gap-1">
              {venues.slice(0, 12).map((v) => {
                const quarantined = String(v.status ?? '').startsWith('quarantined')
                const oracle = v.id.startsWith('oracle-')
                return (
                  <span
                    key={v.id}
                    dir="ltr"
                    title={`${v.source ?? ''}${v.driftBps != null ? ` · drift ${v.driftBps}bps` : ''}`}
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      quarantined
                        ? 'border-amber-700/60 bg-amber-950/40 text-amber-300'
                        : oracle
                          ? 'border-slate-700 bg-slate-800/40 text-slate-400'
                          : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
                    }`}
                  >
                    {quarantined ? '⛔ ' : oracle ? '◈ ' : '● '}{v.id}
                  </span>
                )
              })}
            </div>
            {opps.length === 0 && <p className="text-[11px] text-slate-500">אין-קצוות מעל הסף — המקומות עקביים (אמת, לא פנטומים).</p>}
            <p className="text-[10px] text-slate-600">חוק-18 (T-75g): הקצה נמדד על-המגע — קנייה ב-bestAsk, מכירה ב-bestBid; אורקל הוא ערך-הוגן, לא מקום-מילוי (אות-בלבד). חוק-19 (T-75h): הקצה גדול כמו-העומק-שהוא נוגע — עד-חצי-מהעומק-הנמדד, ובריכה עד-10% מהיתרה-הרלוונטית; אין-עומק-נמדד → אין-גודל (לא מנוחש). חוק-20 (T-75i): התביעה נאכפת — כוונה על-זוג-קצה שגודלה חורג מהתקרה-הנמדדה נדחית בהחזרה (board→settlement), ועומק-לא-נמדד → אין-גודל-לכל-כוונה.</p>
            <div className="space-y-1">
              {opps.slice(0, 4).map((o, i) => (
                <RailRow
                  key={i}
                  label={`${o.pair} · ${o.kind === 'SIGNAL' ? `אות: ${o.buy} ⇄ ${o.sell}` : `קנייה ב-${o.buy} → מכירה ב-${o.sell}`}${o.touch ? ` @${fmtTouch(o.touch.buyAt)}→${fmtTouch(o.touch.sellAt)}` : ''}`}
                  value={`${o.edgeBps > 0 ? '+' : ''}${Math.round(o.edgeBps)}bps · ${o.kind === 'SIGNAL' ? 'לא-מימוש' : o.verdict === 'EDGE-AFTER-FEES' ? 'מימוש' : 'מתחת-עמלות'}${o.impact ? ' · השפעת-בריכה-בביצוע' : ''}${o.kind === 'TRADEABLE' ? (o.depthVerdict === 'CAPPED' ? ` · עד-עומק ${fmtTouch(o.maxNotional)}` : o.depthVerdict === 'DEPTH-UNKNOWN' ? ' · עומק-לא-נמדד' : '') : ''}`}
                  ltr
                  tone={o.kind === 'TRADEABLE' ? (o.verdict === 'EDGE-AFTER-FEES' ? 'emerald' : 'amber') : 'slate'}
                />
              ))}
            </div>
            {(dex.arb?.quarantined ?? []).length > 0 && (
              <p className="mt-2 text-[10px] text-amber-400/80">
                משמר-הסטייה (חוק-17): בריכה שה-mid שלה שקוע מעבר לרצועה מעוגן-דולר בלתי-תלוי נכנסת להסגר — mid שקוע אינו מחיר-מילוי, ואין-קצה-פנטום מספר-דק ({(dex.arb.quarantined ?? []).join(', ')}).
              </p>
            )}
          </div>

          {/* rails */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <Coins className="h-3.5 w-3.5 text-slate-300" aria-hidden />
              <b className="text-slate-200">מסילות-ההחלפה</b>
            </div>
            <div className="space-y-1.5">
              {rails.map(([id, r]) => (
                <div key={id} className="flex items-start justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <b className="text-slate-300" dir="ltr">{id}</b>
                    <p className="text-[10px] text-slate-600">{r.unlock ?? r.note}</p>
                  </div>
                  <StatusBadge tone={railTone(r.cls)}>{r.status}</StatusBadge>
                </div>
              ))}
            </div>
          </div>

          {/* agents */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <Users className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
              <b className="text-slate-200">לוח-המובילים · סוכנים וחיילים</b>
            </div>
            {(dex.leaderboard ?? []).length === 0 && <p className="text-[11px] text-slate-500">אף סוכן עוד לא נרשם — POST /agent/register פתוח.</p>}
            <div className="space-y-1">
              {(dex.leaderboard ?? []).slice(0, 5).map((a) => (
                <RailRow key={a.id} label={`${a.id} (${a.kind})`} value={`עסקאות ${a.trades} · נפח ${n3(a.volumeIn)}`} ltr className="mt-1" />
              ))}
            </div>
          </div>

          {/* settlement proof */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              <b className="text-slate-200">תור-ההסדרה · כותב-יחיד = המנוע</b>
              {receipts?.verdict && <StatusBadge tone={receipts.verdict === 'DRAINED' ? 'emerald' : 'amber'}>{receipts.verdict}</StatusBadge>}
            </div>
            <RailRow label="בתור / נדחו-על-ידי-חוק" value={`${queued.length} / ${(receipts?.refuses ?? []).length}`} ltr />
            {(receipts?.results ?? []).slice(-2).map((r) => (
              <div key={r.id} className="mt-1 text-[10px] text-slate-500">
                txid <b dir="ltr" className="tnum text-slate-300">{r.txid?.slice(0, 18) ?? '—'}…</b> · {r.side} {r.qty} · orderid {r.orderid}
              </div>
            ))}
            <p className="mt-2 text-[10px] text-slate-600">כל-הזמנה עוברת חוקים כפולים: שער-ה-DEX (משכן/פאריטי/רצפת-עלות/שומר-זרימה) ואז אימות-מחדש-חי במנוע — ורק-אז חתימה אחת.</p>
          </div>

          {/* deposits custody + credit liquefaction */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <Coins className="h-3.5 w-3.5 text-slate-300" aria-hidden />
              <b className="text-slate-200">הפקדות-אמת · הנזלת-CREDIT</b>
            </div>
            <RailRow label="הפקדות-מאומתות / ממתינות-סירוב-מנומק" value={`${dex.deposits?.credits?.length ?? 0} / ${dex.deposits?.pending?.length ?? 0}`} ltr />
            <p className="mt-1 text-[10px] text-slate-600">הפקדה: העברה-אמיתית ל-headcorner בממוא <b dir="ltr">dex-deposit:&lt;agent-id&gt;</b> — נקלטת רק-במטבע שמסילת-היציאה שלו חמושה (אין-נעילה-כוזבת).</p>
            <RailRow label="אספקת-CREDIT · פאית $0.01 · המרה-מינימלית" value={`${n3(dex.credit?.supply ?? null)} · ${dex.credit?.minRedeem ?? 100}`} ltr className="mt-1" />
            <p className="mt-1 text-[10px] text-slate-600">{dex.credit?.redemptionLaw ?? ''} — המטבע-הדמה ניתן-להמרה באמת: עמלות-אמת נכנסות-לכספת, וממנה-בלבד מושכים למטבע-האמיתי בפאריטי-נמדד.</p>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
