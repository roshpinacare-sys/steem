'use client'

import { Users } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'
import type { Tone } from './tones'

const agentStatusTone = (status: string): Tone =>
  status === 'ALIVE' ? 'emerald' : status === 'IDLE' ? 'slate' : status === 'BLOCKED' ? 'amber' : 'rose'

const agentStatusLabel = (status: string) =>
  status === 'ALIVE' ? 'חי' : status === 'IDLE' ? 'המתנה' : status === 'BLOCKED' ? 'חסום' : 'מת'

/**
 * T-21d · הצי · רישום-סוכנים מאוחד (T-15): extracted verbatim-in-spirit from the old page.
 * One truth for every agent: measured liveness from logged output, never claimed counts.
 */
export function FleetCard({ s }: { s: Status | null }) {
  const fleet = s?.fleet ?? null
  const counts = fleet?.counts
  const verdictTone: Tone = fleet?.verdict === 'FLEET-OK' ? 'emerald' : fleet?.verdict?.startsWith('DEAD') ? 'rose' : 'amber'

  return (
    <SectionCard
      icon={Users}
      tone="orange"
      className="md:col-span-2 lg:col-span-3"
      title={<>הצי · רישום-סוכנים מאוחד <span dir="ltr" className="text-slate-500">(T-15)</span></>}
      actions={<StatusBadge tone={verdictTone} solid>{fleet?.verdict ?? '-'}</StatusBadge>}
      meta={'התשובה המבנית ל"60+ סוכנים, רובם מתים": חיות-נמדדת מהפלט-המוקלט של כל סוכן (לא ספירות-יומרה)'}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge tone="emerald">חיים {counts?.alive ?? '-'}</StatusBadge>
        <StatusBadge tone="slate">בהמתנה-חוקית {counts?.idle ?? '-'}</StatusBadge>
        <StatusBadge tone="amber">חסומים {counts?.blocked ?? '-'}</StatusBadge>
        <StatusBadge tone={(counts?.dead ?? 0) > 0 ? 'rose' : 'slate'}>מתים {counts?.dead ?? '-'}</StatusBadge>
        <span className="text-slate-500">· סה"כ {counts?.total ?? '-'} סוכנים</span>
      </div>

      <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto pe-1 sm:grid-cols-2 lg:grid-cols-3">
        {(fleet?.agents ?? []).map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 transition-colors hover:border-slate-600">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-100" dir="ltr">{a.id}</span>
              <StatusBadge tone={agentStatusTone(a.status)}>{agentStatusLabel(a.status)}</StatusBadge>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-500">{a.role}</p>
            <p className="mt-1 text-[11px] leading-snug text-slate-600" dir="ltr">{a.evidence}</p>
            {a.status === 'BLOCKED' && a.blockedBy && (
              <p className="mt-1 text-[11px] text-amber-300/90">
                חסום-על-ידי: {a.blockedBy === 'credential-missing' ? 'אישורי-חסר' : a.blockedBy}{a.revival ? ` · ${a.revival}` : ''}
              </p>
            )}
          </div>
        ))}
        {!fleet?.agents?.length && <p className="text-xs text-slate-500">הרישום-המאוחד ייפתח כשהמנוע יגיב…</p>}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {fleet?.lostEraNote ?? 'הרישום הזה הוא האמת היחידה על-הסוכנים.'} · {fleet?.honesty ?? ''}
      </p>
    </SectionCard>
  )
}
