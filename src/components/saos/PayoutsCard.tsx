'use client'

import { Clock } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-23f · שעון-הפאייאוט: the measured economy clock (from status.payouts).
 * The engine reads voting_manabar + account_history reward-ops on-chain (one-body law);
 * this card only renders the truth: verdict, the payout CLOCK as headline, then tiles.
 * Honest law: מדוד/מוערך labels only, the clock is measured, never promised.
 * Tone law: MEASURED* → emerald, READ-FAILED → rose; zero blue/indigo.
 */

const compactVests = (v?: number | null): string => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

const verdictTone = (v?: string | null): Tone => {
  const s = v ?? ''
  if (/^MEASURED/i.test(s)) return 'emerald' // MEASURED · MEASURED-PENDING · MEASURED-*
  if (/READ-OK/i.test(s)) return 'emerald' // READ-OK-NO-UNPAID-VOTES
  if (/READ-FAILED|FAIL|ERROR/i.test(s)) return 'rose'
  return 'slate'
}

const rollupConfidenceTone = (c?: string | null): Tone =>
  c === 'measured' ? 'emerald' : c === 'estimated' ? 'amber' : c === 'blocked' ? 'rose' : 'slate'

/** countdown phrasing: 2 ימים (47.7 שע') · 5.3 שעות · "-" */
const countdown = (daysRemaining?: number | null, hoursRemaining?: number | null): string => {
  if (typeof daysRemaining === 'number' && Number.isFinite(daysRemaining) && daysRemaining >= 1) {
    const d = Math.floor(daysRemaining)
    const h = typeof hoursRemaining === 'number' && Number.isFinite(hoursRemaining) ? hoursRemaining.toFixed(1) : null
    return `בעוד ${d} ימים${h ? ` (${h} שע')` : ''}`
  }
  if (typeof hoursRemaining === 'number' && Number.isFinite(hoursRemaining)) return `בעוד ${hoursRemaining.toFixed(1)} שעות`
  return '-'
}

export function PayoutsCard({ payouts }: { payouts: Status['payouts'] }) {
  if (!payouts) return null

  const payout = payouts.payout ?? null
  const vp = payouts.vp ?? null
  const pending = payouts.pending ?? null
  const rollup = payouts.rollup ?? null
  const scan = payouts.scan ?? null

  return (
    <SectionCard
      icon={Clock}
      tone="emerald"
      className="md:col-span-2 lg:col-span-3"
      title={<>שעון-הפאייאוט · מדוד <span dir="ltr" className="text-slate-500">(T-23)</span></>}
      actions={
        <>
          {payouts.verdict && (
            <StatusBadge tone={verdictTone(payouts.verdict)} solid title={payouts.verdict}>
              {payouts.verdict}
            </StatusBadge>
          )}
          {payouts.day && <span className="tnum text-[10px] text-slate-500" dir="ltr">{payouts.day}</span>}
        </>
      }
      meta="השעון נמדד מול-השרשרת (voting_manabar + reward-ops): מדוד, לא מובטח: הטרנס-הבלתי-משולם-הבא הוא האמת, לא הצבעות-עבר שכבר התיישבו."
    >
      {/* ─── THE CLOCK (headline) ─── */}
      {payout ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold text-slate-300">פאייאוט-הבא</span>
            <StatusBadge tone={payout.phase === 'paid-window' ? 'emerald' : 'amber'}>
              {payout.phase === 'paid-window' ? 'חלון-התשלום פתוח' : payout.phase === 'pre-payout' ? 'טרם-הפאייאוט' : payout.phase ?? '-'}
            </StatusBadge>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="tnum text-2xl font-black leading-none text-emerald-400" dir="ltr">
              {payout.payoutDay ?? '-'}
            </span>
            <span className="text-xs font-bold text-slate-300">{countdown(payout.daysRemaining, payout.hoursRemaining)}</span>
          </div>
        </div>
      ) : (
        /* honest empty-state: no payout window measured, the law itself is the message */
        <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
          אין-חלון-פאייאוט מדוד כרגע, השעון יופיע כשהשרשרת מדווחת. {payouts.law ?? ''}
        </p>
      )}

      {/* ─── MEASURED TILES ─── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="VP מדוד"
          value={vp?.pct != null ? `${vp.pct}%` : '-'}
          tone="emerald"
          ltr
          hint={vp?.hrsToFull != null ? `מלא בעוד ${vp.hrsToFull} שע'` : undefined}
        />
        <Stat
          label="טרנס-בלתי-משולמים"
          value={scan?.unpaidTranches ?? '-'}
          tone="amber"
          ltr
          hint={scan?.voteOps != null ? `סריקת ${scan.voteOps} הצבעות` : undefined}
        />
        <Stat
          label="תגמולים-מושהים"
          value={pending?.vests != null ? `${compactVests(pending.vests)} VESTS` : '-'}
          tone={pending?.any ? 'amber' : 'slate'}
          ltr
          hint={
            pending?.any
              ? `${pending.steem ?? 0} STEEM · ${pending.sbd ?? 0} SBD · ${compactVests(pending.vests)} VESTS`
              : 'אין-יתרות-ממתינות'
          }
        />
        <Stat
          label="רולאף-תגמולים"
          value={rollup?.confidence ?? '-'}
          tone={rollupConfidenceTone(rollup?.confidence)}
          hint={rollup?.opsCount != null ? `${rollup.opsCount} ops · חלון ${rollup.windowDays ?? '-'} ימים` : rollup?.note ?? undefined}
        />
      </div>

      {payouts.law && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{payouts.law}</p>}
    </SectionCard>
  )
}
