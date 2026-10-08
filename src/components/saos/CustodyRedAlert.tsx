'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * R286 · RED ALERT ENGINE (custody visual rail).
 * The operator's screen IS the alarm: this module polls the custody rail
 * (/api/saos/custody-alert — a thin reader over the engine's measured state)
 * every 20s. Green = the full matrix alive (14/14 + hive + selftest + writer
 * identity + engine pulse). The moment ANY vector drops, the block flips to a
 * solid red state and stays red until the engine itself re-proves health —
 * silence is never health (T-15 law). No external alerting network, no new
 * dependencies: the cockpit's own stack only.
 */

type CustodyAlert = {
  ok: boolean
  asof: string
  status: 'RED' | 'GREEN'
  custody: { verified: number; total: number; verdict: string | null }
  selftest: { pass: number; fail: number; vectors: number } | null
  writer: { verdict: string; git: string; signing: string; tokenExpiresAt: string | null } | null
  agesMin: { army: number | null; engine: number | null; writer: number | null }
  failing: { id: string; label: string; detail: string }[]
  alerts: { at: string | null; kind: string; detail: string }[]
}

const POLL_MS = 20_000

export function CustodyRedAlert() {
  const [data, setData] = useState<CustodyAlert | null>(null)
  const [loading, setLoading] = useState(false)
  const [netErr, setNetErr] = useState(false)
  const [drill, setDrill] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/saos/custody-alert', { cache: 'no-store' })
      const j = (await r.json()) as CustodyAlert
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

  useEffect(() => {
    load()
    timer.current = setInterval(load, POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      if (timer.current) clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  const red = data?.status === 'RED'
  const measuring = !data && !netErr

  /* T-15 lesson: an alarm that was never SEEN firing is an unproven alarm.
   * The drill renders the exact red block with a clearly-labeled synthetic
   * vector; the real RED only ever comes from the custody rail itself. */
  const drillFailing = [{ id: 'drill', label: 'תרגיל-אזעקה (בדיקת-תצוגה)', detail: 'הופעל ידנית מהקוקפיט — אינו אירוע אמיתי' }]
  const showRed = drill || red
  const failingRows = drill && !red ? drillFailing : (data?.failing ?? [])

  const lastCheck = data?.asof ? new Date(data.asof).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null

  return (
    <div
      role={showRed ? 'alert' : 'status'}
      aria-live={showRed ? 'assertive' : 'polite'}
      className={cn(
        'mb-4 rounded-xl border py-0 transition-colors',
        showRed ? 'border-red-700 bg-red-600 text-white shadow-lg shadow-red-900/40' : 'border-emerald-500/30 bg-emerald-500/10',
        !data && 'border-border bg-muted/40',
      )}
    >
      <div className="p-4">
        {measuring && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            מודד את מטריצת-ההחזקה מול ה-state החי…
          </div>
        )}

        {netErr && !data && (
          <div className="flex items-center gap-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            <span>מסילת-האזעקה לא נענתה כרגע — נסה רענון ידני</span>
            <Button size="sm" variant="outline" onClick={load} aria-label="רענון מסילת-האזעקה">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
              רענון
            </Button>
          </div>
        )}

        {data && showRed && (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15">
                  <AlertTriangle className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <p className="text-base font-black tracking-tight">
                    {drill && !red ? 'תרגיל · אזעקת-החזקה (בדיקת-תצוגה, לא אירוע אמיתי)' : `אזעקת-החזקה · המטריצה ירדה ממלואה (${data.custody.verified}/${data.custody.total})`}
                  </p>
                  <p className="mt-0.5 text-xs opacity-90">
                    {drill && !red
                      ? 'זהו תרגיל-תצוגה בלבד — המטריצה עצמה ירוקה והגוף שלם. כך נראית האזעקה ביום אמת.'
                      : 'וקטור-אחד או יותר מתים — הגוף אינו שלם כרגע. הבלוק נשאר אדום עד שהמנוע עצמו יוכיח בריאות מחדש.'}
                  </p>
                </div>
              </div>
              <span className="mt-1 h-3 w-3 shrink-0 animate-pulse rounded-full bg-white" aria-hidden />
            </div>

            <ul className="mt-3 space-y-1.5 text-sm" data-testid="custody-failing">
              {failingRows.map((v) => (
                <li key={v.id} className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-white/10 px-2.5 py-1.5">
                  <span className="font-bold">{v.label}</span>
                  <span className="text-xs opacity-90" dir="auto">{v.detail}</span>
                </li>
              ))}
            </ul>

            {!drill && data.alerts.length > 0 && (
              <p className="mt-2 text-[11px] opacity-80">
                התראות-אפוטרופוס אחרונות · {data.alerts.slice(0, 3).map((a) => a.kind).join(' · ')}
              </p>
            )}

            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] opacity-80">נמדד {lastCheck}</span>
              <div className="flex items-center gap-2">
                {drill && !red && (
                  <Button size="sm" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setDrill(false)}>
                    סיום-תרגיל
                  </Button>
                )}
                <Button size="sm" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={load} aria-label="רענון אזעקת-ההחזקה">
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
                  מדוד שוב
                </Button>
              </div>
            </div>
          </div>
        )}

        {data && !showRed && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-500/40 bg-emerald-500/15">
                <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden />
              </div>
              <div>
                <p className="font-bold text-emerald-300">החזקה מלאה {data.custody.verified}/{data.custody.total} · הכל חי</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {data.custody.verdict ?? '-'} · selftest {data.selftest ? `${data.selftest.pass}/${data.selftest.pass + data.selftest.fail}` : '-'} · זהות-כותב {data.writer?.git ?? '-'} · דופק-מנוע {data.agesMin.engine !== null ? `${data.agesMin.engine} דק` : '-'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">נמדד {lastCheck}</span>
              <Button size="sm" variant="outline" onClick={() => setDrill(true)} title="הצגת-האזעקה עצמה בתרגיל מבוקר">
                תרגיל-אדום
              </Button>
              <Button size="sm" variant="outline" onClick={load} aria-label="רענון אזעקת-ההחזקה">
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
                מדוד
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
