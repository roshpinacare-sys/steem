'use client'

import { useCallback, useEffect, useState } from 'react'
import { GitBranch, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { Stat } from './Stat'

/**
 * R285 · THE RESILIENCE-PLANE BOARD (the operator's window into the LLM chain).
 * KPIs are derived from the metadata-only ledger (calls, failover, exhaustion,
 * cache hits, tokensSaved, avg latency), never from in-memory counters. The
 * drill button proves the wiring live (forced-fail candidate, real 1-token
 * provider call, local echo backstop). No prompt content is ever shown here:
 * names, classes, numbers only. Self-fetching: the chain is a web-layer
 * organ, its board is not part of the engine status payload.
 */

interface Kpis {
  calls: number
  failoverRate: number
  exhaustionRate: number
  cacheHitRate: number
  tokensSaved: number
  avgMs: number
}
interface Row {
  at?: string
  kind?: string
  purpose?: string
  selected?: string | null
  ok?: boolean
  ms?: number
  tokens?: number
  attempts?: { name: string; errorClass?: string; ms?: number }[]
}
interface Board {
  ok: boolean
  kpis?: Kpis
  recent?: Row[]
  spec?: { fastPath?: { size: number; max: number; ttlMs: number }; drill?: string }
}
interface DrillState {
  busy: boolean
  drillOk?: boolean
  selected?: string | null
  note?: string
  error?: string
}

const pct = (x: number | undefined) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '-')

export function LlmChainCard() {
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState(false)
  const [drill, setDrill] = useState<DrillState>({ busy: false })

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/saos/llm-chain', { cache: 'no-store' })
      const j = (await r.json()) as Board
      setBoard(j)
      setFailed(!j?.ok)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    /* first kick is deferred to a task (setState-in-effect hygiene), then poll */
    const first = setTimeout(load, 0)
    const t = setInterval(load, 30_000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [load])

  const runDrill = useCallback(async () => {
    setDrill({ busy: true })
    try {
      const r = await fetch('/api/saos/llm-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'drill' }),
      })
      const j = await r.json()
      setDrill({ busy: false, drillOk: !!j?.drillOk, selected: j?.selected, note: j?.note, error: j?.error })
      load()
    } catch (e) {
      setDrill({ busy: false, error: String((e as Error)?.message ?? e) })
    }
  }, [load])

  const k = board?.kpis

  return (
    <SectionCard
      icon={GitBranch}
      tone="emerald"
      className="md:col-span-2 lg:col-span-2"
      title={<>מישור-החוסן · שרשרת-ה-LLM <span dir="ltr" className="text-slate-500">(R285)</span></>}
      meta="מועמד-הוא-טופולוגיית-הניסיון: כשל בראשון מעביר-שליטה לשני באותו-תור; הפלט אף-פעם לא מומצא. הלוח נגזר מהיומן (מטא-בלבד, אף-תוכן-פרומפט)."
      actions={
        <>
          <button
            type="button"
            onClick={runDrill}
            disabled={drill.busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            aria-label="הרצת בדיקת-חיווט של שרשרת-ה-LLM"
          >
            {drill.busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            בדיקת-חיווט
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch('/api/saos/llm-chain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'flush' }) })
              load()
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-600/60 bg-slate-800/60 px-2.5 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-700/60"
            aria-label="ריקון-מטמון-המסלול-המהיר"
          >
            <Trash2 className="h-3.5 w-3.5" />
            ריקון-מטמון
          </button>
        </>
      }
    >
      {failed ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          הלוח לא נטען (השכבה-המארחת כבויה). כנות: אין-טענת-בריאות בלי-מדידה.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="קריאות-שרשרת" value={k ? String(k.calls) : '-'} hint="שורות מדידה ביומן" />
            <Stat label="כשל-מוצה-כנה" value={pct(k?.exhaustionRate)} tone={k && k.exhaustionRate > 0.3 ? 'rose' : 'slate'} hint="אפס-פלט מומצא, רק אמת" />
            <Stat label="הישרדות-בפיילובר" value={pct(k?.failoverRate)} tone="emerald" hint="מועמד שני נשא באותו-תור" />
            <Stat label="פגיעות-מסלול-מהיר" value={pct(k?.cacheHitRate)} tone="emerald" hint="אותו-קלט מדויק בתוך-TTL" />
            <Stat label="טוקנים-שנחסכו" value={k ? String(k.tokensSaved) : '-'} tone="emerald" ltr hint="חשבון מהשימוש-האמיתי-האחרון" />
            <Stat label="זמן-תגובה ממוצע" value={k ? `${k.avgMs}ms` : '-'} ltr hint="מהיומן, לא ממונה-זיכרון" />
          </div>

          {(drill.drillOk !== undefined || drill.error) && (
            <div
              role="status"
              className={`rounded-lg border p-2.5 text-xs ${
                drill.drillOk
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              }`}
            >
              {drill.error
                ? `הבדיקה לא הושלמה: ${drill.error}`
                : drill.drillOk
                  ? `בדיקת-החיווט עברה · נבחר: ${drill.selected ?? '-'} · ${drill.note ?? ''}`
                  : `הבדיקה נכשלה כנה · נבחר: ${drill.selected ?? 'אין'}`}
            </div>
          )}

          <div className="max-h-44 overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pe-2 font-semibold">זמן</th>
                  <th className="py-1 pe-2 font-semibold">מטרה</th>
                  <th className="py-1 pe-2 font-semibold">נבחר</th>
                  <th className="py-1 font-semibold">מ'ש</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {(board?.recent ?? []).slice(0, 12).map((r, i) => (
                  <tr key={`${r.at ?? ''}-${i}`} className="border-t border-slate-800/60">
                    <td className="py-1 pe-2 text-slate-500" dir="ltr">
                      {(r.at ?? '').slice(11, 19) || '-'}
                    </td>
                    <td className="py-1 pe-2 font-semibold" dir="ltr">
                      {r.purpose ?? '-'}
                      {r.kind === 'drill' ? <span className="ms-1 rounded bg-amber-500/15 px-1 text-[10px] text-amber-300">drill</span> : null}
                    </td>
                    <td className="py-1 pe-2" dir="ltr">
                      <span className={r.ok ? 'text-emerald-400' : 'text-rose-400'}>{r.selected ?? `exhausted`}</span>
                      {(r.attempts ?? [])
                        .filter((a) => a.errorClass)
                        .map((a, j) => (
                          <span key={j} className="ms-1 text-[10px] text-amber-400/80" dir="ltr">
                            {a.name}:{a.errorClass}
                          </span>
                        ))}
                    </td>
                    <td className="py-1 text-slate-400" dir="ltr">{typeof r.ms === 'number' ? r.ms : '-'}</td>
                  </tr>
                ))}
                {!((board?.recent ?? []).length) && (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-slate-500">
                      עדיין אין קריאות מתועדות — השרשרת נכנסת לפעולה במחזור-התוכן/השיחה הבא.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="text-[10px] leading-relaxed text-slate-500" dir="ltr">
            fast-path {board?.spec?.fastPath ? `${board.spec.fastPath.size}/${board.spec.fastPath.max} · ttl ${Math.round((board.spec.fastPath.ttlMs ?? 0) / 1000)}s` : '-'} · sha256-keyed, raw key never stored
          </div>
        </>
      )}
    </SectionCard>
  )
}
