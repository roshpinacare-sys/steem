'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Sprout, RefreshCw } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Tone } from './tones'

type Row = Record<string, unknown>
type LeversPayload = {
  probe?: { state?: string; ageMin?: number | null; at?: string | null } | null
  headcorner?: {
    effectiveSp?: number | null
    ownSp?: number | null
    delegatedOutSp?: number | null
    recallsBackSinceR289?: number | null
    vpEffPct?: number | null
    liquidSteem?: number | null
    liquidSbd?: number | null
    curation?: { ops?: number | null; sp?: number | null; perDay?: number | null } | null
    aprPct?: number | null
    claimsWindowSp?: number | null
    measuredWindowDays?: number | null
    historyOps?: number | null
  } | null
  army?: {
    totals?: { effectiveSp?: number | null; vpAvgPct?: number | null } | null
    rail?: {
      state?: string | null
      ageMin?: number | null
      day?: string | null
      verdict?: string | null
      totalVotes?: number | null
      accounts?: { account?: string; verdict?: string | null; votes?: number | null; vpEff?: number | null }[] | null
    } | null
  } | null
  feed?: { steemUsd?: number | null; sbdPremiumPct?: number | null; arbNote?: string | null } | null
  otherChains?: {
    hive?: { ok?: boolean; totals?: Row | null } | null
    blurt?: { ok?: boolean; totals?: Row | null } | null
  } | null
  levers?: {
    id?: string | null
    state?: string | null
    measuredSpPerDay?: number | null
    measuredUsdPerDay?: number | null
    projectedSpPerDay?: number | null
    projectedUsdPerDay?: number | null
    aprPct?: number | null
    note?: string | null
  }[] | null
  receipts?: { at?: string; account?: string; author?: string; permlink?: string; weight?: number }[] | null
}

const n3 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(3) : '-')
const n1 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(1) : '-')
const weightPctLabel = (w?: number | null) => (typeof w === 'number' ? (w / 100).toFixed(2) : '?')

function leverTone(state?: string | null): Tone {
  if (!state) return 'slate'
  if (state === 'LIVE' || state === 'ACTIVE-OPPORTUNITY' || state === 'R290-NEW' || state === 'CAPITAL-READY') return 'emerald'
  if (state === 'LIVE-THIN' || state === 'DORMANT' || state === 'STRUCTURAL') return 'amber'
  return 'rose' /* MARKET-DEAD, DUST-ONLY */
}

/**
 * R290 · YIELD MAXIMIZER — the lever matrix, measured live from the chains.
 * Answers the operator's question with chain truth instead of promises:
 * where every dollar CAN come from, what is already flowing, what is dust.
 */
export function YieldLeversCard() {
  const [data, setData] = useState<LeversPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/saos/yield-levers', { cache: 'no-store' })
      const j = (await r.json()) as LeversPayload & { ok?: boolean; error?: string }
      if (j.ok) { setData(j); setError(null) } else setError(j.error ?? 'read failed')
    } catch (e) {
      setError(String((e as Error)?.message ?? e).slice(0, 120))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, 120_000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load])

  const hc = data?.headcorner
  const army = data?.army
  const levers = data?.levers ?? []

  return (
    <SectionCard
      icon={Sprout}
      tone="amber"
      className="md:col-span-2"
      title={<>מקסום-תשואה · מטריצת-המנופים <span dir="ltr" className="text-slate-500">(R290)</span></>}
      actions={
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 disabled:opacity-50"
          aria-label="רענון מדידת-המנופים"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          מדידה
        </button>
      }
      meta="כל מנוף-הכנסה שנמדד-חי מהשרשרת. המקור: yieldmax probe (אפס-מפתחות, אפס-אמון). מה שהשרשרת לא מוכיחה — לא נאמר כאן."
    >
      {!data && !error && <p className="text-xs text-slate-500">טוען מדידת-מנופים…</p>}
      {error && <p className="text-xs text-rose-400">שגיאת-קריאה: {error}</p>}

      {data && (
        <div className="space-y-3">
          {/* measured core: headcorner */}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-xs font-extrabold text-slate-100">headcorner · המדידה-החיה</span>
              <StatusBadge tone={data.probe?.state === 'LIVE' ? 'emerald' : 'amber'}>
                {data.probe?.state === 'LIVE' ? `חי · ${Math.round(data.probe.ageMin ?? 0)} דק` : 'מיושן'}
              </StatusBadge>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
              <span className="text-slate-500">SP אפקטיבי: <b className="tnum text-slate-200" dir="ltr">{n1(hc?.effectiveSp)}</b></span>
              <span className="text-slate-500">VP: <b className="tnum text-slate-200" dir="ltr">{n1(hc?.vpEffPct)}%</b></span>
              <span className="text-slate-500">קיורציה: <b className="tnum text-emerald-400" dir="ltr">{n3(hc?.curation?.perDay)} SP/יום</b></span>
              <span className="text-slate-500">APR: <b className="tnum text-emerald-400" dir="ltr">{n1(hc?.aprPct)}%</b></span>
              <span className="text-slate-500">חלון-מדידה: <b className="tnum text-slate-300" dir="ltr">{n1(hc?.measuredWindowDays)} ימים</b></span>
              <span className="text-slate-500">recall-חזרות: <b className="tnum text-amber-300" dir="ltr">{n1(hc?.recallsBackSinceR289)} SP</b></span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              SP עצמי {n1(hc?.ownSp)} · מואצל-החוצה {n1(hc?.delegatedOutSp)} (~2462 SP צפויים-לחזור עד 10-11 = ×3 כוח-הצבעה) · נוזלים {n3(hc?.liquidSteem)} STEEM + {n3(hc?.liquidSbd)} SBD
            </p>
          </div>

          {/* army rail */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-xs font-extrabold text-slate-100">קיורציית-הצבא · המכפיל-המבני (R290-חדש)</span>
              <StatusBadge tone={army?.rail?.state === 'LIVE' ? 'emerald' : army?.rail?.state === 'STALE' ? 'amber' : 'slate'}>
                {army?.rail?.state === 'LIVE' ? 'חי' : army?.rail?.state === 'STALE' ? 'מיושן' : 'טרם-רץ'}
              </StatusBadge>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              10 חשבונות · Σ <b className="tnum" dir="ltr">{n1(army?.totals?.effectiveSp)} SP</b> · VP ממוצע{' '}
              <b className="tnum" dir="ltr">{n1(army?.totals?.vpAvgPct)}%</b> · חוק: תוכן-חוץ-עולה בלבד (17-רוסטר נשלל), ≤12 הצבעות/יום/חשבון, תקציב-VP &lt; 20% רגנרציה
            </p>
            {army?.rail?.accounts && army.rail.accounts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1" role="list" aria-label="פסקי-חשבונות-הצבא">
                {army.rail.accounts.map((a, i) => (
                  <span key={`${a.account}-${i}`} role="listitem" className="rounded border border-slate-700 bg-slate-950/50 px-1.5 py-0.5 text-[9px] text-slate-400">
                    {a.account}: <b className={a.verdict === 'VOTED' ? 'text-emerald-400' : a.verdict === 'VP-FLOOR' ? 'text-amber-400' : 'text-slate-500'}>{a.verdict}</b>
                  </span>
                ))}
              </div>
            )}
            {data.receipts && data.receipts.length > 0 && (
              <p className="mt-1 text-[10px] text-slate-600">
                אחרונות: {data.receipts.slice(0, 3).map((r) => `${r.account}→${String(r.author).slice(0, 12)} (${weightPctLabel(r.weight)}%)`).join(' · ')}
              </p>
            )}
          </div>

          {/* lever matrix */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">מטריצת-המנופים (נמדד-חי)</p>
            {levers.map((l, i) => (
              <div key={`${l.id}-${i}`} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-xs font-bold text-slate-200" dir="ltr">{l.id}</span>
                  <StatusBadge tone={leverTone(l.state)}>{l.state}</StatusBadge>
                </div>
                {(l.measuredSpPerDay != null || l.measuredUsdPerDay != null || l.projectedSpPerDay != null || l.aprPct != null) && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px]">
                    {l.measuredSpPerDay != null && <span className="text-emerald-400" dir="ltr">{n3(l.measuredSpPerDay)} SP/day</span>}
                    {l.measuredUsdPerDay != null && <span className="text-emerald-400" dir="ltr">${n3(l.measuredUsdPerDay)}/day</span>}
                    {l.projectedSpPerDay != null && <span className="text-amber-400" dir="ltr">~{n3(l.projectedSpPerDay)} SP/day</span>}
                    {l.aprPct != null && <span className="text-slate-400" dir="ltr">APR {n1(l.aprPct)}%</span>}
                  </div>
                )}
                {l.note && <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600" dir="auto">{l.note}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
            <b className="text-slate-300">כנות-כלכלית:</b> עלה-ה-feed {n3(data.feed?.steemUsd)}$ · SBD נעול בטווח ({n1(data.feed?.sbdPremiumPct)}%) — אין-קצה-ארביטרז' היום · Hive/Blurt מדודים דָּשׁ (0 HP / 0 HBD) — משטחי-פרסום בלבד · שוק-ההאצלות לא-נגיש — הקיורציה היא נתיב-התשואה היחיד ל-SP.
            {data.probe?.at && <> · מדידה: <span dir="ltr">{data.probe.at.slice(0, 16).replace('T', ' ')}</span></>}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
