'use client'

import { useEffect, useState } from 'react'
import { Banknote, BookX, Clock3, Coins, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-29 · כרטיס-ההוכחה — הרווח-האמיתי המדוד (from status.income + status.booklaw).
 *
 * The operator's bar: "<1¢/day is not acceptable — prove it." This card
 * renders the ONE number measured from chain truth (claims + realized
 * trading over full ledger days only), every income class separated (never
 * merged: measured / realized / face-pending), plus the book-coverage desk
 * verdict (the phantom-book risk, measured and repaired by law).
 * Tone law: emerald=measured money, amber=waiting/window honesty,
 * rose=risk verdict, slate=measurement notes. Zero blue/indigo.
 */

const usd = (v: number | null | undefined, digits = 4) =>
  v == null || !Number.isFinite(Number(v)) ? '?' : <bdi dir="ltr">${Number(v).toFixed(digits)}</bdi>

const VERDICT_TONE: Record<string, Tone> = {
  MEASURED: 'emerald',
  'WINDOW-WAITING': 'amber',
  'READ-FAILED': 'rose',
}

const BOOK_TONE: Record<string, Tone> = {
  COVERED: 'emerald',
  REPAIRED: 'emerald',
  UNCOVERED: 'rose',
  'CANCEL-FAILED': 'rose',
  'OPERATOR-PAUSED': 'slate',
  'NO-DATA': 'slate',
}

function Row({ icon: Icon, label, value, note, tone = 'slate' }: { icon: LucideIcon; label: string; value: React.ReactNode; note?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/40 px-3 py-2">
      <div className="flex items-start gap-2 min-w-0">
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-slate-400')} aria-hidden />
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-200">{label}</div>
          {note ? <div className="text-[10px] leading-snug text-slate-500">{note}</div> : null}
        </div>
      </div>
      <div className="shrink-0 text-right font-mono text-[11px] text-slate-100">{value}</div>
    </div>
  )
}

export function IncomeCard({ income, booklaw }: { income?: Status['income']; booklaw?: Status['booklaw'] }) {
  /* live counter only re-derives freshness — all money values stay engine-computed */
  const [age, setAge] = useState('')
  useEffect(() => {
    const t = () => {
      const at = income?.at ? Date.parse(income.at) : null
      if (!at || !Number.isFinite(at)) return setAge('')
      const m = Math.max(0, Math.round((Date.now() - at) / 60000))
      setAge(m === 0 ? 'עכשיו' : `לפני ${m} דק׳`)
    }
    t()
    const iv = setInterval(t, 30_000)
    return () => clearInterval(iv)
  }, [income?.at])

  const inc = income?.income ?? null
  const perDay = inc?.usdPerDay7d
  const verdict = income?.verdict ?? null
  const bt = booklaw?.verdict ?? null
  const cov = booklaw?.coverage ?? null
  const bcast = booklaw?.broadcast ?? null

  return (
    <SectionCard
      title="רווח-אמיתי מדוד"
      icon={TrendingUp}
      tone="emerald"
      actions={verdict ? <StatusBadge tone={VERDICT_TONE[verdict] ?? 'slate'}>{verdict === 'MEASURED' ? 'נמדד על-השרשרת' : verdict === 'WINDOW-WAITING' ? 'ממתין-ליום-מלא' : verdict}</StatusBadge> : null}
      meta="T-29 · המספר-האחד: הכנסה-אמיתית מדודה מאמת-שרשרת בלבד — claims מדודים + מסחר-realized על יוממה-מלאה. מחלקות לעולם לא מתמזגות."
    >
      <div className="space-y-2.5">
        {/* THE number */}
        <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-transparent px-4 py-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">הכנסה-אמתית מדודה / יום</div>
              <div className="mt-0.5 font-mono text-2xl font-semibold text-emerald-200">{usd(perDay)}</div>
            </div>
            <div className="text-left text-[10px] leading-snug text-slate-400">
              {inc?.windowDaysFull != null ? (
                <>חלון-מדידה: <bdi dir="ltr">{inc.windowDaysFull}</bdi> ימים מלאים<br />{age ? `נמדד ${age}` : null}</>
              ) : (
                <span className="text-amber-300/90">{inc?.windowHonest ?? 'המדידה ממתינה ליוממה-מלאה של המספרה — לא מנחשת'}</span>
              )}
            </div>
          </div>
        </div>

        {/* income classes — separated forever */}
        <Row
          icon={Coins}
          tone="emerald"
          label="תביעות-פרס מדודות (7d)"
          note={inc?.claims?.windowDays != null ? `חלון ${inc.claims.windowDays} ימים · vests מומרים ל-STEEM בשער-השרשרת` : null}
          value={<>{usd(inc?.claims?.usd)}<span className="text-slate-500"> · <bdi dir="ltr">{inc?.claims?.steem ?? 0}</bdi> STEEM + <bdi dir="ltr">{inc?.claims?.vests ?? 0}</bdi> VESTS</span></>}
        />
        <Row
          icon={Banknote}
          tone="emerald"
          label="מסחר realized"
          note={<>proceeds <bdi dir="ltr">{inc?.trading?.proceedsSbd ?? 0}</bdi> SBD · realized לפי חוק-הבסיס (מכירות-ללא-בסיס לא נחשבות רווח)</>}
          value={usd(inc?.trading?.usd)}
        />
        <Row
          icon={Clock3}
          tone="amber"
          label="פנדינג-פאייאוט עצמי (face)"
          note={inc?.pendingAuthor?.note ?? 'ערך-פאייאוט עד ה-cashout — לא מזומן'}
          value={<><bdi dir="ltr">{inc?.pendingAuthor?.sbd ?? 0}</bdi> SBD</>}
        />
        {inc?.unclaimed && (inc.unclaimed.vests || inc.unclaimed.sbd || inc.unclaimed.steem) ? (
          <Row icon={Coins} label="לא-נתבע (ממתין claim)" value={<><bdi dir="ltr">{inc.unclaimed.vests}</bdi> VESTS · <bdi dir="ltr">{inc.unclaimed.sbd}</bdi> SBD</>} />
        ) : null}

        {/* publish truth — the account-level anti-duplication law */}
        {income?.publishTruth ? (
          <Row
            icon={BookX}
            tone={(income.publishTruth.postsToday ?? 0) >= (income.publishTruth.accountCap ?? 4) ? 'amber' : 'slate'}
            label="אמת-פרסום ברמת-החשבון"
            note={`פוסטים היום מכל-הפסים: ${income.publishTruth.postsToday ?? '?'} · מכסת-חשבון: ${income.publishTruth.accountCap ?? 4} ⇒ מעליה המפרסם-שלנו נסוג`}
            value={<bdi dir="ltr">{income.publishTruth.postsToday ?? '?'}/{income.publishTruth.accountCap ?? 4}</bdi>}
          />
        ) : null}

        {/* the book-coverage risk desk */}
        {bt ? (
          <div className={cn('rounded-lg border px-3 py-2', bt === 'COVERED' || bt === 'REPAIRED' ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5')}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium text-slate-200">חוק-כיסוי-הספר · שולחן-הסיכון</div>
              <StatusBadge tone={BOOK_TONE[bt] ?? 'slate'}>{bt === 'REPAIRED' ? 'תוקן — פנטום בוטל' : bt === 'COVERED' ? 'מכוסה' : bt}</StatusBadge>
            </div>
            <div className="mt-1 font-mono text-[10px] leading-relaxed text-slate-400">
              asks: <bdi dir="ltr">{cov?.askSum ?? '?'}</bdi>/<bdi dir="ltr">{cov?.askCap ?? '?'}</bdi> STEEM · bids: <bdi dir="ltr">{cov?.bidSum ?? '?'}</bdi>/<bdi dir="ltr">{cov?.bidCap ?? '?'}</bdi> SBD
              {booklaw?.cancelIds?.length ? <> · בוטלו: <bdi dir="ltr">{booklaw.cancelIds.length}</bdi> פקודות-פנטום</> : null}
              {bcast?.pending ? <span className="text-amber-300"> · CANCEL-PENDING</span> : null}
              {bcast?.ok ? <span className="text-emerald-300"> · שודר חי</span> : null}
              {bcast?.ok === false && !bcast?.pending ? <span className="text-rose-300"> · שידור-ביטול נכשל</span> : null}
            </div>
            {booklaw?.cancelWhy?.length ? (
              <div className="mt-1 font-mono text-[10px] text-slate-500">
                {booklaw.cancelWhy.slice(0, 3).map((c) => (
                  <div key={c.id}>‎<bdi dir="ltr">#{c.id}</bdi>‎ {c.side === 'ask' ? 'ask' : 'bid'} <bdi dir="ltr">{c.amt}</bdi> — פנטום מעל-היתרה</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}
