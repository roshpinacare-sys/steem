'use client'

import { Boxes, CircleCheck, PauseCircle, CircleAlert, CircleDashed, ShieldCheck } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'

/**
 * T-36 · מישור-העומסים — the workloads plane, rendered honestly.
 * The google/ax doctrine (examined live, Apache-2.0) adopted at our scale:
 * every track DECLARED as a saos.io/v1alpha1 Workload manifest with a burn
 * cap, phases DERIVED from real state signals (never declared by hope),
 * suspend/resume reconciled ONLY on verified flags — a suspend that
 * suspends nothing is refused, and the card says so. The AX runtime itself
 * (K8s + Substrate + Redis) was blocked here and rejected as the wrong
 * scale; only the doctrine was adopted. Tone law: emerald when every
 * declared workload is Running/Suspended with zero skipped manifests,
 * amber otherwise. Zero blue/indigo.
 */

const PHASE_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'slate'> = {
  Running: 'emerald',
  Suspended: 'slate',
  Pending: 'amber',
  Failed: 'rose',
}

export function WorkloadsCard({ workloads }: { workloads: Status['workloads'] }) {
  if (!workloads) return null
  const rows = workloads.workloads ?? []
  const skipped = (workloads.skipped ?? []).length
  const bad = rows.filter((w) => w.phase === 'Failed' || w.phase === 'Pending').length
  const stale = rows.filter((w) => (w.conditions ?? []).some((c) => c.type === 'LastRunStale' && c.status)).length
  const tone = !workloads.ok || skipped > 0 || bad > 0 ? ('amber' as const) : stale > 0 ? ('amber' as const) : ('emerald' as const)
  const suspended = rows.filter((w) => w.phase === 'Suspended').length
  const caps = rows.reduce((a, w) => a + (w.maxSpendPerDayUsd ?? 0), 0)

  return (
    <SectionCard
      icon={Boxes}
      tone={tone}
      className="md:col-span-2 lg:col-span-3"
      title={<>מישור-העומסים · ריצה-הצהרתית <span dir="ltr" className="text-slate-500">(T-36 · AX-inspired)</span></>}
      actions={<StatusBadge tone={tone} solid>{rows.length} עומסים · {suspended} מושהים</StatusBadge>}
      meta="דוקטרינת google/ax אומצה בכנות (Apache-2.0, נבדק חי): כל מסילה מוצהרת saos.io/v1alpha1 עם תקרת-שריפה (חוק-הבעירה: מניפסט בלי תקרה נדחה), פאזות נגזרות מאותות-אמת (לעולם לא מוצהרות), suspend/resume רק על דגלים-מאומתים. רנטיים-AX (K8s+Substrate+Redis) נחסמו-בסנדבוקס ונדחו כסקאלה-לא-נכונה."
    >
      <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-800" dir="ltr">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-slate-900/95 text-[9px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-2.5 py-2 font-semibold">workload</th>
              <th className="px-2.5 py-2 font-semibold">phase</th>
              <th className="px-2.5 py-2 font-semibold">class</th>
              <th className="px-2.5 py-2 font-semibold">cadence</th>
              <th className="px-2.5 py-2 font-semibold">burn cap</th>
              <th className="px-2.5 py-2 font-semibold">conditions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const pt = PHASE_TONE[w.phase ?? ''] ?? 'slate'
              const trueConds = (w.conditions ?? []).filter((c) => c.status)
              return (
                <tr key={w.name ?? Math.random()} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                  <td className="px-2.5 py-2">
                    <span className="font-extrabold text-slate-200">{w.name}</span>
                    <span className="ms-1.5 text-[9px] text-slate-500">{w.rail}</span>
                    {w.reconcilable && <ShieldCheck className="ms-1 inline h-3 w-3 text-emerald-400/70" aria-label="reconcilable" />}
                  </td>
                  <td className="px-2.5 py-2">
                    <span className="inline-flex items-center gap-1">
                      {pt === 'emerald' && <CircleCheck className="h-3 w-3 text-emerald-400" aria-hidden />}
                      {pt === 'slate' && <PauseCircle className="h-3 w-3 text-slate-400" aria-hidden />}
                      {pt === 'amber' && <CircleDashed className="h-3 w-3 text-amber-400" aria-hidden />}
                      {pt === 'rose' && <CircleAlert className="h-3 w-3 text-rose-400" aria-hidden />}
                      <span className={pt === 'emerald' ? 'text-emerald-300' : pt === 'rose' ? 'text-rose-300' : pt === 'amber' ? 'text-amber-300' : 'text-slate-300'}>{w.phase}</span>
                    </span>
                  </td>
                  <td className="px-2.5 py-2 text-slate-400">{w.opClass}</td>
                  <td className="px-2.5 py-2 text-slate-400">{w.cadenceMinutes}m</td>
                  <td className="px-2.5 py-2 text-slate-400">${w.maxSpendPerDayUsd}</td>
                  <td className="px-2.5 py-2">
                    {trueConds.length === 0 ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {trueConds.map((c) => (
                          <span key={c.type} className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-300" title={c.reason}>{c.type}</span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500" dir="ltr">
        <span>total declared burn cap: <span className="font-bold text-slate-300">${caps.toFixed(2)}/day</span></span>
        <span>·</span>
        <span>reconcile flags verified: curator.json:enabled · hyper-grid.json:conf.enabled</span>
        {workloads.control && Object.keys(workloads.control).length > 0 && (
          <>
            <span>·</span>
            <span className="text-amber-300">control: {Object.entries(workloads.control).map(([k, v]) => `${k}=${v.verb}`).join(', ')}</span>
          </>
        )}
      </div>

      {skipped > 0 && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-300" dir="ltr">
          {skipped} manifest(s) rejected fail-closed (burn-cap/shape laws)
        </p>
      )}
      {workloads.law && <p className="mt-1 text-[10px] leading-relaxed text-slate-500" dir="ltr">{workloads.law}</p>}
    </SectionCard>
  )
}
