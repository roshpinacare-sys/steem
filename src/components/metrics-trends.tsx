'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'

/* R218-a · Step 1 of the approved plan: metrics TIME-SERIES in the cockpit.
 * Self-contained client component — one fetch loop, own polling, zero coupling
 * to the page's status/sov data flow (collision-safe for the multi-agent round).
 * Truth law (R217): freshness stamps everywhere; never fake data. */

type Pt = [number, number]
type MetricsPayload = {
  ok: boolean
  verdict?: string
  note?: string
  schema?: number
  everySec?: number
  snapshotCount?: number
  freshness?: { latestAt: string | null; ageSec: number | null }
  latest?: {
    ts: string
    vpEff: number | null
    vpFloor: number | null
    rcPct: number | null
    rcTankPct: number | null
    fillsToday: number | null
    realizedSbdTotal: number | null
    edgeBps: number | null
    opsToday: number | null
    custodyAgeSec: number | null
    wdChecks: number | null
    wdHeals: number | null
  } | null
  series?: { vp: Pt[]; rc: Pt[]; fills: Pt[]; sbd: Pt[]; edge: Pt[] }
  bucketMin?: number
  windowH?: number
}

function Spark({
  points,
  tone = 'emerald',
  label,
  value,
  sub,
}: {
  points: Pt[]
  tone?: 'emerald' | 'slate' | 'amber'
  label: string
  value: string
  sub?: string
}) {
  const W = 100
  const H = 26
  const pad = 2
  let d = ''
  let dot: { x: number; y: number } | null = null
  if (points.length >= 2) {
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const x0 = xs[0]
    const x1 = xs[xs.length - 1]
    const yMin = Math.min(...ys)
    const yMax = Math.max(...ys)
    const span = x1 - x0 || 1
    const vSpan = yMax - yMin || 1
    const px = (t: number) => pad + ((t - x0) / span) * (W - 2 * pad)
    const py = (v: number) => H - pad - ((v - yMin) / vSpan) * (H - 2 * pad)
    d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ')
    dot = { x: px(x1), y: py(ys[ys.length - 1]) }
  }
  const stroke = tone === 'emerald' ? '#34d399' : tone === 'amber' ? '#fbbf24' : '#94a3b8'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-400">{label}</span>
        <span className="tnum text-sm font-semibold text-slate-100" dir="ltr">{value}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-8 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} — מגמה, ${points.length} דגימות`}
      >
        {d ? (
          <>
            <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {dot && <circle cx={dot.x} cy={dot.y} r="1.8" fill={stroke} />}
          </>
        ) : (
          <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {sub && <div className="mt-1 text-[10px] text-slate-500">{sub}</div>}
    </div>
  )
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}

export default function MetricsTrends() {
  const [data, setData] = useState<MetricsPayload | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading')
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (manual = false) => {
    if (manual) setBusy(true)
    try {
      const r = await fetch('/api/saos/metrics', { cache: 'no-store' })
      const j = (await r.json()) as MetricsPayload
      if (j.ok) {
        setData(j)
        setState('ok')
      } else {
        setState('down')
        if (j.note) setData({ ok: false, note: j.note, verdict: j.verdict })
      }
    } catch {
      setState('down')
    } finally {
      if (manual) setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(() => load(), 60_000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  const s = data?.series
  const latest = data?.latest
  const age = data?.freshness?.ageSec
  const fresh = age !== null && age !== undefined && age < 180
  const n = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : v.toFixed(digits))

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" aria-hidden />
          <h4 className="text-sm font-semibold text-slate-200">מגמות-זמן · טבלת-המדדים <span dir="ltr" className="text-slate-500">(R218-a)</span></h4>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              state === 'ok' ? (fresh ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300') : 'bg-slate-800 text-slate-400'
            }`}
            dir="ltr"
          >
            {state === 'ok' && data?.freshness?.latestAt ? `measured ${fmtTime(data.freshness.latestAt)} · age ${age}s` : state === 'down' ? 'organ-down' : 'sampling…'}
          </span>
          <button
            onClick={() => load(true)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
            aria-label="רענון מגמות"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            רענון
          </button>
        </div>
      </div>

      {state === 'down' ? (
        <p className="mt-3 text-xs text-amber-300/90">{data?.note ?? 'איבר-המדדים אינו זמין — אין להציג נתונים שלא נמדדו.'}</p>
      ) : !s ? (
        <p className="mt-3 animate-pulse text-xs text-slate-500">דוגם את טבלת-הזמן…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Spark
              label="VP אפקטיבי %"
              value={n(latest?.vpEff)}
              points={s.vp}
              tone="emerald"
              sub={`רצפה ${n(latest?.vpFloor, 0)}% · מיצוע ${data?.bucketMin ?? 15} דק · חלון ${data?.windowH ?? 24} שע`}
            />
            <Spark
              label="RC חי %"
              value={n(latest?.rcPct)}
              points={s.rc}
              tone="slate"
              sub={`מיכל-יומי ${n(latest?.rcTankPct)}% · הדגימה כל ${data?.everySec ?? 60} שנ`}
            />
            <Spark
              label="מילויים-היום"
              value={latest?.fillsToday === null || latest?.fillsToday === undefined ? '—' : String(latest.fillsToday)}
              points={s.fills}
              tone="emerald"
              sub={`מצטבר-SBD ${n(latest?.realizedSbdTotal, 3)} · מדוד, לא מובטח`}
            />
            <Spark
              label="קצה-המרה bps"
              value={latest?.edgeBps === null || latest?.edgeBps === undefined ? '—' : String(latest.edgeBps)}
              points={s.edge}
              tone="slate"
              sub={`פעולות-רשת-היום ${latest?.opsToday ?? '—'}`}
            />
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            מקור: איבר-מדדים בן-כותב-יחיד (‎:3042, SQLite WAL, שמירה 7 ימים) · דגימות {data?.snapshotCount ?? 0} · ריפוי-ביקוש דרך מסלול-הקריאה · כל החותמות UTC.
            {s.vp.length < 2 && ' אין עדיין מספיק דגימות לקו-מגמה — הקו יופיע אחרי שתי דגימות לפחות.'}
          </p>
        </>
      )}
    </div>
  )
}
