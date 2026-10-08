'use client'

import { Handshake } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-23f · אריגה · חוזה-הגוף-האחד: the second-signer weave contract (from status.weave).
 * Two writers, one chain: lanes observed chain-side (votes/orders), the shared day-cap
 * counted chain-truth over BOTH writers. This card only renders, the engine arbitrates.
 * Tone law: handshake PUBLISHED → emerald; cap breached → rose accent + amber warning;
 * every law (partition/collision/weight) renders as a small slate footnote. Zero blue/indigo.
 */

const handshakeTone = (s?: string | null): Tone => {
  const v = (s ?? '').toUpperCase()
  if (v === 'PUBLISHED') return 'emerald'
  if (/PENDING|PROPOSED|OFFERED|WAIT/i.test(v)) return 'amber'
  if (/FAIL|ERROR|BROKEN/i.test(v)) return 'rose'
  return 'slate'
}

const relTime = (iso?: string | null): string => {
  if (!iso) return '-'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '-'
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (min < 1) return 'עכשיו'
  if (min < 60) return `לפני ${min} דק`
  const h = Math.floor(min / 60)
  if (h < 24) return `לפני ${h} שע'`
  return `לפני ${Math.floor(h / 24)} ימים`
}

function LaneRow({ label, votes, orders, strong = false }: { label: string; votes?: number | null; orders?: number | null; strong?: boolean }) {
  return (
    <tr className={strong ? 'bg-slate-900/60' : ''}>
      <th scope="row" className="px-3 py-2 text-start text-[11px] font-bold text-slate-200">{label}</th>
      <td className="tnum px-3 py-2 text-end text-sm font-bold text-slate-100">{votes ?? 0}</td>
      <td className="tnum px-3 py-2 text-end text-sm font-bold text-slate-100">{orders ?? 0}</td>
    </tr>
  )
}

export function WeaveCard({ weave }: { weave: Status['weave'] }) {
  if (!weave) return null

  const arb = weave.arbitration ?? null
  const handshake = weave.handshake ?? null
  const ours = weave.ours ?? null
  const theirs = weave.theirs ?? null

  const combined = arb?.combined
  const cap = arb?.sharedDayCap
  const capBreached = typeof combined === 'number' && typeof cap === 'number' && combined > cap
  const capRemaining = arb?.capRemaining

  return (
    <SectionCard
      icon={Handshake}
      tone="orange"
      className="md:col-span-2 lg:col-span-3"
      title={<>אריגה · חוזה-הגוף-האחד <span dir="ltr" className="text-slate-500">(T-23)</span></>}
      meta="חוזה-הגוף-האחד עם החותם-השני: השרשרת היא הפנקס-המשותף: שתי-המסילות נספרות chain-truth, ההתנגשות מונעת ב-contract, לא במזל."
      actions={
        <>
          {handshake?.status && (
            <StatusBadge tone={handshakeTone(handshake.status)} solid title={handshake.status}>
              {handshake.status}
              {handshake.revision != null ? ` · rev ${handshake.revision}` : ''}
            </StatusBadge>
          )}
          {weave.day && <span className="tnum text-[10px] text-slate-500" dir="ltr">{weave.day}</span>}
        </>
      }
    >
      {/* ─── LANE TABLE: two writers, one chain ─── */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
        <table className="w-full min-w-[240px] border-collapse">
          <thead>
            <tr className="border-b border-slate-800">
              <th scope="col" className="px-3 py-2 text-start text-[10px] font-medium text-slate-500">כותב</th>
              <th scope="col" className="px-3 py-2 text-end text-[10px] font-medium text-slate-500">הצבעות-היום</th>
              <th scope="col" className="px-3 py-2 text-end text-[10px] font-medium text-slate-500">פקודות-חיות</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            <LaneRow label="אנחנו" votes={ours?.votesToday} orders={ours?.ordersLive} strong />
            <LaneRow label="החותם-השני" votes={theirs?.votesToday} orders={theirs?.ordersLive} />
          </tbody>
        </table>
      </div>

      {/* ─── ARBITRATION TILES ─── */}
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="משולב / תקרה"
          value={combined != null ? `${combined} / ${cap ?? '-'}` : '-'}
          tone={capBreached ? 'rose' : 'emerald'}
          ltr
          hint={arb?.capBasis ? 'chain-truth משותף' : undefined}
        />
        <Stat
          label="תקרה-נותרת"
          value={capRemaining ?? '-'}
          tone={typeof capRemaining === 'number' ? (capRemaining > 0 ? 'emerald' : 'rose') : 'slate'}
          ltr
        />
        <Stat
          label="מרווח-בין-הצבעות"
          value={theirs?.intervalMinEst != null ? `${theirs.intervalMinEst} דק'` : '-'}
          tone="orange"
          hint={theirs?.lastVoteAt ? `הצבעה-אחרונה ${relTime(theirs.lastVoteAt)}` : undefined}
        />
      </div>

      {capBreached && (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] font-bold leading-relaxed text-amber-400">
          <span aria-hidden>⚠</span>
          <span>התקרה-המשותפת נחצתה ({combined}/{cap}), הבוררות דורשת תיאום. נמדד chain-truth, מוצג כשהוא.</span>
        </p>
      )}

      {/* ─── HANDSHAKE: what we publish + what we ask of the second signer ─── */}
      {handshake && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
          {handshake.ourOffer && (
            <p className="text-[11px] leading-relaxed text-slate-400">
              <b className="text-slate-200">הצעתנו המפורסמת:</b> {handshake.ourOffer}
            </p>
          )}
          {handshake.request && (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
              <b className="text-orange-300">דרישת-ההתקשרות:</b> {handshake.request}
            </p>
          )}
        </div>
      )}

      {/* ─── THE LAWS: small slate footnotes, exactly as measured ─── */}
      {(arb?.partitionLaw || arb?.collisionLaw || arb?.weightLaw) && (
        <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-slate-600">
          {arb?.partitionLaw && <li><b className="text-slate-500">חלוקת-מסילות:</b> {arb.partitionLaw}</li>}
          {arb?.collisionLaw && <li><b className="text-slate-500">התנגשות:</b> {arb.collisionLaw}</li>}
          {arb?.weightLaw && <li><b className="text-slate-500">משקלים:</b> {arb.weightLaw}</li>}
        </ul>
      )}
      {weave.law && <p className="text-[10px] leading-relaxed text-slate-500">{weave.law}</p>}
    </SectionCard>
  )
}
