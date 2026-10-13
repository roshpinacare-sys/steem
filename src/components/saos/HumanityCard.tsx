'use client'

import { Users, Clock, Scale, GitBranch, ShieldCheck, Ban } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-73 · שכבת-האנושיות — הריתמוס, הכוח השווה, והקהילה (from status.humanity,
 * status.delegation, status.community). The operator measured the fleet's
 * social layer and named the disease: everything at the same moment,
 * templated comments, AI-tell titles, unequal power, no community. This card
 * shows the cure live: whose desk is open right now, how the delegated power
 * converged, and the dedicated community's chain status.
 * Tone law: armed/indexed/verified → emerald, pending/blocked → amber,
 * dead/fail → rose, dormant → slate; zero blue/indigo.
 */

const vests = (v?: number | null): string => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${(v / 1000).toFixed(1)}K`
}

const deskTone = (v?: string | null): Tone => {
  const s = v ?? ''
  if (s === 'IN-WINDOW') return 'emerald'
  if (s === 'OUT-OF-WINDOW') return 'slate'
  if (s === 'DORMANT') return 'slate'
  return 'amber'
}

const deskLabel = (v?: string | null): string => {
  const s = v ?? ''
  if (s === 'IN-WINDOW') return 'בשולחן'
  if (s === 'OUT-OF-WINDOW') return 'מחוץ-לחלון'
  if (s === 'DORMANT') return 'רדום'
  return s || '—'
}

export type HumanityShape = NonNullable<Status['humanity']>
export type DelegationShape = NonNullable<Status['delegation']>
export type CommunityShape = NonNullable<Status['community']>

export function HumanityCard({
  humanity,
  delegation,
  community,
}: {
  humanity?: HumanityShape | null
  delegation?: DelegationShape | null
  community?: CommunityShape | null
}) {
  if (!humanity && !delegation && !community) return null
  const desks = humanity?.atDesk ?? []
  const atDeskNow = desks.filter((d) => d.verdict === 'IN-WINDOW').length
  const execTopups = delegation?.executed ?? []
  const rows = delegation?.rows ?? []

  return (
    <SectionCard
      icon={Users}
      title="שכבת-האנושיות · ריתמוס, כוח-שווה, קהילה"
      tone={(humanity?.initialized || community?.created) ? 'emerald' : 'amber'}
      meta={humanity?.law ?? 'אנושיות היא חוק, לא וייב — כל-חסימה מאתרת מחלה-רובוטית'}
      actions={<StatusBadge tone={(humanity?.initialized || community?.created) ? 'emerald' : 'amber'}>{humanity?.initialized ? 'פרסונות-חמושות' : 'נטען'}</StatusBadge>}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="בשולחן-עכשיו"
          value={`${atDeskNow}/${desks.length || '—'}`}
          hint="לכל-זהות חלון-שעות-אדם משלה + סטיית-יום"
          tone={atDeskNow > 0 ? 'emerald' : 'slate'}
        />
        <Stat
          label="שערים היום"
          value={`${humanity?.passedToday ?? 0} עברו · ${humanity?.blockedToday ?? 0} נחסמו`}
          hint="חסימה = טביעת-אצבע-רובוטית שנתפסה"
          tone={(humanity?.blockedToday ?? 0) > 0 ? 'amber' : 'emerald'}
        />
        <Stat
          label="יעד-הכוח השווה"
          value={typeof delegation?.target === 'number' ? vests(delegation.target) : '—'}
          hint={typeof delegation?.cvPct === 'number' ? `CV ${delegation.cvPct.toFixed(1)}% בין-החיילים` : 'תוכנית-השלמות'}
          tone={delegation?.verdict === 'TOPUP-EXECUTED' ? 'emerald' : 'amber'}
        />
        <Stat
          label="הקהילה-היעודית"
          value={community?.created ? (community.name ?? '—') : '—'}
          hint={community?.verified ? 'נוצרה ומאומתת בקריאה-חוזרת' : 'כרגע-לא-נוצרה'}
          tone={community?.verified ? 'emerald' : community?.created ? 'amber' : 'slate'}
        />
      </div>

      {desks.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <Clock className="h-3 w-3" aria-hidden /> שולחנות-הפרסונה (חלונות-שעות-אדם · UTC)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {desks.map((d, i) => (
              <span
                key={`${d.account}-${i}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${d.verdict === 'IN-WINDOW' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : d.verdict === 'DORMANT' ? 'border-slate-700/60 bg-slate-900/40 text-slate-500' : 'border-slate-700/60 bg-slate-900/40 text-slate-400'}`}
                title={d.nextOpenAt ? `נפתח ב-${d.nextOpenAt.slice(11, 16)}Z` : undefined}
              >
                <span dir="ltr" className="font-mono">{d.account}</span>
                <span className="text-[10px] opacity-80">{deskLabel(d.verdict)}{d.which ? `·${d.which === 'primary' ? 'ראשי' : 'משני'}` : ''}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {(execTopups.length > 0 || (delegation?.topupsPlanned ?? 0) > 0) && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <Scale className="h-3 w-3" aria-hidden /> מסילת-שוויון-הכוח — השלמות (רק-כלפי-מעלה)
          </p>
          <div className="max-h-36 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
            {execTopups.slice(0, 8).map((e, i) => (
              <div key={`${e.account}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-800/70 bg-slate-950/40 px-2 py-1.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-slate-300" dir="ltr">{e.account}</span>
                <span className="tnum shrink-0 text-slate-300">{vests(e.vests)} VESTS</span>
                <span className="tnum min-w-0 flex-1 truncate text-right text-slate-500" dir="ltr" title={e.txid ?? undefined}>{e.txid ? `${e.txid.slice(0, 10)}…` : '—'}</span>
              </div>
            ))}
            {(delegation?.topupsPlanned ?? 0) > execTopups.length && (
              <p className="text-[10px] text-amber-400">
                {delegation?.verdict === 'NO-AVAILABLE-MANA' ? 'המנה-המאצלת נצרכה בטיסת-סוכן-אח — ההשלמה מתכנסת במחזור-הבא (מדוד, לא מובטח)' : `${(delegation?.topupsPlanned ?? 0) - execTopups.length} השלמות בתור — מתכנס כל-6 שעות`}
              </p>
            )}
          </div>
        </div>
      )}

      {community?.created && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
          <span className="font-bold">הקהילה-היעודית חיה:</span>
          <span dir="ltr" className="font-mono">{community.name}</span>
          <span className="text-emerald-100">{community.title}</span>
          {community.verified ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <Ban className="h-3.5 w-3.5 text-amber-400" aria-hidden />}
          <span className="text-[11px] text-emerald-300/80">{community.verified ? 'מאומתת בקריאה-חוזרת מהשרשרת' : 'נוצרה על השרשרת — פרטי-ההגדרות ממתינים לאינדוקס'}</span>
        </div>
      )}
    </SectionCard>
  )
}
