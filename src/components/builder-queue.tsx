'use client'

import { useCallback, useEffect, useState } from 'react'
import { Hammer, RefreshCw, Play } from 'lucide-react'

/* R218-d · Step 4 (final): the BUILDER organ card.
 * Proposal-only autonomous engineering: the organ reads a target, asks the
 * LLM bridge for ONE surgical {find,replace}, validates against CURRENT bytes
 * (unique anchor + result syntax via bun transpiler on a sandbox copy), and
 * stores the proposal + an evidence line that reaches the signed chain.
 * The live tree is untouched by construction; merge = deliberate outside act. */

type Task = { id: string; at: string; file: string; task: string; status: string; reason?: string; proposalId?: string }
type Proposal = { id: string; at: string; file: string; task: string; analysis: string; status: string; findPreview: string; replacePreview: string }
type Status = { ok: boolean; note?: string; tasks?: Task[]; proposals?: Proposal[] }

function fmtClock(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}

export default function BuilderQueue() {
  const [data, setData] = useState<Status | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/saos/builder', { cache: 'no-store' })
      const j = (await r.json()) as Status
      setData(j)
      setState(j.ok ? 'ok' : 'down')
    } catch {
      setState('down')
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => load(), 90_000)
    return () => clearInterval(t)
  }, [load])

  const runFirstTask = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    try {
      /* the round's first real task (R218-a observation): stale custodian prefix */
      const e = await fetch('/api/saos/builder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'enqueue',
          file: 'mini-services/saos-custodian/index.ts',
          task: 'הודעת-ה-commit במשמר מקודדת-קשיח עם קידומת "R215-custodian" מיושנת. הצע עריכה שתהפוך אותה לקידומת נייטרלית-קבועה "SAOS-custodian" עם תיאור-המשימה הקיים, כך שלא תתיישן שוב.',
        }),
      })
      const ej = (await e.json()) as { ok: boolean; error?: string }
      if (!ej.ok) {
        setMsg(`הכנסת-משימה נדחתה: ${ej.error ?? '?'}`)
        setBusy(false)
        return
      }
      setMsg('המשימה בתור — מריץ ציק (LLM עד ~100 שניות)…')
      const t = await fetch('/api/saos/builder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'tick' }),
      })
      const tj = (await t.json()) as { ok: boolean; processed?: boolean; task?: Task; note?: string }
      setMsg(
        tj.ok && tj.task
          ? `תוצאה: ${tj.task.status}${tj.task.proposalId ? ` · הצעה ${tj.task.proposalId}` : ''}${tj.task.reason ? ` · ${tj.task.reason}` : ''}`
          : tj.note ?? 'הציק לא הושלם — בדקו שוב'
      )
      await load()
    } catch {
      setMsg('שגיאת-רשת')
    } finally {
      setBusy(false)
    }
  }, [load])

  const tasks = data?.tasks ?? []
  const proposals = data?.proposals ?? []

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-emerald-400" aria-hidden />
          <h4 className="text-sm font-semibold text-slate-200">צוות-ההנדסה · איבר-בונה <span dir="ltr" className="text-slate-500">(R218-d)</span></h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runFirstTask}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-800 bg-emerald-950/40 px-2 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:border-emerald-600 disabled:opacity-50"
            aria-label="הרצת-המשימה-הראשונה של הבונה"
          >
            <Play className="h-3 w-3" aria-hidden />
            משימה-ראשונה
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
            aria-label="רענון צוות-הנדסה"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            רענון
          </button>
        </div>
      </div>

      {state === 'down' ? (
        <p className="mt-3 text-xs text-amber-300/90">{data?.note ?? 'איבר-הבונה אינו זמין — אין להציג טענות שלא אומתו.'}</p>
      ) : (
        <>
          {msg && <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-slate-300">{msg}</p>}
          <div className="mt-3 space-y-1.5">
            {tasks.length === 0 && proposals.length === 0 && (
              <p className="text-xs text-slate-500">התור ריק — הצעות נוצרות ממשימות (הכפתור מריץ את הראשונה: תיקון הקידומת המיושנת במשמר).</p>
            )}
            {tasks.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-[11px]">
                <div className="min-w-0">
                  <div className="truncate text-slate-300">{t.task}</div>
                  <div className="truncate text-slate-500" dir="ltr">{t.file} · {fmtClock(t.at)}</div>
                  {t.reason && <div className="mt-0.5 text-amber-300/80">{t.reason}</div>}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    t.status === 'PROPOSED' ? 'bg-emerald-500/10 text-emerald-300' : t.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-300' : 'bg-slate-800 text-slate-400'
                  }`}
                  dir="ltr"
                >
                  {t.status}
                </span>
              </div>
            ))}
            {proposals.map((p) => (
              <div key={p.id} className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-emerald-200">הצעה {p.id}</span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300" dir="ltr">{p.status}</span>
                </div>
                <div className="mt-1 text-slate-400">{p.analysis}</div>
                <div className="mt-1 truncate text-slate-500" dir="ltr">find: {p.findPreview}… → replace: {p.replacePreview}…</div>
                <div className="mt-0.5 text-slate-500" dir="ltr">{p.file}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            חוק: הצעה-בלבד — האיבר לעולם לא כותב בעץ-החי, לא רץ git, לא מחזיק מפתחות · ולידציה: עוגן-יחיד + תחביר-תוצאה (מנוע-ה-transpile של bun על עותק-סנדבוקס) · ראיות (hashים ופסקים בלבד) זורמות ל-memory/build-proposals.jsonl ונחתמות-לשרשרת דרך המשמר · מיזוג = החלטה-מכוונת מחוץ לאיבר.
          </p>
        </>
      )}
    </div>
  )
}
