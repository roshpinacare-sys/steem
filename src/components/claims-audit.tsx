'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, RefreshCw, ShieldQuestion } from 'lucide-react'

/* R218-b · Step 2 of the approved plan: CLAIMS-AUDITOR card.
 * Productized R217: the page no longer trusts itself — an independent organ
 * recomputes every data-layer claim from ground truth (state files + the
 * metrics time-series DB) and compares against what /api/saos/status serves.
 * Verdicts: MATCH | DRIFT | STALE | UNMEASURABLE. Scope note below is honest:
 * static TEXT claims in the page are audited by human orchestrator rounds. */

type Claim = { id: string; label: string; verdict: 'MATCH' | 'DRIFT' | 'STALE' | 'UNMEASURABLE'; expected: string; actual: string; detail: string }
type AuditPayload = {
  ok: boolean
  ran?: boolean
  runId?: string
  at?: string
  ageSec?: number
  counts?: { MATCH?: number; DRIFT?: number; STALE?: number; UNMEASURABLE?: number }
  claims?: Claim[]
  note?: string
  verdict?: string
}

function fmtClock(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}

const VERDICT_STYLE: Record<Claim['verdict'], string> = {
  MATCH: 'bg-emerald-500/10 text-emerald-300',
  DRIFT: 'bg-rose-500/10 text-rose-300',
  STALE: 'bg-amber-500/10 text-amber-300',
  UNMEASURABLE: 'bg-slate-700/40 text-slate-400',
}

export default function ClaimsAudit() {
  const [data, setData] = useState<AuditPayload | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const load = useCallback(async (force = false) => {
    setBusy(true)
    try {
      const r = await fetch('/api/saos/audit', { method: force ? 'POST' : 'GET', cache: 'no-store' })
      const j = (await r.json()) as AuditPayload
      if (j.ok) {
        setData(j)
        setState('ok')
      } else {
        setData(j)
        setState('down')
      }
    } catch {
      setState('down')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => load(), 300_000) /* audits move slowly — 5min */
    return () => clearInterval(t)
  }, [load])

  const counts = data?.counts
  const claims = data?.claims ?? []
  const problems = claims.filter((c) => c.verdict === 'DRIFT' || c.verdict === 'STALE')
  const matches = claims.filter((c) => c.verdict === 'MATCH').length
  const unmeas = claims.filter((c) => c.verdict === 'UNMEASURABLE')
  const allGreen = problems.length === 0 && state === 'ok'

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className={`h-4 w-4 ${allGreen ? 'text-emerald-400' : 'text-amber-400'}`} aria-hidden />
          <h4 className="text-sm font-semibold text-slate-200">ביקורת-טענות · הדף מול האמת <span dir="ltr" className="text-slate-500">(R218-b)</span></h4>
        </div>
        <div className="flex items-center gap-2">
          {state === 'ok' && data?.at && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${allGreen ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`} dir="ltr">
              audited {fmtClock(data.at)} · age {data.ageSec}s
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
            aria-label="הרצת-ביקורת עכשיו"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {busy ? 'בודק…' : 'ביקורת-עכשיו'}
          </button>
        </div>
      </div>

      {state === 'down' ? (
        <p className="mt-3 text-xs text-amber-300/90">{data?.note ?? 'ביקורת אינה זמינה כרגע — אין להציג תוצאות שלא נמדדו.'}</p>
      ) : !counts ? (
        <p className="mt-3 animate-pulse text-xs text-slate-500">מריץ ביקורת-ראשונה (משווה את מה שהדף מציג מול קבצי-האמת)…</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-300">{counts.MATCH ?? 0} תואמות</span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${(counts.DRIFT ?? 0) > 0 ? 'bg-rose-500/10 text-rose-300' : 'bg-slate-800 text-slate-400'}`}>{counts.DRIFT ?? 0} סטיות</span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${(counts.STALE ?? 0) > 0 ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{counts.STALE ?? 0} מיושנות</span>
            <span className="rounded-full bg-slate-800 px-2.5 py-1 font-medium text-slate-400">{counts.UNMEASURABLE ?? 0} מחוץ-לטווח</span>
          </div>

          {problems.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {problems.map((c) => (
                <li key={c.id} className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-amber-200">{c.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${VERDICT_STYLE[c.verdict]}`} dir="ltr">{c.verdict}</span>
                  </div>
                  <div className="mt-1 text-slate-400" dir="ltr">expected {c.expected} · actual {c.actual}</div>
                  {c.detail && <div className="mt-0.5 text-slate-500">{c.detail}</div>}
                </li>
              ))}
            </ul>
          )}

          {allGreen && (
            <p className="mt-3 text-xs text-emerald-300/90">
              כל {matches} הטענות-הנמדדות תואמות לאמת-המקור — הדף מספר את-האמת בשכבת-הנתונים.
            </p>
          )}

          <button
            onClick={() => setOpen(!open)}
            className="mt-2 text-[11px] text-slate-500 underline-offset-2 transition-colors hover:text-slate-300 hover:underline"
            aria-expanded={open}
          >
            {open ? 'הסתר פירוט' : `פירוט ${claims.length} טענות (${unmeas.length} מחוץ-לטווח)`}
          </button>
          {open && (
            <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[11px]">
              {claims.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 border-b border-slate-900 py-1 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-300">{c.label}</div>
                    <div className="truncate text-slate-500" dir="ltr">{c.id} · exp {c.expected} · act {c.actual}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${VERDICT_STYLE[c.verdict]}`} dir="ltr">{c.verdict}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[10px] text-slate-500">
            טווח: שכבת-הנתונים (state → מנוע → פרוקסי → דף) + ביקורת-עצמית של טבלת-הזמן · סטיות מאומרות רק אחרי קריאה-שנייה (two-strike) · ריצה אוטומטית כל 6 שע' + ביקוש · טענות-טקסט סטטיות בדף נבדקות בראונדי-ביקורת.
          </p>
        </>
      )}
    </div>
  )
}
