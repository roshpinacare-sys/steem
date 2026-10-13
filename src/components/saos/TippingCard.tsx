'use client'

import { Gauge, ShieldAlert, Eye, PauseCircle } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'

/**
 * T-28 · הסנטינל — the tipping sentinel (emergence countermeasure), rendered
 * honestly. world.emergence.ai Season-1 measured "collapse has no warning
 * shot" — two of five worlds lost all agents. This card shows OUR warning
 * shot: leading indicators over a bounded measured window (fuel / cycle
 * health / capital / bleed slope) and the typed de-escalation posture the
 * machine itself adopts on CRITICAL. Tone law: STABLE/WARMUP → emerald/slate,
 * WARNING → amber, CRITICAL → rose. Zero blue/indigo.
 */

const VERDICT_TONE = { STABLE: 'emerald', WARMUP: 'slate', WARNING: 'amber', CRITICAL: 'rose' } as const

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-slate-500',
}

export function TippingCard({ tipping }: { tipping: Status['tipping'] }) {
  if (!tipping) return null
  const verdict = (tipping.verdict ?? 'WARMUP') as keyof typeof VERDICT_TONE
  const tone = VERDICT_TONE[verdict] ?? 'slate'
  const posture = tipping.posture ?? null
  const minimum = posture?.level === 'MINIMUM'
  const latest = tipping.latestSample ?? null

  return (
    <SectionCard
      icon={Gauge}
      tone={tone === 'slate' ? 'amber' : (tone as 'emerald' | 'amber' | 'rose')}
      className="md:col-span-2 lg:col-span-3"
      title={<>הסנטינל · יריית-האזהרה <span dir="ltr" className="text-slate-500">(T-28)</span></>}
      actions={
        <StatusBadge tone={tone === 'slate' ? 'amber' : (tone as 'emerald' | 'amber' | 'rose')} solid>
          {verdict === 'WARMUP' ? 'חימום · אוסף-ראיות' : verdict === 'STABLE' ? 'יציב' : verdict === 'WARNING' ? 'אזהרה' : 'קריטי'}
        </StatusBadge>
      }
      meta="מול FINDING-03 של emergence — לקריסה אין יריית-אזהרה. אצלנו יש: מגמות-מדודות בחלון-חסום, ופוסטור-מינימום אוטומטי על קריטי."
    >
      {/* the drivers — each carries its own evidence + bound */}
      <div className="space-y-1.5">
        {(tipping.drivers ?? []).length ? (
          (tipping.drivers ?? []).map((d, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[d.severity ?? 'info'] ?? 'bg-slate-500'}`} aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[11px] font-extrabold text-slate-200" dir="ltr">{d.id}</span>
                  <span className="text-[9px] font-bold uppercase text-slate-500" dir="ltr">{d.severity}</span>
                </div>
                <p className="tnum text-[11px] leading-relaxed text-slate-400" dir="ltr">
                  {d.evidence} <span className="text-slate-600">· bound {d.bound}</span>
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] leading-relaxed text-emerald-300" dir="rtl">
            אין דרייברים — אף מדד-מוביל לא חצה סף בחלון-המדידה ({tipping.samples ?? 0} דגימות).
          </p>
        )}
      </div>

      {/* the measured latest sample */}
      {latest && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
          {latest.rcPct != null && <span className="tnum" dir="ltr">fuel {latest.rcPct}% RC</span>}
          {latest.capitalUsd != null && <span className="tnum" dir="ltr">capital ${latest.capitalUsd}</span>}
          {latest.realizedSbdPerDay != null && <span className="tnum" dir="ltr">realized {latest.realizedSbdPerDay} SBD/day</span>}
          <span className="tnum" dir="ltr">{tipping.samples ?? 0} samples</span>
        </div>
      )}

      {/* the posture — what the machine does about it */}
      <div className={`rounded-lg border px-3 py-2.5 ${minimum ? 'border-rose-500/30 bg-rose-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-slate-300" dir="rtl">
            {minimum ? <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden /> : <Eye className="h-3.5 w-3.5 text-slate-400" aria-hidden />}
            פוסטור: {minimum ? 'מינימום-קיום' : 'מלא'}
          </span>
          <StatusBadge tone={minimum ? 'rose' : 'emerald'}>{minimum ? 'מסילות-הוצאה עצורות' : 'כל-המסילות פועלות'}</StatusBadge>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400" dir="rtl">{posture?.why}</p>
        {minimum && (posture?.stops ?? []).length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <PauseCircle className="h-3 w-3 text-rose-400" aria-hidden />
            {(posture?.stops ?? []).map((s) => (
              <span key={s} className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[9px] text-rose-300" dir="ltr">{s}</span>
            ))}
          </div>
        )}
      </div>

      {tipping.law && <p className="text-[10px] leading-relaxed text-slate-500">{tipping.law}</p>}
    </SectionCard>
  )
}
