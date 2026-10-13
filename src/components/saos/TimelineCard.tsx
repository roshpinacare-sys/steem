'use client'

import { useEffect, useState } from 'react'
import { Activity, Banknote, CalendarClock, RefreshCw, Scale } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-27 · מסילת-הזמן הריבונית · העתיד-הנמדד של המכונה (from status.timeline).
 * The machine's upcoming MEASURED moments — payout settle, second-signer
 * review deadline, convert maturities, the fill-ledger day-flip — rendered
 * as one live countdown. Every row is engine-computed from its own source
 * artifact (state/payouts.json · weave.json · convert-state.json ·
 * fills-ledger.json); nothing here is promised, everything is scheduled by
 * chain truth or published doctrine. Tone law: emerald=measured money event,
 * orange=doctrine/weave, amber=convert rail, slate=measurement rail. Due
 * rows flip to a solid "מגיע" state — the past is never hidden, the future
 * is never fabricated. Zero blue/indigo.
 */

const KIND: Record<string, { icon: LucideIcon; tone: Tone; name: string }> = {
  payout: { icon: Banknote, tone: 'emerald', name: 'פאייאוט' },
  weave: { icon: Scale, tone: 'orange', name: 'אריגה' },
  convert: { icon: RefreshCw, tone: 'amber', name: 'המרה' },
  ledger: { icon: Activity, tone: 'slate', name: 'מספרת' },
}

const KIND_FALLBACK = { icon: CalendarClock, tone: 'slate' as Tone, name: 'אירוע' }

/* static class maps — Tailwind compiles literals, never template strings */
const DOT_TONE: Record<Tone, { border: string; fill: string; text: string }> = {
  emerald: { border: 'border-emerald-400 bg-emerald-500/25 shadow-glow-emerald', fill: 'bg-emerald-300', text: 'text-emerald-300' },
  amber: { border: 'border-amber-400 bg-amber-500/25 shadow-glow-amber', fill: 'bg-amber-300', text: 'text-amber-300' },
  orange: { border: 'border-orange-400 bg-orange-500/25 shadow-glow-orange', fill: 'bg-orange-300', text: 'text-orange-300' },
  rose: { border: 'border-rose-400 bg-rose-500/25', fill: 'bg-rose-300', text: 'text-rose-300' },
  slate: { border: 'border-slate-500 bg-slate-700/60', fill: 'bg-slate-300', text: 'text-slate-300' },
}

/** live countdown string — days/hours/minutes; "מגיע" past zero (honest). */
function countdown(atMs: number, nowMs: number): string {
  const ms = atMs - nowMs
  if (ms <= 0) return 'מגיע'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min} דק`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} שעות ${min % 60} דק`
  const d = Math.floor(h / 24)
  return `${d} ימים ${h % 24} שעות`
}

export function TimelineCard({ timeline }: { timeline: Status['timeline'] }) {
  const rows = timeline?.rows ?? []
  // live tick — the countdown breathes between the 30s status polls.
  // (async arm: sync setState-in-effect is a hydration + lint hazard; the
  // first paint renders '…' on BOTH server and client, then time flows.)
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => {
    const arm = window.setTimeout(() => setNowMs(Date.now()), 0)
    const t = setInterval(() => setNowMs(Date.now()), 30000)
    return () => { window.clearTimeout(arm); clearInterval(t) }
  }, [])

  if (!timeline || rows.length === 0) return null
  const upcoming = rows.filter((r) => r.state === 'upcoming').length

  return (
    <SectionCard
      icon={CalendarClock}
      tone="emerald"
      className="md:col-span-2 lg:col-span-3"
      title={<>מסילת-הזמן הריבונית · העתיד-הנמדד <span dir="ltr" className="text-slate-500">(T-27)</span></>}
      meta="אירועי-העתיד שהמכונה כבר יודעת — שעון-פאייאוט מדוד, מועד-ביקורת החותם-השני, סטלמנט-המרות, יום-המדידה המלא של מספרת-המילויים. כל שורה מצוטטת לקובץ-המצב שלה; אין-כאן הבטחה אחת — רק זמנים שנגזרו משרשרת ומדוקטרינה שפורסמה."
      actions={
        <>
          <StatusBadge tone={upcoming > 0 ? 'emerald' : 'slate'} solid pulse={upcoming > 0}>
            {upcoming > 0 ? `${upcoming} בדרך` : 'הכל הגיע'}
          </StatusBadge>
          {timeline.at && <span className="tnum text-[10px] text-slate-500" dir="ltr">{timeline.at.slice(11, 16)} UTC</span>}
        </>
      }
    >
      <ol className="relative space-y-0" aria-label="אירועי-עתיד נמדדים">
        {/* the vertical sovereign rail */}
        <span aria-hidden className="absolute bottom-2 top-2 start-[7px] w-px bg-gradient-to-b from-emerald-500/40 via-amber-500/25 to-slate-700" />
        {rows.map((r) => {
          const meta = KIND[r.kind] ?? KIND_FALLBACK
          const Icon = meta.icon
          const isDue = r.state === 'due'
          const atMs = Date.parse(r.at)
          const cd = nowMs == null ? null : countdown(atMs, nowMs)
          return (
            <li key={r.id} className="relative flex items-start gap-3 py-2 ps-6">
              <span
                aria-hidden
                className={cn(
                  'absolute start-0 top-3 grid h-[15px] w-[15px] place-items-center rounded-full border-2',
                  isDue ? 'border-slate-600 bg-slate-800' : DOT_TONE[meta.tone].border,
                )}
              >
                <span className={cn('h-[5px] w-[5px] rounded-full', isDue ? 'bg-slate-500' : DOT_TONE[meta.tone].fill)} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', isDue ? 'text-slate-500' : DOT_TONE[meta.tone].text)} aria-hidden />
                    <span className={cn('text-xs leading-relaxed', isDue ? 'text-slate-500' : 'font-semibold text-slate-100')}>{r.label}</span>
                    <StatusBadge tone={r.class === 'doctrine' ? 'orange' : 'emerald'} className="shrink-0 px-1 py-0 text-[9px]">
                      {r.class === 'doctrine' ? 'דוקטרינה' : 'נמדד'}
                    </StatusBadge>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className={cn('tnum text-xs font-bold', isDue ? 'text-slate-500' : DOT_TONE[meta.tone].text)} dir="ltr">
                      {cd ?? '…'}
                    </span>
                    <span className="tnum text-[10px] text-slate-500" dir="ltr">{r.at.slice(0, 16).replace('T', ' ')}</span>
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-slate-600" dir="ltr" title={`${r.source}${r.txid ? ` · tx ${r.txid}` : ''}`}>
                  {r.source}{r.txid ? ` · tx ${r.txid.slice(0, 12)}…` : ''}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </SectionCard>
  )
}
