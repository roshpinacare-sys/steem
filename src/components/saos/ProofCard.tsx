'use client'

import { BadgeCheck, CalendarClock, OctagonAlert, Scale, TrendingUp } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-72 · מכשיר-ההוכחה — רווחים-מוכחים (from status.proof).
 * The operator's demand answered on-chain: every settled cent with txids,
 * the machine-era truth separated from the lifetime truth, the DEAD ZONE
 * named in its face, the in-flight money measured per vote, and the first
 * provable dollar as a DATE — or the wall, named.
 * Tone law: PROOF-MEASURED/ON-TRACK → emerald, WALLED/DEAD-ZONE → amber/rose,
 * NO-* → slate; zero blue/indigo.
 */

const usd = (v?: number | null, digits = 2): string => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const sign = v < 0 ? '−' : ''
  return `${sign}$${Math.abs(v).toFixed(digits)}`
}

const num = (v?: number | null, digits = 3): string => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

const verdictTone = (v?: string | null): Tone => {
  const s = v ?? ''
  if (/PROOF-MEASURED|ON-TRACK|MEASURED/i.test(s)) return 'emerald'
  if (/WALLED|DEAD-ZONE|FALSIFIED/i.test(s)) return 'amber'
  if (/FAIL|ERROR/i.test(s)) return 'rose'
  return 'slate'
}

const selfClassLabel = (c?: string | null): string => {
  if (c === 'own') return 'עצמי'
  if (c === 'fleet') return 'צי'
  return 'חיצוני'
}

const dateShort = (d?: string | null): string => (d ? String(d).slice(5, 10) : '—')

export type ProofShape = NonNullable<Status['proof']>

export function ProofCard({ proof }: { proof?: ProofShape | null }) {
  if (!proof) return null
  const eras = proof.eras ?? null
  const inFlight = proof.inFlight ?? null
  const battery = proof.battery ?? null
  const firstDollar = proof.firstDollar ?? null
  const proofs = proof.proofs ?? []
  const deadZone = eras?.deadZone ?? null
  const walled = firstDollar?.verdict === 'WALLED-BELOW-POND'

  return (
    <SectionCard
      icon={BadgeCheck}
      title="רווחים-מוכחים · מכשיר-ההוכחה"
      tone={verdictTone(proof.verdict)}
      meta={proof.law ?? 'כל-שקל עם txid שניתן לבדוק בכל-סייר'}
      actions={<StatusBadge tone={verdictTone(proof.verdict)}>{proof.verdict ?? '—'}</StatusBadge>}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="lifetime — משולם-בשרשרת"
          value={usd(eras?.lifetime?.usd)}
          hint={`${eras?.lifetime?.ops ?? 0} פעולות · ${num(eras?.lifetime?.claimSbd)} SBD · txid-backed`}
          tone="emerald"
        />
        <Stat
          label={`עידן-המכונה (≥${proof.machineEraStart ?? '—'})`}
          value={usd(eras?.machineEra?.usd)}
          hint="בסיס-חלון-המצבת — מתויג בכנות"
          tone="amber"
        />
        <Stat
          label="כסף-בדרך (קיורציה בפוסטים-ממתינים)"
          value={usd(inFlight?.totalUsd)}
          hint={`${inFlight?.rowsTotal ?? 0} הצבעות חיות · חלק-rshares נמדד`}
          tone={typeof inFlight?.totalUsd === 'number' && inFlight.totalUsd > 0 ? 'emerald' : 'slate'}
        />
        <Stat
          label="תשואת-הסוללה הנמדדת"
          value={battery?.verdict === 'MEASURED-BATTERY' ? `${usd(battery.usdPerDay, 3)}/יום` : '—'}
          hint={typeof battery?.aprPct === 'number' ? `APR ≈ ${battery.aprPct.toFixed(1)}%` : 'אין-רגל-מדידה'}
          tone={battery?.verdict === 'MEASURED-BATTERY' ? 'emerald' : 'slate'}
        />
      </div>

      {deadZone && (
        <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${deadZone.verdict === 'DEAD-ZONE-NAMED' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-slate-700/60 bg-slate-900/40 text-slate-400'}`}>
          <span className="font-bold">אזור-המוות נקרא בשמו:</span> הפעולה-המשולמת האחרונה {dateShort(deadZone.lastRewardTs)} — {deadZone.days ?? '—'} ימים ללא-תגמול-משולם. המכונה לא מחקה את החודש הזה; היא מודדת אותו.
        </div>
      )}

      {firstDollar && (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${walled ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          {walled ? <OctagonAlert className="h-3.5 w-3.5" aria-hidden /> : <CalendarClock className="h-3.5 w-3.5" aria-hidden />}
          <span className="font-bold">הדולר-הראשון:</span>
          {firstDollar.firstDollarDate ? (
            <span>
              תאריך נמדד <span className="tnum font-bold">{firstDollar.firstDollarDate}</span>
              {typeof firstDollar.etaDays === 'number' ? ` (בעוד ${firstDollar.etaDays} ימים)` : ''} — ציר-זמן מהכסף-בדרך, לא הבטחה.
            </span>
          ) : (
            <span>
              הציר-הזמן הנמדד לא מגיע לדולר ({usd(firstDollar.horizonCumulativeUsd)} אופק מצטבר) — הקיר נמדד: הבריכות-הגדולות מאחורי שער-ה-credential (מפעיל-בלבד), הפיזיקה של הסוללה נמדדה למעלה.
            </span>
          )}
        </div>
      )}

      {inFlight && (inFlight.rows?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <Scale className="h-3 w-3" aria-hidden /> כסף-בדרך — השורות הגדולות (חלק-rshares נמדד)
          </p>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
            {(inFlight.rows ?? []).map((r, i) => (
              <div key={`${r.key}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-800/70 bg-slate-950/40 px-2 py-1.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-slate-400" dir="ltr" title={r.key ?? ''}>{r.key}</span>
                <span className="shrink-0 rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] text-slate-400">{selfClassLabel(r.selfClass)}</span>
                <span className="tnum shrink-0 text-slate-300" title={`חלק נמדד ${(100 * (r.share ?? 0)).toFixed(2)}%`}>{num(r.expectedSbd, 4)} SBD</span>
                <span className="tnum shrink-0 text-slate-500">{dateShort(r.cashout)}</span>
              </div>
            ))}
          </div>
          {(inFlight.falsifiedShares ?? 0) > 0 && (
            <p className="mt-1 text-[10px] text-amber-400">{inFlight.falsifiedShares ?? 0} שורות נדחו — חלק מחוץ-ל-[0,1] (חוק-הסקאלה) — לא מתומחרות</p>
          )}
        </div>
      )}

      {proofs.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <TrendingUp className="h-3 w-3" aria-hidden /> שורות-ההוכחה האחרונות (txid — לבדיקה בכל-סייר)
          </p>
          <div className="max-h-36 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
            {proofs.slice(0, 8).map((p, i) => (
              <div key={`${p.txid}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-800/70 bg-slate-950/40 px-2 py-1.5 text-[11px]">
                <span className="shrink-0 rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] text-slate-400">{p.kind === 'claim' ? 'תביעה' : p.kind === 'curation' ? 'קיורציה' : p.kind === 'author' ? 'יוצר' : p.kind ?? '—'}</span>
                <span className="tnum min-w-0 flex-1 truncate text-slate-500" dir="ltr" title={p.txid ?? undefined}>{p.txid && p.txid !== '0'.repeat(40) ? `${p.txid.slice(0, 10)}…${p.txid.slice(-6)}` : '—'}</span>
                <span className="tnum shrink-0 text-slate-300">{p.vests ? `${p.vests.toFixed(2)} VESTS` : p.steem ? `${p.steem.toFixed(3)} STEEM` : p.sbd ? `${p.sbd.toFixed(3)} SBD` : '—'}</span>
                <span className="tnum shrink-0 text-slate-500">{dateShort(p.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
