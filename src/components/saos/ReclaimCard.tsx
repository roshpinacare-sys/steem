'use client'

import { Landmark } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-59 · מכשיר-החזרת-השליטה — plan-only, operator-gated (from status.reclaim).
 * The engine MEASURES the dead delegation lane (per-delegatee reputation from
 * the chain) + the promoted-slot plan for our latest permlink; this card only
 * renders. Execution (undelegation / transfer-to-null) is an irreversible face
 * the constitution keeps with the operator — the card says so, every cycle.
 * Tone law: slate/amber card; emerald only for the honest plan-only badge.
 */

const n6 = (v?: number | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'

const verdictTone = (v?: string | null): Tone => {
  const s = v ?? ''
  if (/PLAN-ONLY/i.test(s)) return 'emerald'
  if (/no-|READ|above/i.test(s)) return 'slate'
  return 'amber'
}

export function ReclaimCard({ reclaim }: { reclaim: Status['reclaim'] }) {
  if (!reclaim) return null
  const deleg = reclaim.delegation ?? null
  const cands = (deleg?.candidates ?? []).slice(0, 20)
  const promo = reclaim.promotedPlan ?? null

  return (
    <SectionCard
      icon={Landmark}
      tone="slate"
      className="md:col-span-2 lg:col-span-3"
      title={<>מכשיר-החזרת-השליטה · תוכנית-בלבד <span dir="ltr" className="text-slate-500">(T-59)</span></>}
      actions={
        <>
          {deleg?.verdict && (
            <StatusBadge tone={verdictTone(deleg.verdict)} solid title={deleg.verdict}>
              {deleg.verdict}
            </StatusBadge>
          )}
          {reclaim.at && <span className="tnum text-[10px] text-slate-500" dir="ltr">{reclaim.at.slice(0, 16).replace('T', ' ')}Z</span>}
        </>
      }
    >
      {/* the delegation lane — measured, never guessed */}
      {deleg && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-bold text-slate-300">ערוץ-ההענקות היוצאות</span>
            <span className="tnum text-[10px] text-slate-500" dir="ltr">
              {cands.length} rows · {n6(deleg.totalSp)} SP · inert {deleg.inertCount ?? 0}
            </span>
          </div>
          {cands.length > 0 && (
            <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto">
              {cands.map((c, i) => (
                <div key={`${c.delegatee}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800/70 bg-slate-900/30 px-2 py-1 text-[11px]">
                  <span className="font-mono text-slate-300" dir="ltr">@{c.delegatee ?? '—'}</span>
                  <span className="tnum text-slate-400" dir="ltr">{n6(c.sp ?? null)} SP · rep {typeof (c as any).repScore === 'number' ? (c as any).repScore : '—'}</span>
                  <StatusBadge tone={c.class === 'inert-candidate' ? 'amber' : 'slate'}>
                    {c.class === 'inert-candidate' ? 'מועמד-מת' : 'פעיל-נמדד'}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
          {deleg.note && <div className="mt-1.5 text-[10px] text-slate-500">{deleg.note}</div>}
        </div>
      )}

      {/* the promoted-slot plan — the cheapest measured visibility on the chain */}
      {promo && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-bold text-slate-300">תוכנית-סלוט מקודם</span>
            <StatusBadge tone={verdictTone(promo.verdict)}>{promo.verdict ?? '—'}</StatusBadge>
          </div>
          <div className="mt-1 text-[11px] text-slate-400" dir="ltr">
            slot {promo.slotCostSbd != null ? `${promo.slotCostSbd} SBD` : '—'} · permlink {promo.permlink ? promo.permlink.slice(0, 40) : '—'}
          </div>
          {promo.note && <div className="mt-1 text-[10px] text-slate-500">{promo.note}</div>}
        </div>
      )}

      {reclaim.law && <div className="mt-2 text-[10px] text-slate-500">{reclaim.law}</div>}
    </SectionCard>
  )
}
