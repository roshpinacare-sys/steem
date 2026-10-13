'use client'

import { Coins, ExternalLink } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-24 · מכשיר-ההקפדה · הריבונות-כמפעיל (from status.compound).
 * The payout that lands becomes SP by the machine's OWN hand — claim+powerup
 * in one transaction, 1/day cap, SBD never sold here. The BOOK-RESERVE law
 * (10 STEEM liquid floor) is rendered as a footnote — the yield compounds,
 * the book never gets eaten. This card only renders; the engine compounds.
 * Tone law: COMPOUND/RESUME-POWERUP → emerald; caps/gates → amber; real
 * failures → rose. Zero blue/indigo.
 */

const verdictTone = (v?: string | null): Tone => {
  const s = (v ?? '').toUpperCase()
  if (s === 'COMPOUND' || s === 'RESUME-POWERUP') return 'emerald'
  if (/CAP|WAIT|BLOCKED|GATED|PAUSED/.test(s)) return 'amber'
  if (/FAIL|ERROR/.test(s)) return 'rose'
  return 'slate'
}

const shortTx = (t?: string | null): string =>
  t ? `${String(t).slice(0, 8)}…${String(t).slice(-6)}` : '—'

export function CompoundCard({ compound }: { compound: Status['compound'] }) {
  if (!compound) return null

  const acted = compound.verdict === 'COMPOUND' || compound.verdict === 'RESUME-POWERUP'
  const postLiquid = compound.post?.liquid?.steem
  const preLiquid = compound.liquid?.steem

  return (
    <SectionCard
      icon={Coins}
      tone="emerald"
      className="md:col-span-2 lg:col-span-3"
      title={<>הקפדה · הריבונות-כמפעיל <span dir="ltr" className="text-slate-500">(T-24)</span></>}
      meta="הפאייאוט שנוחת הופך ל-SP בידי-המכונה עצמה — claim+powerup בעסקה-אחת, תקרת-יום, בלי למכור SBD. סולם-ה-X-2 הולך מעצמו: התשואה מתגלגלת, הספר לא נאכל."
      actions={
        <>
          {compound.verdict && (
            <StatusBadge tone={verdictTone(compound.verdict)} solid title={compound.reason ?? compound.verdict}>
              {compound.verdict}
            </StatusBadge>
          )}
          {compound.day && <span className="tnum text-[10px] text-slate-500" dir="ltr">{compound.day}</span>}
        </>
      }
    >
      {/* ─── HEADLINE TILES ─── */}
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="powerup-אחרון"
          value={acted && compound.powerupSteem ? `${compound.powerupSteem} STEEM` : '—'}
          tone={acted ? 'emerald' : 'slate'}
          ltr
          hint={acted ? 'הומר ל-vests בשרשרת' : 'אין פעולה ביום-זה'}
        />
        <Stat
          label="נזיל / רזרבת-ספר"
          value={preLiquid != null ? `${preLiquid} / 10` : '—'}
          tone={preLiquid != null && preLiquid >= 10 ? 'emerald' : 'amber'}
          ltr
          hint="חוק-הרזרבה: הספר ממשיך להציג"
        />
        <Stat
          label="הקפדות-היום"
          value={`${compound.compoundedToday ?? 0} / 1`}
          tone={(compound.compoundedToday ?? 0) > 0 ? 'emerald' : 'slate'}
          ltr
          hint="תקרת-יום (max(state, chain-truth))"
        />
      </div>

      {/* ─── THE ACTION RECORD: txid + post-broadcast chain verification ─── */}
      {acted && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-[11px] font-bold text-emerald-300">
              {compound.verdict === 'COMPOUND' ? 'פאייאוט נתבע והוקפד' : 'עודף-נזיל הוקפד ל-SP'}
            </span>
            {compound.txid && (
              <a
                href={`https://steemscan.com/transaction/${compound.txid}`}
                target="_blank"
                rel="noreferrer"
                className="tnum inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 underline-offset-2 hover:underline"
                dir="ltr"
              >
                {shortTx(compound.txid)}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
          {compound.claim && (compound.claim.steem || compound.claim.sbd || compound.claim.vests) && (
            <p className="tnum mt-1 text-[10px] text-emerald-200/80" dir="ltr">
              claim: {compound.claim.steem ?? 0} STEEM + {compound.claim.sbd ?? 0} SBD + {compound.claim.vests ?? 0} VESTS
            </p>
          )}
          {/* post-broadcast truth: liquid dropped to the reserve, vests grew — measured, not claimed */}
          {postLiquid != null && preLiquid != null && (
            <p className="tnum mt-1 text-[10px] leading-relaxed text-emerald-200/70" dir="ltr">
              chain-verified: liquid {preLiquid} → {postLiquid} STEEM · הרזרבה קיימת אחרי-השידור
            </p>
          )}
        </div>
      )}

      {/* ─── HONEST STATE WHEN NOT ACTING ─── */}
      {!acted && compound.reason && (
        <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          {compound.reason}
        </p>
      )}
      {compound.error && (
        <p className="text-[11px] font-bold leading-relaxed text-rose-400" dir="ltr">
          error: {compound.error}
        </p>
      )}

      {/* ─── THE LAWS — small slate footnotes, exactly as enforced ─── */}
      {Array.isArray(compound.laws) && compound.laws.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-slate-600">
          {compound.laws.map((l, i) => (
            <li key={i}><b className="text-slate-500">חוק:</b> {l}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
