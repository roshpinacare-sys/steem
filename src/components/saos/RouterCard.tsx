'use client'

import { Route, ShieldAlert, TrendingUp } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-25 · נתב-הבריכות — the pool router (from status.router).
 * The engine weights every venue by its evidence class (measured full,
 * estimated half, blocked zero) and NAMES the binding constraint.
 * This card only renders the truth: headline = the binding verdict,
 * the venue table, and the maker-guard line when it paused the flow tranche.
 * Tone law: binding CAPITAL → amber (an honest constraint, not an error);
 * OFFER-CAN-CLOSE → emerald; COLD-START → rose. Zero blue/indigo/teal/violet.
 */

const bindingTone = (b?: string | null): Tone =>
  b === 'OFFER-CAN-CLOSE' ? 'emerald' : b === 'COLD-START' ? 'rose' : b ? 'amber' : 'slate'

const classTone = (c?: string | null): Tone =>
  c === 'measured' ? 'emerald' : c === 'estimated' ? 'amber' : 'rose'

const classLabel = (c?: string | null): string =>
  c === 'measured' ? 'מדוד' : c === 'estimated' ? 'מוערך' : 'חסום'

const usd = (v?: number | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '' : '−'}$${Math.abs(v).toFixed(3)}` : '—'

export function RouterCard({ router }: { router: Status['router'] }) {
  if (!router) return null

  const venues = router.venues ?? []
  const guard = router.makerGuard ?? null
  const binding = router.binding ?? null

  return (
    <SectionCard
      icon={Route}
      tone={bindingTone(binding)}
      className="md:col-span-2 lg:col-span-3"
      title={<>נתב-הבריכות · ניתוב-מדוד <span dir="ltr" className="text-slate-500">(T-25)</span></>}
      actions={
        binding ? (
          <StatusBadge tone={bindingTone(binding)} solid title={binding}>
            {binding === 'CAPITAL' ? 'חסם-הון' : binding === 'OFFER-CAN-CLOSE' ? 'ההצעה סוגרת' : binding === 'COLD-START' ? 'קר-התחלה' : binding}
          </StatusBadge>
        ) : null
      }
      meta="משקולת-אמת: מדוד → משקל מלא · מוערך → חצי · חסום → אפס. החסם-הכובל נאמר בקול — לא מובטח, לא מקושט."
    >
      {/* headline: the constraint, spoken */}
      {router.verdictNote && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold text-slate-300">החסם-הכובל</span>
            <span className="tnum text-[10px] text-slate-500" dir="ltr">
              effective {usd(router.totals?.effectivePerDay)}/day · target {router.targetUsdPerDay != null ? `$${router.targetUsdPerDay}` : '—'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">{router.verdictNote}</p>
        </div>
      )}

      {/* maker guard verdict — measured, typed, journaled. T-63: the PROFIT
       * face finally renders too — the audit found the cockpit could only
       * ever show the guard when it was BAD news (2-b#12); a measured win
       * is evidence exactly as much as a measured loss. */}
      {guard?.action && guard.action !== 'KEEP' && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={guard.action === 'PAUSE-FLOW' ? 'rose' : 'amber'} solid>
                {guard.action === 'PAUSE-FLOW' ? 'טרנס-ה-flow נעצר' : 'מרווחים-מתרחבים'}
              </StatusBadge>
              <span className="tnum text-[10px] text-slate-500" dir="ltr">
                {guard.verdict} {typeof guard.perDaySbd === 'number' ? `${guard.perDaySbd} SBD/day` : ''}
              </span>
            </div>
            {guard.reason && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{guard.reason}</p>}
          </div>
        </div>
      )}
      {guard?.verdict === 'MEASURED-PROFIT' && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="emerald" solid>רווח-נמדד על-הספר</StatusBadge>
              <span className="tnum text-[10px] text-slate-500" dir="ltr">
                {typeof guard.perDaySbd === 'number' ? `+${guard.perDaySbd} SBD/day` : ''}
              </span>
            </div>
            {guard.reason && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{guard.reason}</p>}
          </div>
        </div>
      )}

      {/* venue table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-right text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
              <th className="py-1.5 font-medium">מסילה</th>
              <th className="py-1.5 font-medium">אמת</th>
              <th className="py-1.5 font-medium">$ / יום</th>
              <th className="py-1.5 font-medium">משקל</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id} className="border-b border-slate-800/50 last:border-0">
                <td className="py-1.5 pl-2 text-slate-200">{v.label ?? v.id}</td>
                <td className="py-1.5">
                  <StatusBadge tone={classTone(v.class)}>{classLabel(v.class)}</StatusBadge>
                </td>
                <td className="tnum py-1.5 text-slate-300" dir="ltr">{usd(v.usdPerDay)}</td>
                <td className="tnum py-1.5" dir="ltr">
                  <span className={typeof v.weight === 'number' && v.weight < 0 ? 'text-rose-300' : 'text-slate-300'}>
                    {typeof v.weight === 'number' ? `${(v.weight * 100).toFixed(1)}%` : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* tiles: rung + gap */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="סולם-הבא"
          value={router.nextRungUsdPerDay != null ? `$${router.nextRungUsdPerDay}` : '—'}
          tone="emerald"
          ltr
          hint="הרצף הבא שהניתוב רץ אליו"
        />
        <Stat
          label="פער-מהיעד"
          value={router.gap != null ? `$${Math.round(router.gap)}` : '—'}
          tone="amber"
          ltr
          hint={router.neededFactor != null ? `דרום ${router.neededFactor}× מהתשואה האפקטיבית` : undefined}
        />
        <Stat
          label="מסילות-מנותבות"
          value={venues.length || '—'}
          tone="slate"
          ltr
          hint="מדוד + מוערך + חסום — כולן בשולחן, האמת לא נערכת"
        />
      </div>

      {router.law && <p className="text-[10px] leading-relaxed text-slate-500">{router.law}</p>}
    </SectionCard>
  )
}
