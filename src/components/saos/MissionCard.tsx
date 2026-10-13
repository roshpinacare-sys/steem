'use client'

import { Target, GitBranch, UserCheck } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'

/**
 * T-25 · המשימה — the goal-object + the cycle graph (from status.mission).
 * learn-harness-engineering applied, rendered honestly: a goal is a statement
 * + a verification method + a stopping condition + an INDEPENDENT evaluator
 * (the chain grades, never the self-report). The graph shows the real 18-step
 * cycle as nodes/levels (fan-out) + rollback edges + the one human-approval node.
 * Tone law: reached → emerald; progress → amber bar on slate. Zero blue/indigo.
 */

export function MissionCard({ mission }: { mission: Status['mission'] }) {
  if (!mission) return null

  const graph = mission.graph ?? null
  const levels = graph?.levels ?? []
  const fanoutMax = levels.reduce((m, l) => Math.max(m, l.length), 0)
  const progress = typeof mission.progressPct === 'number' ? mission.progressPct : 0

  return (
    <SectionCard
      icon={Target}
      tone={mission.reached ? 'emerald' : 'amber'}
      className="md:col-span-2 lg:col-span-3"
      title={<>המשימה · מטרה-מדודה ושופט-עצמאי <span dir="ltr" className="text-slate-500">(T-25)</span></>}
      actions={
        <StatusBadge tone={mission.reached ? 'emerald' : progress > 0 ? 'amber' : 'slate'} solid>
          {mission.reached ? 'הושג' : progress > 0 ? `${progress}%` : 'ממתין-למדידה-ראשונה'}
        </StatusBadge>
      }
      meta="מטרה = משפט-סוף + אימות + תנאי-עצירה + שופט-עצמאי. מי שכותב את הקוד לא מדרג את עצמו — השרשרת מדרגת."
    >
      {/* the goal, verbatim */}
      {mission.goal && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold text-slate-300">המטרה</span>
            <span className="tnum text-[10px] text-slate-500" dir="ltr">
              {mission.measuredTotalUsdPerDay != null ? `$${mission.measuredTotalUsdPerDay}` : '$—'} / $1000
            </span>
          </div>
          <p className="mt-1 text-xs font-bold leading-relaxed text-emerald-300" dir="rtl">{mission.goal}</p>
          {/* progress bar — honest: only measured movement moves it */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.max(progress, 1)}%` }} />
          </div>
        </div>
      )}

      {/* the harness triple: verification / stopping / evaluator */}
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { icon: GitBranch, label: 'אימות', text: mission.verification },
          { icon: Target, label: 'תנאי-עצירה', text: mission.stopping },
          { icon: UserCheck, label: 'השופט-העצמאי', text: mission.evaluator },
        ].map(({ icon: Icon, label, text }) =>
          text ? (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                <span className="text-[10px] font-extrabold uppercase text-slate-400">{label}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{text}</p>
            </div>
          ) : null
        )}
      </div>

      {/* the graph: measured against the real cycle wiring */}
      {graph && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-slate-300">
              <GitBranch className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              גרף-המחזור
            </span>
            <StatusBadge tone={graph.acyclic ? 'emerald' : 'rose'}>{graph.acyclic ? 'דאג-חוקי · acyclic' : 'מעגל-אסור'}</StatusBadge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span className="tnum" dir="ltr">{graph.nodes?.length ?? 0} nodes</span>
            <span className="tnum" dir="ltr">{levels.length} levels</span>
            <span className="tnum" dir="ltr">fan-out max {fanoutMax}</span>
            <span dir="rtl">אישור-אנוש: {graph.humanApproval?.[0] ?? '—'}</span>
          </div>
          {/* level stripes — the fan-out plan, drawn */}
          <div className="mt-2 space-y-1">
            {levels.map((lvl, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="tnum w-8 shrink-0 text-[9px] text-slate-600" dir="ltr">L{i}</span>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {lvl.map((n) => (
                    <span key={n} className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[9px] text-slate-300" dir="ltr">{n}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mission.law && <p className="text-[10px] leading-relaxed text-slate-500">{mission.law}</p>}
    </SectionCard>
  )
}
