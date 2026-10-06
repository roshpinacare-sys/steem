'use client'

import { Banknote } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { RailRow } from './RailRow'
import { StatusBadge } from './StatusBadge'
import { HonestyBadge } from './HonestyBadge'
import type { Status } from './types'
import type { Tone } from './tones'

const usd = (v?: number | null) => (typeof v === 'number' ? `$${v.toFixed(4)}/יום` : '—')

/**
 * T-21d · כלכלה · כל-המסילות — NEW optional card from status.economics.
 * Renders ONLY when the engine provides the section (defensive ?. everywhere).
 * Confidence law: measured = solid emerald · estimated = amber + מוערך · blocked = rose.
 */
export function EconomicsRailsCard({ economics }: { economics: Status['economics'] }) {
  if (!economics) return null
  const rails = economics.rails ?? []
  const hasTotals = economics.totalMeasuredUsdPerDay != null || economics.totalEstUsdPerDay != null
  if (rails.length === 0 && !hasTotals) return null

  const confidenceTone = (c?: string): Tone => (c === 'measured' ? 'emerald' : c === 'estimated' ? 'amber' : c === 'blocked' ? 'rose' : 'slate')

  return (
    <SectionCard
      icon={Banknote}
      tone="emerald"
      className="md:col-span-2 lg:col-span-3"
      title={<>כלכלה · כל-המסילות</>}
      actions={economics.asof ? <span className="tnum text-[10px] text-slate-500" dir="ltr">{economics.asof.slice(0, 16).replace('T', ' ')}</span> : undefined}
      meta="כל מסילת-הכנסה במקום-הזה, עם דרגת-ראיה: מדוד > מוערך > חסום. לעולם לא מבטיחים מה שהשרשרת לא מוכיחה."
    >
      {rails.length === 0 ? (
        <p className="text-xs text-slate-500">אין-מסילות בדוח הנוכחי…</p>
      ) : (
        <div className="space-y-1.5">
          {rails.map((r, i) => {
            const tone = confidenceTone(r.confidence)
            const blocked = r.confidence === 'blocked'
            return (
              <div key={`${r.id ?? 'rail'}-${i}`} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                <RailRow
                  label={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-200">{r.label ?? r.id ?? 'מסילה'}</span>
                      {r.confidence === 'measured' && <HonestyBadge kind="measured" />}
                      {r.confidence === 'estimated' && <HonestyBadge kind="estimated" />}
                      {blocked && <StatusBadge tone="rose">חסום</StatusBadge>}
                    </span>
                  }
                  value={
                    <span className="flex items-baseline gap-2">
                      {r.measuredUsdPerDay != null && <span className="text-emerald-400">{usd(r.measuredUsdPerDay)}</span>}
                      {r.estUsdPerDay != null && (
                        <span className={r.measuredUsdPerDay != null ? 'text-xs text-amber-400' : 'text-amber-400'}>~{usd(r.estUsdPerDay)}</span>
                      )}
                      {r.measuredUsdPerDay == null && r.estUsdPerDay == null && <span className="text-slate-500">—</span>}
                    </span>
                  }
                  tone={tone}
                  strong={r.confidence === 'measured'}
                />
                {r.note && <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">{r.note}</p>}
              </div>
            )
          })}
        </div>
      )}

      {hasTotals && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <RailRow
            label={<span className="text-xs font-extrabold text-slate-100">סה"כ נמדד</span>}
            value={usd(economics.totalMeasuredUsdPerDay)}
            tone="emerald"
            strong
          />
          {economics.totalEstUsdPerDay != null && (
            <RailRow
              label={<span className="flex items-center gap-1.5 text-xs font-bold text-slate-300">סה"כ פוטנציאל-מוערך <HonestyBadge kind="estimated" /></span>}
              value={usd(economics.totalEstUsdPerDay)}
              tone="amber"
            />
          )}
        </div>
      )}
    </SectionCard>
  )
}
