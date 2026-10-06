'use client'

import { Target } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-21d · גיוס-תפקידים — NEW optional card from status.roles.
 * Renders ONLY when the engine provides the section (defensive ?. everywhere).
 * Roster status law: active=emerald · planned=amber · blocked=rose.
 */
export function RolesCard({ roles }: { roles: Status['roles'] }) {
  if (!roles) return null
  const roster = roles.roster ?? []
  const verdictTone: Tone = /active|ok/i.test(roles.verdict ?? '') ? 'emerald' : /block|fail|dead/i.test(roles.verdict ?? '') ? 'rose' : 'amber'

  const statusTone = (status?: string): Tone => {
    const v = (status ?? '').toLowerCase()
    if (v === 'active') return 'emerald'
    if (v === 'planned') return 'amber'
    if (v === 'blocked') return 'rose'
    return 'slate'
  }

  return (
    <SectionCard
      icon={Target}
      tone="orange"
      className="md:col-span-2 lg:col-span-3"
      title={<>גיוס-תפקידים · סולם-הצי</>}
      actions={roles.verdict ? <StatusBadge tone={verdictTone} solid>{roles.verdict}</StatusBadge> : undefined}
    >
      {roster.length === 0 ? (
        <p className="text-xs text-slate-500">הסולם ייפתח כשהמנוע ידווח רוסטר-תפקידים…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-950/80 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start font-semibold">מזהה</th>
                <th className="px-3 py-2 text-start font-semibold">תפקיד</th>
                <th className="px-3 py-2 text-start font-semibold">נתיב</th>
                <th className="px-3 py-2 text-start font-semibold">יכולת</th>
                <th className="px-3 py-2 text-start font-semibold">מצב</th>
                <th className="px-3 py-2 text-start font-semibold">גויס</th>
                <th className="px-3 py-2 text-start font-semibold">ראיה</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r, i) => (
                <tr key={`${r.id ?? 'role'}-${i}`} className="border-t border-slate-800/70 transition-colors hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-mono text-xs text-slate-300" dir="ltr">{r.id ?? '—'}</td>
                  <td className="px-3 py-2 text-xs font-bold text-slate-100">{r.role ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{r.lane ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{r.capability ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge tone={statusTone(r.status)}>{r.status ?? '—'}</StatusBadge></td>
                  <td className="tnum px-3 py-2 text-[11px] text-slate-500" dir="ltr">{r.recruitedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                  <td className="px-3 py-2 text-[10px] text-slate-600" dir="ltr">{r.evidence ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {roles.ladderNote && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{roles.ladderNote}</p>
      )}
    </SectionCard>
  )
}
