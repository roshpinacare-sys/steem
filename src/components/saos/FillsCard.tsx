'use client'

import { Activity } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { Stat } from './Stat'
import type { FillsRow, Status } from './types'

type Observe = NonNullable<Status['observe']>
type FloatGate = NonNullable<NonNullable<Status['economics']>['floatGate']>

/**
 * T-62 · כרטיס-המילויים — THE PER-FILL LEDGER + THE FLOAT GATE.
 * History: measureAll enumerated every fill and only the aggregate ever
 * persisted — the /live consumer had nothing to consume (TODO: "fills
 * per-fill ledger consumerless") and economics.mjs read observe.fillsRows
 * that never existed. This card is the born consumer: the rows behind the
 * count, judged IN PUBLIC — the fill-flow re-measure window (the next 24h
 * fills/day vs the 0.0239 baseline) now has its instrument.
 * Tone law: the float gate strip colors the verdict (UNLOCKED emerald /
 * ON-TRACK amber / STALLED slate); every number is engine-computed and
 * rendered verbatim (the number-truth law). Dormant law: no rows and no
 * gate → render nothing.
 */

const hhmm = (iso?: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(11, 16)
}

const gateTone = (v?: string | null): 'emerald' | 'amber' | 'slate' =>
  v === 'UNLOCKED' ? 'emerald' : v === 'ON-TRACK' ? 'amber' : 'slate'

const gateLabel: Record<string, string> = {
  UNLOCKED: 'סולם-המכירות פתוח',
  'ON-TRACK': 'בדרך-לפתיחה',
  STALLED: 'עצור — אין-היקף-קניות',
}

export function FillsCard({
  observe,
  floatGate,
  offer,
}: {
  observe: Observe | null | undefined
  floatGate: FloatGate | null | undefined
  offer?: Status['offer']
}) {
  const rows: FillsRow[] = observe?.fillsRows ?? []
  const gate = floatGate ?? null
  /* §71b · the basis-trust strip rides the offer marks (engine-computed) */
  const basisTrust = offer?.marks?.basisTrust ?? null
  /* dormant law: nothing measured yet → nothing rendered */
  if (!rows.length && !gate && !basisTrust) return null

  return (
    <SectionCard
      icon={Activity}
      tone="emerald"
      className="md:col-span-2 lg:col-span-3"
      title={<>פנקס-המילויים · שורות-הספר שלנו <span dir="ltr" className="text-slate-500">(T-62)</span></>}
      meta="כל מילוי שנסגר על-הספר — השורות מאחורי-המספר; חלון-המדידה של-זרימת-המילויים נשפט כאן, בפומבי."
    >
      {/* ─── THE FLOAT GATE — the ask ladder's lawfulness, dated ─── */}
      {gate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span
            className={`rounded px-2 py-0.5 text-[11px] font-bold tnum ${
              gateTone(gate.verdict) === 'emerald'
                ? 'bg-emerald-500/15 text-emerald-300'
                : gateTone(gate.verdict) === 'amber'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-slate-500/15 text-slate-300'
            }`}
            dir="ltr"
          >
            {gate.verdict ?? '—'}
          </span>
          <span className="text-xs font-bold text-slate-200">{gateLabel[gate.verdict ?? ''] ?? 'שער-הצף'}</span>
          <span className="text-[11px] text-slate-400" dir="ltr">
            {typeof gate.perLevelSteem === 'number' ? `${gate.perLevelSteem.toFixed(3)}` : '—'}
            {' / '}
            {typeof gate.minLevel === 'number' ? gate.minLevel.toFixed(3) : '—'} STEEM·level
          </span>
          {gate.verdict === 'ON-TRACK' && typeof gate.etaDays === 'number' && (
            <span className="text-[11px] text-amber-300" dir="ltr">
              ETA ≈ {gate.etaDays}d
            </span>
          )}
          {gate.verdict === 'ON-TRACK' && gate.etaDays == null && (
            <span className="text-[11px] text-slate-500">ETA — אין-מדידת-היקף</span>
          )}
        </div>
      )}

      {/* ─── THE POST-MORTEM (T-63, audit 2-b#14): the strongest honest
       * evidence of the maker's edge — FIFO pairs, buy-vs-sell avg px, the
       * typed loss class — was computed every cycle and rendered NOWHERE. */}
      {observe?.postMortem && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span
            className={`rounded px-2 py-0.5 text-[11px] font-bold ${
              observe.postMortem.lossClass === 'healthy'
                ? 'bg-emerald-500/15 text-emerald-300'
                : observe.postMortem.lossClass === 'trend-adverse'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-rose-500/15 text-rose-300'
            }`}
            dir="ltr"
          >
            {observe.postMortem.lossClass ?? '—'}
          </span>
          <span className="text-[11px] text-slate-400" dir="ltr">
            {observe.postMortem.pairs ?? 0} FIFO pairs · buy {typeof observe.postMortem.buyAvgPx === 'number' ? observe.postMortem.buyAvgPx.toFixed(6) : '—'} / sell {typeof observe.postMortem.sellAvgPx === 'number' ? observe.postMortem.sellAvgPx.toFixed(6) : '—'}
          </span>
          <span className="text-[11px] text-slate-400">
            {observe.postMortem.lossClass === 'healthy' ? 'בריא' : observe.postMortem.lossClass === 'trend-adverse' ? 'פגיעה-כיוונית — הפאריטי זז תחת-הסולם' : observe.postMortem.lossClass === 'spread-negative' ? 'תמחור-סולם' : '—'}
          </span>
        </div>
      )}

      {/* ─── §71b · BASIS-TRUST — the ask side sells only on a believable
       * basis: UNTRUSTED / NO-BASIS-ON-LOSS block the asks, LOW-CONFIDENCE
       * rides flagged, TRUSTED rides clean. The bleed's last blind hole. ─── */}
      {basisTrust && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span
            className={`rounded px-2 py-0.5 text-[11px] font-bold tnum ${
              basisTrust.verdict === 'TRUSTED'
                ? 'bg-emerald-500/15 text-emerald-300'
                : basisTrust.verdict === 'LOW-CONFIDENCE' || basisTrust.verdict === 'NO-POSITION'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-rose-500/15 text-rose-300'
            }`}
            dir="ltr"
          >
            {basisTrust.verdict ?? '—'}
          </span>
          <span className="text-xs font-bold text-slate-200">אמון-הבסיס · צד-המכירה {basisTrust.asksAllowed ? 'רשאי' : 'חסום'}</span>
          {typeof basisTrust.unbasedSharePct === 'number' && (
            <span className="tnum text-[11px] text-slate-400" dir="ltr">unbased {basisTrust.unbasedSharePct}%</span>
          )}
          <span className="text-[11px] text-slate-500" dir="ltr">{basisTrust.reason ?? ''}</span>
        </div>
      )}

      {/* ─── SUMMARY TILES ─── */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat
          label="מילויים בחלון"
          value={observe?.fills != null ? String(observe.fills) : '—'}
          tone="emerald"
          ltr
          hint={observe?.lastFillAt ? `מילוי-אחרון ${hhmm(observe.lastFillAt)} UTC` : undefined}
        />
        <Stat
          label="קניות / מכירות"
          value={
            observe?.pnl
              ? `${observe.pnl.buys ?? '—'} / ${observe.pnl.sells ?? '—'}`
              : '—'
          }
          ltr
        />
        <Stat
          label="מומשל (חלון)"
          value={
            typeof observe?.pnl?.realizedSbd === 'number'
              ? `${observe.pnl.realizedSbd >= 0 ? '+' : ''}${observe.pnl.realizedSbd.toFixed(4)} SBD`
              : '—'
          }
          tone={typeof observe?.pnl?.realizedSbd === 'number' && observe.pnl.realizedSbd < 0 ? 'rose' : 'emerald'}
          ltr
          hint="FIFO על-השורות — השומר-מעשה קורא את-אותו-פנקס"
        />
      </div>

      {/* ─── THE LEDGER (long-list law: capped scroll) ─── */}
      {rows.length > 0 && (
        <div className="mt-3 max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40 [scrollbar-width:thin]">
          <table className="w-full min-w-[320px] border-collapse tnum">
            <thead className="sticky top-0 bg-slate-950/95 backdrop-blur-sm">
              <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                <th scope="col" className="px-3 py-2 text-start font-medium">שעה (UTC)</th>
                <th scope="col" className="px-3 py-2 text-center font-medium">צד</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">STEEM</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">SBD</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">מחיר</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r, i) => (
                <tr key={`${r.at ?? '—'}-${i}`} className="hover:bg-slate-900/40">
                  <td className="px-3 py-1.5 text-start text-xs text-slate-300" dir="ltr">{hhmm(r.at)}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        r.side === 'bid' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                      }`}
                      dir="ltr"
                    >
                      {r.side === 'bid' ? 'קנייה' : 'מכירה'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-end text-xs font-bold text-slate-100" dir="ltr">
                    {typeof r.steem === 'number' ? r.steem.toFixed(3) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-end text-xs text-slate-300" dir="ltr">
                    {typeof r.sbd === 'number' ? r.sbd.toFixed(3) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-end text-xs text-slate-400" dir="ltr">
                    {typeof r.px === 'number' ? r.px.toFixed(6) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gate?.law && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{gate.law}</p>}
    </SectionCard>
  )
}
