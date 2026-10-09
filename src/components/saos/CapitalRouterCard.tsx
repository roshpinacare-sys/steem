'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Route, RefreshCw } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Tone } from './tones'

type Row = Record<string, unknown>
type RouterPayload = {
  router?: { state?: string; ageMin?: number | null; verdict?: string | null; at?: string | null } | null
  probe?: { state?: string; ageMin?: number | null } | null
  capital?: {
    headcornerEffectiveSp?: number | null
    armyEffectiveSp?: number | null
    fleetEffectiveSp?: number | null
    delegatedOutSp?: number | null
    unclaimedSp?: number | null
    unclaimedSbd?: number | null
    unclaimedSteem?: number | null
  } | null
  ladder?: {
    id?: string | null
    label?: string | null
    spPerDay?: number | null
    usdPerDay?: number | null
    multiplierVsToday?: number | null
    note?: string | null
  }[] | null
  compoundAprPct?: number | null
  armyDailySp?: number | null
  actions?: {
    id?: string | null
    class?: string | null
    note?: string | null
    expectedSpPerDay?: number | null
    executed?: string | null
  }[] | null
  receipts?: { at?: string; verdict?: string; ladderTop?: number | null }[] | null
  law?: string | null
} | null

const n3 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(3) : '-')
const n2 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(2) : '-')

function classTone(cls?: string | null): Tone {
  if (cls === 'execute-now') return 'emerald'
  if (cls === 'schedule' || cls === 'law' || cls === 'gated') return 'amber'
  return 'slate' /* dormant-lane — measured-dead honesty */
}

/**
 * R292 · CAPITAL ROUTER — the profit-maximization + routing matrix.
 * Answers the operator's order ("maximize profitability across ALL our
 * actions with correct routing between one and another") with the measured
 * yield ladder (today → landing → tags → fleet) and the ranked action list.
 * Every number is derived from the chain-sourced deep probe; dead lanes are
 * shown dead; the recall executor is zero-amount pure-recall only.
 */
export function CapitalRouterCard() {
  const [data, setData] = useState<RouterPayload>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/saos/capital-route', { cache: 'no-store' })
      const j = (await r.json()) as RouterPayload & { ok?: boolean; error?: string }
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

  const ladder = data?.ladder ?? []
  const actions = data?.actions ?? []
  const final = ladder[ladder.length - 1]

  return (
    <SectionCard
      icon={Route}
      tone="amber"
      className="md:col-span-2"
      title={<>נתב-ההון · מדרגת-התשואה והפעולות <span dir="ltr" className="text-slate-500">(R292)</span></>}
      actions={
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 disabled:opacity-50"
          aria-label="רענון נתב-ההון"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          ניתוב
        </button>
      }
      meta="מדרגת-התשואה נמדדת מהשרשרת: היום → נחיתת-ההחזרות → הזזת-תקציב-לתגיות-המרוויחות → הצבא. מה שמת — כתוב-מת. אין הבטחות — יש מכפילים."
    >
      {!data && !error && <p className="text-xs text-slate-500">טוען נתב-הון…</p>}
      {error && <p className="text-xs text-rose-400">שגיאת-קריאה: {error}</p>}

      {data && (
        <div className="space-y-3">
          {/* the ladder */}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-xs font-extrabold text-slate-100">מדרגת-התשואה · קיורציית-headcorner</span>
              <StatusBadge tone={data.router?.state === 'LIVE' ? 'emerald' : 'amber'}>
                {data.router?.state === 'LIVE' ? `חי · ${Math.round(data.router.ageMin ?? 0)} דק` : 'מיושן'}
              </StatusBadge>
            </div>
            <ol className="mt-1.5 space-y-1" aria-label="מדרגת-התשואה">
              {ladder.map((s, i) => (
                <li key={`${s.id}-${i}`} className="flex flex-wrap items-center justify-between gap-x-2 rounded border border-slate-800 bg-slate-950/50 px-2 py-1 text-[11px]">
                  <span className="text-slate-300">
                    <b className="text-slate-100" dir="ltr">{s.label}</b>
                    {s.note && <span className="ms-1 text-[9px] text-slate-600" dir="auto">— {s.note}</span>}
                  </span>
                  <span className="tnum whitespace-nowrap text-slate-400" dir="ltr">
                    <b className="text-emerald-400">{n3(s.spPerDay)}</b> SP/יום · ${n3(s.usdPerDay)} · ×{n2(s.multiplierVsToday)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              צבירה-עצמית: הקיורציה מתיישבת VESTS → הסוללה עצמה גדלה · APR-מורכב מדוד{' '}
              <b className="tnum text-emerald-400" dir="ltr">{n2(data.compoundAprPct)}%</b> · הצבא מוסיף{' '}
              <b className="tnum text-amber-300" dir="ltr">{n3(data.armyDailySp)}</b> SP/יום (slots×SP, תקציב-רגנרציה)
            </p>
          </div>

          {/* capital map */}
          {data.capital && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-[11px] sm:grid-cols-4">
              <span className="text-slate-500">HC אפקטיבי: <b className="tnum text-slate-200" dir="ltr">{n2(data.capital.headcornerEffectiveSp)}</b></span>
              <span className="text-slate-500">צבא: <b className="tnum text-slate-200" dir="ltr">{n2(data.capital.armyEffectiveSp)}</b></span>
              <span className="text-slate-500">צי-כולל: <b className="tnum text-emerald-400" dir="ltr">{n2(data.capital.fleetEffectiveSp)}</b></span>
              <span className="text-slate-500">בדרך-חזרה: <b className="tnum text-amber-300" dir="ltr">{n2(data.capital.delegatedOutSp)}</b> SP</span>
              <span className="text-slate-500">לא-נתבע: <b className="tnum text-slate-300" dir="ltr">{n3(data.capital.unclaimedSp)}</b> SP + {n3(data.capital.unclaimedSbd)} SBD</span>
            </div>
          )}

          {/* ranked actions */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">מטריצת-הפעולות (מדורג)</p>
            {actions.map((a, i) => (
              <div key={`${a.id}-${i}`} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-xs font-bold text-slate-200" dir="ltr">{a.id}</span>
                  <span className="flex items-center gap-1">
                    {a.executed === 'ACKED' && <StatusBadge tone="emerald">בוצע</StatusBadge>}
                    <StatusBadge tone={classTone(a.class)}>{a.class}</StatusBadge>
                  </span>
                </div>
                {typeof a.expectedSpPerDay === 'number' && a.expectedSpPerDay > 0 && (
                  <p className="mt-0.5 text-[10px] text-emerald-400" dir="ltr">+{n3(a.expectedSpPerDay)} SP/day</p>
                )}
                {a.note && <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600" dir="auto">{a.note}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
            <b className="text-slate-300">חוק-הנתב:</b> slots×SP הוא חוק-התשואה (חלוקת-הון בין-חשבונות ניטרלית-בתשואה בניצולת-מלאה — הניתוב-האמיתי הוא ניצולת-סלוטים × איכות-מועמדים) · רגנרציה 20%/יום תוחמת-את-השריפה · נחיתת-ה-2463 SP מזוהה-לא-מונחת · פעולות-ההחזרה הן אפס-כמות טהור (מבנית-בלתי-אפשרי ליצור-חשיפה).
            {data.router?.at && <> · חושב: <span dir="ltr">{data.router.at.slice(0, 16).replace('T', ' ')}</span></>}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
