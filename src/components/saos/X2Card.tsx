'use client'

import { Sigma } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { Stat } from './Stat'
import type { Status } from './types'

type X2 = NonNullable<NonNullable<Status['economics']>['x2']>

/**
 * T-23f · ספקטרום-ההון X-2 — the capital-spectrum ladder (from status.economics.x2).
 * Curation grows ∝ SP share of the reward pool; the ladder multiplies the MEASURED
 * $/day — honest law: every row is arithmetic on the measurement, never a promise.
 * Tone law: amber card (the road is estimated, not arrived); rows reaching the target
 * get an emerald check. Dormant law: no engine x2 (no SP / no est) → render nothing.
 */

export function X2Card({ x2 }: { x2: X2 | null | undefined }) {
  /* dormant law: the engine emits x2 only with a real SP base + measured est — otherwise nothing */
  if (!x2 || (x2.currentSp == null && !(x2.rows ?? []).length)) return null

  const rows = (x2.rows ?? []).slice(0, 5)
  const factor = x2.factor

  return (
    <SectionCard
      icon={Sigma}
      tone="amber"
      className="md:col-span-2 lg:col-span-3"
      title={<>ספקטרום-ההון X-2 · הדרך ל-<span dir="ltr">$1000</span>/יום <span dir="ltr" className="text-slate-500">(T-23)</span></>}
      meta="כל שורה = המדידה של-היום מוכפלת בחלק-ה-SP — אריתמטיקה על-המדידה, לא הבטחה: ההון מכפיל את-המדידה, הקוד נשאר."
    >
      {/* ─── HEADLINE: the required multiplier ─── */}
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="tnum text-3xl font-black leading-none text-amber-400" dir="ltr">
          {typeof factor === 'number' && Number.isFinite(factor) ? `${factor.toFixed(1)}×` : '—'}
        </span>
        <span className="text-xs font-bold text-slate-300">המכפיל-הנדרש מ-SP {x2.currentSp != null ? x2.currentSp.toLocaleString('en-US') : '—'} עד-היעד</span>
      </div>

      {/* ─── MEASURED / TARGET TILES ─── */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat
          label="נמדד-היום"
          value={x2.currentUsdPerDay != null ? `$${x2.currentUsdPerDay.toFixed(2)}/יום` : '—'}
          tone="emerald"
          ltr
          hint="המדידה שהספקטרום מכפיל"
        />
        <Stat
          label="יעד"
          value={x2.targetUsdPerDay != null ? `$${x2.targetUsdPerDay.toLocaleString('en-US')}/יום` : '—'}
          tone="amber"
          ltr
        />
        <Stat label="SP-נוכחי" value={x2.currentSp != null ? x2.currentSp.toLocaleString('en-US') : '—'} ltr />
      </div>

      {/* ─── THE SPECTRUM LADDER ─── */}
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
          <table className="w-full min-w-[280px] border-collapse tnum">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                <th scope="col" className="px-3 py-2 text-start font-medium">מכפיל</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">SP</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">$/יום</th>
                <th scope="col" className="px-3 py-2 text-center font-medium">יעד</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r, i) => (
                <tr key={`${r.mult ?? 'mult'}-${i}`}>
                  <td className="px-3 py-2 text-start text-xs font-bold text-slate-200" dir="ltr">{r.mult ?? '—'}×</td>
                  <td className="px-3 py-2 text-end text-sm font-bold text-slate-100">{typeof r.sp === 'number' ? r.sp.toLocaleString('en-US') : '—'}</td>
                  <td className="px-3 py-2 text-end text-sm font-bold text-slate-100" dir="ltr">{typeof r.usdPerDay === 'number' ? `$${r.usdPerDay.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {r.reachesTarget ? (
                      <span className="text-emerald-400" role="img" aria-label="מגיע-ליעד">✓</span>
                    ) : (
                      <span className="text-slate-700" aria-hidden>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {x2.law && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{x2.law}</p>}
    </SectionCard>
  )
}
