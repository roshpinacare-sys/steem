'use client'

import { Fuel } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-22f · מיכל-ה-RC — the measured 100,000× scaling curve (from status.rcTank).
 * The engine measures maxRc/ops-day on-chain (one-body law); this card only renders.
 * Sparkline = pure CSS bars, heights ∝ opsPerDay — NO chart library, honest pixels.
 * Tone law: emerald card; growth green>0 / rose<0; zero blue/indigo.
 */

/** compact measured units — 6,138,717,856,759 → 6.14T */
const compact = (v?: number | null): string => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

const full = (v?: number | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : '—'

const verdictTone = (v?: string | null): Tone => {
  const s = v ?? ''
  if (/measur/i.test(s)) return 'emerald'
  if (/gate|pend|wait|hold/i.test(s)) return 'amber'
  if (/fail|error|down/i.test(s)) return 'rose'
  return 'slate'
}

export function RcTankCard({ rcTank }: { rcTank: Status['rcTank'] }) {
  if (!rcTank) return null

  const hist = (rcTank.history ?? []).slice(-30)
  const maxOps = Math.max(1, ...hist.map((p) => p.opsPerDay ?? 0))
  const growth = rcTank.growthPct

  return (
    <SectionCard
      icon={Fuel}
      tone="emerald"
      className="md:col-span-2 lg:col-span-3"
      title={<>מיכל-ה-RC · עקומת-הנשימה המדודה <span dir="ltr" className="text-slate-500">(T-22)</span></>}
      actions={
        <>
          {rcTank.verdict && (
            <StatusBadge tone={verdictTone(rcTank.verdict)} solid title={rcTank.verdict}>
              {rcTank.verdict}
            </StatusBadge>
          )}
          {rcTank.day && <span className="tnum text-[10px] text-slate-500" dir="ltr">{rcTank.day}</span>}
        </>
      }
      meta="רייאקט-קרדיט הוא ריאות-המכונה: נמדד מול-השרשרת יום-יום — העקומה מדודה, לא מובטחת."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="מקס-RC (מדוד)"
          value={compact(rcTank.maxRc)}
          tone="emerald"
          ltr
          hint={typeof rcTank.maxRc === 'number' ? rcTank.maxRc.toLocaleString('en-US') : undefined}
        />
        <Stat label="שווי-משקל ops/יום" value={full(rcTank.opsPerDayEquilibrium)} tone="emerald" ltr hint="תקורת-הנשימה השוטפת" />
        <Stat
          label="צמיחה יומית"
          value={growth == null ? '—' : `${growth > 0 ? '+' : ''}${growth.toFixed(2)}%`}
          tone={growth == null ? 'slate' : growth > 0 ? 'emerald' : 'rose'}
          ltr
          hint={
            growth == null
              ? 'יום-מדידה ראשון — אין בסיס-השוואה'
              : rcTank.prevDayMaxRc != null
                ? `בסיס: ${compact(rcTank.prevDayMaxRc)}`
                : undefined
          }
        />
        <Stat label="RC זמין" value={rcTank.rcPct != null ? `${rcTank.rcPct}%` : '—'} tone="emerald" ltr />
      </div>

      {hist.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-500">היסטוריית ops/יום</span>
            <span className="tnum text-[10px] text-slate-600">{hist.length} ימי-מדידה · שיא {full(maxOps)}</span>
          </div>
          <div
            dir="ltr"
            role="img"
            aria-label={`היסטוריית ops/יום — ${hist.length} ימי-מדידה, שיא ${full(maxOps)}`}
            className="mt-2 flex h-16 items-end gap-1"
          >
            {hist.map((p, i) => {
              const pct = Math.max(6, Math.round(((p.opsPerDay ?? 0) / maxOps) * 100))
              return (
                <div
                  key={`${p.day ?? 'day'}-${i}`}
                  className="flex h-full min-w-[3px] flex-1 items-end"
                  title={`${p.day ?? '—'} · maxRC ${compact(p.maxRc)} · ${full(p.opsPerDay)} ops/יום`}
                >
                  <div
                    className="w-full rounded-t-sm bg-gradient-to-t from-emerald-500/40 to-emerald-400/90 transition-colors hover:to-emerald-300"
                    style={{ height: `${pct}%` }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {rcTank.scalingLaw && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{rcTank.scalingLaw}</p>}
    </SectionCard>
  )
}
