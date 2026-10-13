'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Landmark, RefreshCw, ScrollText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'

/**
 * R288 · THE YIELD + FINANCE DIGEST RAIL (the operator's view of both new
 * answer-in-code rails). Polls /api/saos/yield (a thin reader over the
 * engine's own measured state) every 60s:
 *  · digest rail — telemetry → deterministic digest → revenue-intake →
 *    compileRevenue → BROADCAST-READY (operator question #1, answered YES)
 *  · yield rail — pool = liquid − operating floor → policy plan → custody
 *    gate → dust rollback → executeAs staging (operator question #2)
 * The cockpit owns no keys and no logic; execution stays engine-side.
 */

type Digest = {
  state: string
  ageMin: number | null
  verdict: string | null
  slot: number | null
  maxPerDay: number | null
  digestId: string | null
  title: string | null
  words: number | null
  bytes: number | null
  chain: string | null
  compileVerdict: string | null
  law: string | null
}

type Transfer = { to: string; amount: number | null; asset: string }
type ExecRow = Transfer & { verdict: string | null; ok: boolean; txid: string | null }

type Rail = {
  state: string
  ageMin: number | null
  verdict: string | null
  treasury: string | null
  custody: string | null
  reasons: string[] | null
  liquidMeasured: { steem: number | null; sbd: number | null }
  pool: { steem: number | null; sbd: number | null }
  perShare: number | null
  perShareSbd: number | null
  plannedTotal: number | null
  reserveSteem: number | null
  reserveSbd: number | null
  rosterSize: number | null
  deferred: number | null
  invariantOk: boolean
  executedToday: number | null
  transfers: Transfer[]
  executed: ExecRow[]
  policy: Record<string, unknown> | null
  law: string | null
}

type YieldState = {
  ok: boolean
  digest: Digest | null
  rail: Rail | null
  audit: Record<string, unknown>[]
  law: string
}

const POLL_MS = 60_000
const n = (v: number | null | undefined, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—')

export function YieldCard() {
  const [data, setData] = useState<YieldState | null>(null)
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [netErr, setNetErr] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/saos/yield', { cache: 'no-store' })
      const j = (await r.json()) as YieldState
      if (j?.ok) {
        setData(j)
        setNetErr(false)
      }
    } catch {
      setNetErr(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const rebuild = useCallback(async () => {
    setRebuilding(true)
    try {
      await fetch('/api/saos/yield', { method: 'POST' })
      await load()
    } catch {
      setNetErr(true)
    } finally {
      setRebuilding(false)
    }
  }, [load])

  useEffect(() => {
    load()
    timer.current = setInterval(load, POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  const d = data?.digest ?? null
  const rail = data?.rail ?? null
  const digestLive = d?.state === 'LIVE'
  const railLive = rail?.state === 'LIVE'
  const frozen = rail ? rail.verdict === 'CUSTODY-FROZEN' : false
  const ready = rail?.verdict === 'READY'

  return (
    <Card className={cn('py-0 backdrop-blur-sm', frozen ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60')}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <Landmark className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-300">מסילת-התשואה · אוצר-ודיגסט <span dir="ltr" className="text-slate-500">(R288)</span></p>
              <p className="text-[11px] text-slate-500">טלמטריה → דיגסט → מאגר · מאגר-נזיל → תוכנית-חלוקה → שער-קוסטודיה</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={railLive ? (frozen ? 'amber' : 'emerald') : rail ? 'amber' : 'rose'} solid pulse={railLive}>
              {rail ? (rail.verdict ?? 'MEASURED') : 'מנותק'}
            </StatusBadge>
            <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="רענון מסילת-התשואה" className="h-11 w-11 border-slate-700 hover:bg-slate-800">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={d ? (digestLive ? 'emerald' : 'amber') : 'rose'} solid>
            דיגסט {d ? (d.verdict === 'DIGEST-READY' ? 'נערך' : d.verdict === 'COOLDOWN' ? 'מצנן' : (d.verdict ?? '—')) : 'חסר'}
          </StatusBadge>
          <StatusBadge tone="slate">
            <span dir="ltr">{d?.slot != null ? `slot ${d.slot}/${d.maxPerDay ?? 2}` : 'slot —'}</span>
          </StatusBadge>
          <StatusBadge tone={ready ? 'emerald' : 'slate'} title="מאגר נזיל מעל רצפת-ההפעלה">
            מאגר <span dir="ltr" className="tnum">{rail?.pool?.steem != null ? `${n(rail.pool.steem)} STEEM` : '—'}</span>
          </StatusBadge>
          <StatusBadge tone={frozen ? 'amber' : 'emerald'} title="שער-הקוסטודיה: לא 14/14 → אפס-תנועות">
            {rail?.custody ?? 'שער-לא-ידוע'}
          </StatusBadge>
          <StatusBadge tone="slate">
            רזרבה <span dir="ltr" className="tnum">{rail?.reserveSteem != null ? `${n(rail.reserveSteem)}` : '—'}</span>
          </StatusBadge>
        </div>

        {rail?.reasons?.length ? (
          <p className="mt-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-[11px] text-amber-300/90" role="note">
            פוליסה-פגומה נדחית-סגורה <span dir="ltr">{rail.reasons.join(' · ')}</span> — אפס-תנועות עד-תיקון.
          </p>
        ) : null}

        {frozen && (
          <p className="mt-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-[11px] leading-relaxed text-amber-300/90">
            שער-הקוסטודיה אדום — מנוע-החלוקה קפוא: המאגר נמדד והתוכנית מחושבת, אך אפס-העברות עד שהצי יוכיח 14/14 מחדש.
          </p>
        )}

        {!!rail?.transfers?.length && (
          <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pe-1" role="list" aria-label="העברות-מתוכננות">
            {rail.transfers.map((t, i) => (
              <div key={`${t.to}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2" role="listitem">
                <div className="flex min-w-0 items-center gap-2">
                  <ScrollText className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                  <p className="min-w-0 truncate text-xs text-slate-200" dir="ltr">{t.to}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[10px] text-slate-400">
                  <span dir="ltr" className="tnum">{n(t.amount)} {t.asset}</span>
                  <StatusBadge tone="slate" className="text-[10px]">מתוכנן</StatusBadge>
                </div>
              </div>
            ))}
          </div>
        )}

        {!!rail?.executed?.length && (
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pe-1" role="list" aria-label="העברות-בוצעו">
            {rail.executed.map((e, i) => (
              <div key={`${e.to}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-[10px]" role="listitem">
                <span dir="ltr" className="tnum truncate text-slate-300">{e.to} · {n(e.amount)} {e.asset}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span dir="ltr" className="tnum text-slate-500">{e.txid ? e.txid.slice(0, 16) : '—'}</span>
                  <StatusBadge tone={e.ok ? 'emerald' : 'rose'} className="text-[10px]">{e.verdict ?? 'UNKNOWN'}</StatusBadge>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid gap-2 text-[11px] leading-relaxed text-slate-500 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
            <p className="font-semibold text-slate-300">דיגסט-אחרון</p>
            <p className="mt-0.5 truncate" dir="ltr">{d?.title ?? '—'}</p>
            <p className="mt-0.5">
              <span dir="ltr" className="tnum">{d?.words ?? '—'} words · {d?.bytes ?? '—'}B</span>
              {d?.compileVerdict && <> · קומפילציה <span dir="ltr" className="tnum">{d.compileVerdict}</span></>}
              {d?.chain && <> · <span dir="ltr">{d.chain}</span></>}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
            <p className="font-semibold text-slate-300">מדידה-וחלוקה</p>
            <p className="mt-0.5">
              נזיל <span dir="ltr" className="tnum">{n(rail?.liquidMeasured?.steem)} / {n(rail?.liquidMeasured?.sbd)}</span>
              · מניות <span dir="ltr" className="tnum">{n(rail?.perShare)}</span>
              · תור {rail?.deferred ?? 0}
              · היום {rail?.executedToday ?? 0}
            </p>
            <p className="mt-0.5">
              אינווריאנטה <StatusBadge tone={rail?.invariantOk ? 'emerald' : 'amber'} className="text-[10px]">{rail?.invariantOk ? 'שקולה' : 'לא-מוכחת'}</StatusBadge>
              · צי <span dir="ltr" className="tnum">{rail?.rosterSize ?? '—'}</span> ארנקים
            </p>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          {rail?.law ?? data?.law ?? 'מאגר = נזיל מעל רצפת-ההפעלה; שער-הקוסטודיה קודם; אבק-שוחה חוזר-לרזרבה; ביצוע רק דרך executeAs של-המנוע עם שער-החשיבה.'}
          {netErr && <span className="text-rose-400"> · שגיאת-רשת, מציג נתון-אחרון</span>}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={rebuild} disabled={rebuilding} className="h-9 border-slate-700 text-xs hover:bg-slate-800">
            <RefreshCw className={cn('me-1.5 h-3.5 w-3.5', rebuilding && 'animate-spin')} aria-hidden />
            קומפילציית-דיגסט
          </Button>
          <span className="text-[10px] text-slate-600">
            ביצוע-העברות חי-רק בנתיב POST /yield-run של-המנוע (שער-חשיבה + שער-קוסטודיה בבעלות-החותם) — לקוקפיט אין מפתחות ואין היגיון-משלו.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
