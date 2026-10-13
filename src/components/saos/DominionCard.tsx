'use client'

import { SectionCard } from './SectionCard'
import { Stat } from './Stat'
import { StatusBadge } from './StatusBadge'
import type { Tone } from './tones'
import { Crown } from 'lucide-react'
import type { Status } from './types'

/* §T-68 · DOMINION CARD — the maker-dominance instrument face:
 * the measured pond, our honest share in it, the capture CEILING (never
 * income), the lawful presence plan and the fleet plan. Every number bound
 * to live engine truth — nulls render as honest empties, never zeros. */

type Dominion = NonNullable<Status['dominion']>

const pct = (v?: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const num = (v?: number | null, d = 2) => (v == null ? '—' : v.toFixed(d))
const usd = (v?: number | null) => (v == null ? '—' : `$${v.toFixed(4)}`)

const VERDICT_TONE: Record<string, { tone: Tone; label: string }> = {
  DOMINANT: { tone: 'emerald', label: 'שולט' },
  MAJOR: { tone: 'emerald', label: 'שחקן-גדול' },
  PRESENT: { tone: 'amber', label: 'נוכח' },
  ABSENT: { tone: 'rose', label: 'נעדר' },
  'VENUE-UNMEASURABLE': { tone: 'slate', label: 'השוק-לא-נמדד' },
  'POND-UNMEASURABLE': { tone: 'slate', label: 'הבריכה-לא-נמדדה' },
  'UNDEPLOYED-OPERATOR-GATED': { tone: 'amber', label: 'לא-מופעל · שער-מפעיל' },
  'PONDS-RANKED': { tone: 'emerald', label: 'בריכות-מדורגות' },
  'PONDS-NO-USD': { tone: 'slate', label: 'בריכות-ללא-רגל-דולר' },
  'NO-PONDS': { tone: 'slate', label: 'אין-בריכות' },
  'GUARD-PAUSE-SELL-ONLY': { tone: 'amber', label: 'שמירה · מכירה-בלבד' },
  'OPS-BOUND': { tone: 'amber', label: 'ops כובל' },
  'HEADROOM': { tone: 'emerald', label: 'מקום-לצמיחה' },
  'TOUCH-MEASURED': { tone: 'emerald', label: 'נגיעה-נמדדה' },
  'EMPTY-BOOK': { tone: 'slate', label: 'ספר-ריק' },
  'CROSSED-BOOK': { tone: 'rose', label: 'ספר-חוצה' },
  'SPREAD-INSANE-STALE': { tone: 'slate', label: 'ספר-נטוש' },
  'OPERATOR-GATED-NO-CREDENTIAL': { tone: 'rose', label: 'חסום · אין-credential-Hive' },
  'FLOAT-BELOW-FLOOR': { tone: 'rose', label: 'מלאי-מתחת-לרצפה' },
  ARMABLE: { tone: 'emerald', label: 'מוכן-לחימוש' },
  'FLEET-BRICKED-KEYS-LOST': { tone: 'rose', label: 'הצי-חבוט · מפתחות-אבודים' },
  'PLAN-OK': { tone: 'emerald', label: 'תוכנית-תקינה' },
  'OPS-POOL-BINDS': { tone: 'amber', label: 'בריכת-ops כובלת' },
  'RC-THROTTLE': { tone: 'amber', label: 'RC מצמצם' },
  'OPS-EXHAUSTED': { tone: 'rose', label: 'ops מותשים' },
  'RC-UNMEASURABLE': { tone: 'slate', label: 'RC לא-נמדד' },
}
const toneOf = (v?: string | null) => VERDICT_TONE[v ?? ''] ?? { tone: 'slate' as Tone, label: v ?? '—' }

export function DominionCard({ dominion }: { dominion?: Dominion | null }) {
  const v = toneOf(dominion?.verdict)
  const share = dominion?.share
  const venue = dominion?.venue
  const ours = dominion?.ours
  const capture = dominion?.capture
  const presence = dominion?.presence
  const fleet = dominion?.fleet
  const presenceTone = toneOf(presence?.verdict)
  const fleetTone = toneOf(fleet?.verdict)

  return (
    <SectionCard
      icon={Crown}
      tone="emerald"
      title={<>דומיניון עושה-השוק <span dir="ltr" className="text-slate-500">(T-68)</span></>}
      actions={<StatusBadge tone={v.tone}>{v.label}</StatusBadge>}
    >
      {!dominion ? (
        <p className="text-xs text-slate-500">המכשיר עוד לא מדד — המחזור הבא ירכיב את התמונה מהמדידות.</p>
      ) : (
        <div className="space-y-3">
          {/* הבריכה וחלקנו */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="עסקאות/יום בבריכה" value={venue?.tradesPerDay == null ? '—' : String(venue.tradesPerDay)} />
            <Stat label="ווליום STEEM/יום" value={num(venue?.volSteemPerDay)} ltr />
            <Stat label="מרווח-צמוד" value={venue?.spreadBps == null ? '—' : `${venue.spreadBps.toFixed(0)}bps`} ltr />
            <Stat label="חלק-נפח שלנו" value={pct(share?.volShare)} ltr />
          </div>

          {/* תקרת-הלכידה — תקרה, לא הכנסה */}
          <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-emerald-300">תקרת-הלכידה (המרווח × חלקנו — תקרה-עליונה, לא הכנסה)</span>
              <span dir="ltr" className="text-sm font-semibold text-emerald-200">
                {usd(capture?.usdPerDay)}/day · {num(capture?.steemPerDay, 3)} STEEM
              </span>
            </div>
            {capture?.note && <p className="mt-1 text-[11px] text-slate-400">{capture.note}</p>}
          </div>

          {/* §T-69 · הבריכות-המרובות — הידיים-הגדולות מחזיקות את כל המים */}
          {(dominion?.ranked?.ranked?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-emerald-300">הבריכות-המרובות · תקרות-מדורגות <span dir="ltr">(T-69)</span></span>
                <span dir="ltr" className="text-xs font-semibold text-emerald-200">
                  {dominion?.ranked?.totalCaptureMaxUsdPerDay == null ? '—' : `Σ max $${dominion.ranked.totalCaptureMaxUsdPerDay.toFixed(2)}/day`}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {(dominion?.ranked?.ranked ?? []).map((p) => {
                  const pt = toneOf(p?.verdict)
                  return (
                    <div key={p?.symbol ?? '?'} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
                      <span className="font-mono text-slate-200" dir="ltr">{p?.symbol ?? '—'}</span>
                      <span className="text-slate-400">
                        בריכה <span dir="ltr">{usd(p?.pondUsdPerDay)}</span>/יום · חלקנו <span dir="ltr">{pct(p?.share)}</span> · תקרה-מוחלטת <span dir="ltr">{usd(p?.captureMaxUsdPerDay)}</span>/יום
                      </span>
                      <StatusBadge tone={pt.tone}>{pt.label}</StatusBadge>
                    </div>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">{dominion?.ranked?.law}</p>
            </div>
          )}

          {/* §T-70 · המים-השלישיים — Hive-Engine, נמדד מהספר-החי ומטבלת-העסקאות */}
          {(dominion?.enginePonds?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-emerald-300">המים-השלישיים · Hive-Engine <span dir="ltr">(T-70)</span></span>
                <span className="text-[11px] text-slate-400">האמת מהספר-החי — לא מה-metrics המושהה (ששיקר 13.6× בנמדד)</span>
              </div>
              <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pe-1 [scrollbar-width:thin]">
                {(dominion?.enginePonds ?? []).map((p) => (
                  <div key={p?.symbol ?? '?'} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
                    <span className="font-mono text-slate-200" dir="ltr">{p?.symbol ?? '—'}</span>
                    <span className="text-slate-400">
                      {p?.fills24h == null ? '—' : `${p.fills24h} fills/24h`} · ווליום <span dir="ltr">{num(p?.volHive24h, 0)}</span> SWAP.HIVE · נגיעה <span dir="ltr">{p?.touchBps == null ? '—' : `${p.touchBps.toFixed(0)}bps`}</span>
                    </span>
                    <span className="text-slate-500" dir="ltr">{p?.leaders?.[0] ? `#1 ${p.leaders[0].account} ${pct(p.leaders[0].volShare)}` : p?.error ? `err: ${p.error.slice(0, 24)}` : '—'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">כל בריכה שנמדדה מוסיפה תקרה לדירוג למעלה — ההפעלה עצמה שער-מפעיל (credential + float) תחת אותם חוקי-מייקר.</p>
            </div>
          )}

          {/* §T-69 · טבלת-המייקרים של הבריכה-השנייה — אמת-שרשרת (maker+taker) */}
          {dominion?.hivePond && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300">HBD:HIVE · טבלת-המייקרים <span dir="ltr">(T-69)</span></span>
                <span dir="ltr" className="text-xs text-slate-400">
                  {dominion.hivePond.fills24h == null ? '—' : `${dominion.hivePond.fills24h} fills/24h`} · {dominion.hivePond.leaderCount == null ? '—' : `${dominion.hivePond.leaderCount} makers`}
                </span>
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pe-1 [scrollbar-width:thin]">
                {(dominion.hivePond.leaders ?? []).slice(0, 5).map((l) => (
                  <div key={l?.account ?? '?'} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono text-slate-300" dir="ltr">{l?.account ?? '—'}</span>
                    <span className="text-slate-400" dir="ltr">{num(l?.hiveVol, 0)} HIVE · {pct(l?.volShare)}</span>
                  </div>
                ))}
                {(dominion.hivePond.leaders?.length ?? 0) === 0 && <p className="text-[11px] text-slate-500">הטבלה עוד לא נמדדה — המחזור הבא ימדוד את הבריכה מהשרשרת.</p>}
              </div>
              <p className="mt-1.5 text-[11px] text-amber-300/90">
                אנחנו: {dominion.hivePond.ours ? 'על-הספר' : 'לא-על-הספר (אין credential)'} · המוביל-#1 מחזיק <span dir="ltr">{pct(dominion.hivePond.top1VolShare)}</span> מהווליום
              </p>
              {dominion.hivePond.basis && <p className="mt-0.5 text-[10px] text-slate-500">{dominion.hivePond.basis}</p>}
            </div>
          )}

          {/* §T-69 · תוכנית-החימוש של הבריכה-השנייה — מפתח = שער-בלתי-הפיך */}
          {dominion?.hiveArmPlan && (
            <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-amber-300">Hive · תוכנית-החימוש ליום-הראשון</span>
                <StatusBadge tone={toneOf(dominion.hiveArmPlan.verdict).tone}>{toneOf(dominion.hiveArmPlan.verdict).label}</StatusBadge>
              </div>
              {Array.isArray(dominion.hiveArmPlan.unlock) && dominion.hiveArmPlan.unlock.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
                  {dominion.hiveArmPlan.unlock.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
              {dominion.hiveArmPlan.verdict === 'ARMABLE' && (
                <p className="mt-1 text-[11px] text-emerald-300/90">רמות: {dominion.hiveArmPlan.levels ?? '—'} · גודל/רמה: <span dir="ltr">{num(dominion.hiveArmPlan.perLevelHive, 3)}</span> HIVE</p>
              )}
              <p className="mt-1 text-[10px] text-slate-500">{dominion.hiveArmPlan.law}</p>
            </div>
          )}

          {/* §T-70 · תוכנית-הווליום — מילויים ברי-השגה ומה כובל */}
          {dominion?.volumePlan && (
            <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-emerald-300">תוכנית-הווליום · הבריכה-הפעילה <span dir="ltr">(T-70)</span></span>
                <StatusBadge tone={toneOf(dominion.volumePlan.verdict).tone}>{toneOf(dominion.volumePlan.verdict).label}</StatusBadge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="מילויים-צפויים/יום" value={dominion.volumePlan.expectedFillsPerDay == null ? '—' : String(dominion.volumePlan.expectedFillsPerDay)} ltr />
                <Stat label="תקרת-מילויים (הבריכה)" value={dominion.volumePlan.fillsCeilingPerDay == null ? '—' : String(dominion.volumePlan.fillsCeilingPerDay)} ltr />
                <Stat label="חלקנו-הנמדד" value={pct(dominion.volumePlan.share)} ltr />
                <Stat label="ops-בשימוש" value={dominion.volumePlan.opsPct == null ? '—' : `${(dominion.volumePlan.opsPct * 100).toFixed(2)}%`} ltr />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                להצבה: {dominion.volumePlan.plan?.asksToPlace ?? '—'} אסקים · {dominion.volumePlan.plan?.bidsToPlace ?? '—'} בידים
                {dominion.volumePlan.paused && <span className="text-rose-300"> · הקנייה מושהית-משמר — הווליום כרגע מכירה-בלבד</span>}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">{dominion.volumePlan.law}</p>
            </div>
          )}

          {/* הזרימה שלנו (חלק-מינימום) + תוכנית-הנוכחות */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="מילויים/24ש (מינימום)" value={ours?.fills24h == null ? '—' : String(ours.fills24h)} hint={ours?.partialBasis} ltr />
            <Stat label="ווליום/24ש שלנו" value={num(ours?.vol24h)} ltr />
            <Stat label="רצפות-מכירה חיות" value={presence?.liveAsks == null ? '—' : String(presence.liveAsks)} />
            <Stat label="רצפות-קנייה חיות" value={presence?.liveBids == null ? '—' : String(presence.liveBids)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <StatusBadge tone={presenceTone.tone}>נוכחות-חוקית: {presenceTone.label}</StatusBadge>
            <span className="text-slate-400">יעד: {presence?.askTarget ?? '—'} אסקים · {presence?.bidTarget ?? '—'} בידים</span>
            {presence?.guard === 'PAUSE-FLOW' && <span className="text-rose-300">הקנייה מושהית-משמר (חוק-ההפסד-הנמדד) — המכירה ממשיכה</span>}
            {presence?.opsRemaining != null && <span className="text-slate-500">ops-נותרים היום: {presence.opsRemaining.toLocaleString()}</span>}
          </div>

          {/* הצי — תוכנית-מפעיל */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300">צי-הגרידים · נוכחות-רבת-מחיר</span>
              <StatusBadge tone={fleetTone.tone}>{fleetTone.label}</StatusBadge>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {fleet?.alive != null && <>חיילים-חיים (אומת-credential): {fleet.alive} · </>}
              {fleet?.presenceLevels != null && <>רצפות-פוטנציאל: {fleet.presenceLevels} · </>}
              {fleet?.opsPerDay != null && <>ops/יום: {fleet.opsPerDay}</>}
            </p>
            {fleet?.note && <p className="mt-1 text-[11px] text-amber-300/90">{fleet.note}</p>}
            <p className="mt-1 text-[10px] text-slate-500">{fleet?.law}</p>
          </div>

          {/* §T-70 · השאילות-הריבוניות — הריבונות שואלת את עצמה, וכל תשובה מדידה */}
          {(dominion?.inquiries?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300">השאילות-הריבוניות <span dir="ltr">(T-70)</span></span>
                <span className="text-[11px] text-slate-500">שאלה-נמדדה-עם-תשובה — לא ניחוש</span>
              </div>
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pe-1 [scrollbar-width:thin]">
                {(dominion?.inquiries ?? []).map((q) => {
                  const st = q?.status === 'OPEN-OPERATOR'
                    ? { tone: 'amber' as Tone, label: 'שער-מפעיל' }
                    : q?.status === 'NEXT-RUNG'
                      ? { tone: 'slate' as Tone, label: 'מדרגה-הבאה' }
                      : { tone: 'emerald' as Tone, label: 'נמדד' }
                  return (
                    <div key={q?.id ?? '?'} className="rounded-md border border-slate-800/60 bg-slate-950/40 p-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-[11px] font-medium text-slate-200">{q?.q ?? '—'}</p>
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      </div>
                      {q?.answer && <p className="mt-1 text-[11px] text-slate-400">{q.answer}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <p className="text-[10px] text-slate-500">{dominion?.law}</p>
        </div>
      )}
    </SectionCard>
  )
}
