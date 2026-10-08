'use client'

import { Link2 } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { RailRow } from './RailRow'
import type { FleetEvidence } from './FleetEvidence'

/**
 * R269 · the operator said "אני לא רואה שהתחברת" — this card is the SEE:
 * the measured answer to "who connected Hive, with which keys, when" with
 * live custody badges, not prose. Every dynamic row comes from the probe
 * files or the engine's own per-cycle custody verdicts.
 */
export function HiveConnectionCard({ evi }: { evi: FleetEvidence | null }) {
  const c = evi?.connection
  const hive = evi?.custody?.hive
  const steem = evi?.custody?.steem
  const hiveAlive = (hive?.total ?? 0) > 0 && hive?.verified === hive?.total
  const steemAlive = (steem?.total ?? 0) > 0 && steem?.verified === steem?.total

  return (
    <SectionCard
      icon={Link2}
      tone="emerald"
      title={<>חיבור-Hive · הראיות המדודות <span dir="ltr" className="text-slate-500">(R268/R269)</span></>}
      meta="לא-טענה — מדידה: פרוב-פורנזיקה חוזר-להרצה + קבלות-גיט + אימות-אפוטרופסות בכל-מחזור-מנוע"
      actions={
        <StatusBadge tone={hiveAlive ? 'emerald' : 'amber'} solid pulse={hiveAlive}>
          {hiveAlive ? `אפוטרופסות-Hive ${hive?.verified}/${hive?.total}` : 'נמדד'}
        </StatusBadge>
      }
    >
      <p className="text-xs leading-relaxed text-slate-300">
        מי-חיבר: <b className="text-emerald-300">{c?.who ?? '—'}</b>
      </p>
      <RailRow label="המפתחות" value={c?.keys ?? '—'} className="mt-2" />
      <RailRow label="קבלות-גיט (שרשרת+קבלה, פעמיים-לכל-פעולה)" value={(c?.receiptCommits ?? []).join(' · ') || '—'} ltr mono className="mt-1" />
      <RailRow label="גבול-הלוויתן (כנה)" value={c?.whaleBoundary ?? '—'} className="mt-1" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusBadge tone={steemAlive ? 'emerald' : 'slate'}>Steem {steem ? `${steem.verified}/${steem.total}` : '—'}</StatusBadge>
        <StatusBadge tone={hiveAlive ? 'emerald' : 'amber'}>Hive {hive ? `${hive.verified}/${hive.total}` : '—'}</StatusBadge>
        {(c?.probes ?? []).map((p) => (
          <span key={p} dir="ltr" className="rounded border border-slate-800 bg-slate-900/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{p}</span>
        ))}
      </div>
      {!!evi?.timeline?.length && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] font-bold text-slate-400">ציר-הזמן המדוד — פרסומים חיים על-Hive (עידן-החיבור ואילך):</p>
          <div className="max-h-52 space-y-1 overflow-y-auto pe-1">
            {evi.timeline.map((t) => (
              <div key={t.day} className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 text-[11px]">
                <span dir="ltr" className="shrink-0 font-mono text-slate-400">{t.day}</span>
                <span className="min-w-0 truncate text-slate-300">
                  {t.count} פרסומים · {t.authors.length} חשבונות · <span dir="ltr" className="font-mono text-[10px] text-slate-500">{t.sample}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
