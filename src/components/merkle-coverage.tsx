'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2, RefreshCw } from 'lucide-react'

/* R218-c · Step 3 of the approved plan: MERKLE EVENT ANCHORING card.
 * The event stream gets folded into a cumulative SHA-256 chain of per-batch
 * Merkle roots; the record is committed by the custodian's existing sweep and
 * witnessed by its existing hourly tip anchor on Steem. This card shows the
 * local integrity verdict (recomputed from raw bytes) + chain coverage. */

type MerklePayload = {
  ok: boolean
  verdict?: 'VERIFIED' | 'BROKEN' | 'NO-RECORD' | 'ORGAN-DOWN' | 'MERKLE-UNRESPONSIVE'
  detail?: string
  algo?: string
  anchored?: boolean
  reason?: string | null
  checkedBatches?: number
  coverage?: { totalEvents: number; anchored: number; pending: number }
  record?: {
    genesisAt: string
    updatedAt: string
    batchIndex: number
    chainRoot: string
    anchoredOffset: number
    batchesKept: number
    lastBatch: { i: number; from: number; to: number; root: string; at: string } | null
  } | null
  note?: string
}

function fmtClock(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}

export default function MerkleCoverage() {
  const [data, setData] = useState<MerklePayload | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (force = false) => {
    setBusy(true)
    try {
      const r = await fetch('/api/saos/merkle', { method: force ? 'POST' : 'GET', cache: 'no-store' })
      const j = (await r.json()) as MerklePayload
      setData(j)
      setState(j.ok ? 'ok' : 'down')
    } catch {
      setState('down')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => load(), 120_000)
    return () => clearInterval(t)
  }, [load])

  const v = data?.verdict ?? 'NO-RECORD'
  const cov = data?.coverage
  const rec = data?.record
  const tone =
    v === 'VERIFIED' ? 'bg-emerald-500/10 text-emerald-300' : v === 'BROKEN' ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-500/10 text-amber-300'

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className={`h-4 w-4 ${v === 'VERIFIED' ? 'text-emerald-400' : 'text-amber-400'}`} aria-hidden />
          <h4 className="text-sm font-semibold text-slate-200">שרשרת-אירועים · עיגון-מרקל <span dir="ltr" className="text-slate-500">(R218-c)</span></h4>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`} dir="ltr">{v}</span>
          <button
            onClick={() => load(true)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
            aria-label="עיגון-אצווה ואימות עכשיו"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {busy ? 'מעגן…' : 'עגן-ואמת'}
          </button>
        </div>
      </div>

      {state === 'down' ? (
        <p className="mt-3 text-xs text-amber-300/90">{data?.note ?? 'אימות-השרשרת אינו זמין כרגע — לא יוצגו טענות שלא אומתו.'}</p>
      ) : !cov ? (
        <p className="mt-3 animate-pulse text-xs text-slate-500">מחשב שורש-מרקל מהבייטים הגולמיים…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="text-[10px] text-slate-500">כיסוי-עיגון</div>
              <div className="tnum text-sm font-semibold text-slate-100" dir="ltr">{cov.anchored.toLocaleString()} / {cov.totalEvents.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="text-[10px] text-slate-500">אצוות (מקומי)</div>
              <div className="tnum text-sm font-semibold text-slate-100" dir="ltr">#{rec?.batchIndex ?? 0} · {rec?.batchesKept ?? 0} בחלון</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="text-[10px] text-slate-500">ממתין לאצווה הבאה</div>
              <div className="tnum text-sm font-semibold text-slate-100" dir="ltr">{cov.pending.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="text-[10px] text-slate-500">עוגן אחרון</div>
              <div className="tnum text-sm font-semibold text-slate-100" dir="ltr">{fmtClock(rec?.updatedAt)}</div>
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
            <div className="text-[10px] text-slate-500">שורש-השרשרת המצטבר (sha256 · מחויב-גיט ונעול-שעתי)</div>
            <div className="tnum mt-0.5 truncate font-mono text-[11px] text-emerald-300/90" dir="ltr">{rec?.chainRoot ?? '—'}</div>
          </div>

          <p className="mt-2 text-[10px] text-slate-500">
            {data?.detail} · מסלול-אמון: בייטים → שורש-אצווה → שורש-מצטבר → רשומה → commit חתום → עד-טיפ שעתי על השרשרת. האיבר אינו מחזיק מפתחות ואינו משדר — החתימה באחריות המשמר בלבד.
          </p>
        </>
      )}
    </div>
  )
}
