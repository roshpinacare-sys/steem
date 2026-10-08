'use client'

import { Banknote, Recycle } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { RailRow } from './RailRow'
import { StatusBadge } from './StatusBadge'
import { HonestyBadge } from './HonestyBadge'
import type { Status } from './types'
import type { Tone } from './tones'

const usd = (v?: number | null) => (typeof v === 'number' ? `$${v.toFixed(4)}/יום` : '-')

/**
 * T-91b · דוקטרינת הצבה-מחדש: חסימת-תצוגה בתוך כרטיס הכלכלה.
 * מציגה את היחסים הקבועים (ספר-קנייה / power-up / עתודה), את הרצפות,
 * את חוק-הקצב, את פסק-התוכנית החי ואת החוק. המנוע מחשב, כאן רק מציגים.
 */
function RedeployDoctrine({ rd }: { rd: NonNullable<Status['economics']>['redeployDoctrine'] }) {
  if (!rd) return null
  const bb = rd.ratios?.buyBookPct ?? null
  const pu = rd.ratios?.powerUpPct ?? null
  const rs = rd.ratios?.reservePct ?? null
  const planVerdict = rd.plan?.verdict ?? null
  const verdictTone: Tone =
    planVerdict === 'REDEPLOY-PLAN' ? 'emerald'
    : planVerdict === 'REDEPLOY-COOLDOWN' ? 'amber'
    : planVerdict === 'REDEPLOY-BLOCKED' ? 'rose'
    : 'slate'
  const verdictLabel =
    planVerdict === 'REDEPLOY-PLAN' ? 'תוכנית-חיה'
    : planVerdict === 'REDEPLOY-COOLDOWN' ? 'בקצב-המתנה'
    : planVerdict === 'REDEPLOY-BLOCKED' ? 'חסום'
    : planVerdict === 'REDEPLOY-HOLD' ? 'מחזיק (מתחת לרצפות)'
    : '-'
  const pct = (v?: number | null) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '-')
  const segments = [
    { key: 'buy', label: 'ספר-קנייה', v: bb, cls: 'bg-emerald-500/80' },
    { key: 'pu', label: 'power-up', v: pu, cls: 'bg-amber-500/80' },
    { key: 'rs', label: 'עתודה', v: rs, cls: 'bg-slate-600/80' },
  ].filter((s) => typeof s.v === 'number' && s.v > 0) as { key: string; label: string; v: number; cls: string }[]

  return (
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-extrabold text-slate-100">
          <Recycle className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          דוקטרינת הצבה-מחדש · T-91
          <StatusBadge tone={verdictTone}>{verdictLabel}</StatusBadge>
        </span>
        <span className="text-[10px] text-slate-500">
          ביצוע {rd.executionArmed ? <b className="text-emerald-400">חמוש</b> : <b className="text-slate-400">מושהה</b>}
          {typeof rd.plan?.powerUpSteem === 'number' && rd.plan.powerUpSteem > 0 && (
            <> · power-up הבא: <b className="tnum text-amber-300" dir="ltr">{rd.plan.powerUpSteem.toFixed(3)} STEEM</b></>
          )}
        </span>
      </div>

      {/* ratio bar: the fixed shares, one glance */}
      <div className="mt-2 overflow-hidden rounded-md border border-slate-800" role="img" aria-label={`יחסי הצבה-מחדש: ספר-קנייה ${pct(bb)}, power-up ${pct(pu)}, עתודה ${pct(rs)}`}>
        <div className="flex h-4 w-full">
          {segments.map((s) => (
            <div key={s.key} className={`${s.cls} flex items-center justify-center`} style={{ width: `${s.v * 100}%` }}>
              <span className="text-[9px] font-bold text-slate-950/90">{Math.round(s.v * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${s.cls}`} aria-hidden />
            {s.label} · {pct(s.v)}
          </span>
        ))}
      </div>

      <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        רצפות-הפעלה (העתודה-המבצעית):{' '}
        <b className="tnum text-slate-300" dir="ltr">{rd.floors?.liquidSteemFloor ?? '-'} STEEM</b> ·{' '}
        <b className="tnum text-slate-300" dir="ltr">{rd.floors?.liquidSbdFloor ?? '-'} SBD</b>
        {' '}· קצב: ≤1 power-up/שעה, ≤{rd.maxPerDay ?? '-'}/יום
        {typeof rd.state?.powerUpsToday === 'number' && <> · היום: {rd.state.powerUpsToday}</>}
      </div>
      {rd.law && <p className="mt-1 text-[10px] leading-relaxed text-slate-600">{rd.law}</p>}
    </div>
  )
}

/**
 * T-21d · כלכלה · כל-המסילות: NEW optional card from status.economics.
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
                      {r.measuredUsdPerDay == null && r.estUsdPerDay == null && <span className="text-slate-500">-</span>}
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

      <RedeployDoctrine rd={economics.redeployDoctrine} />
    </SectionCard>
  )
}
