'use client'

// ─────────────────────────────────────────────────────────────────────
// SealCard · חותם-הרשת בתוך תא-הפיקוד
//
// המפעיל ביקש במפורש: החותם צריך להיות ב-SAOS SOVEREIGN COCKPIT · תא-הפיקוד.
// הכרטיס מציג את שתי המעטפות הקנוניות (weave + headcorner), את מצב-הסמכות
// המקומי, ואת דלת-ההשבה (r135) — הצעד-היחיד של המפעיל להחזיר את הסיסמה.
// אפס סודות בתצוגה: כתובות-ציבוריות, תאריכי-איטום ומשמרת בלבד.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Lock, LockOpen, Loader2, ShieldCheck, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionCard } from '@/components/saos/SectionCard'
import { RailRow } from '@/components/saos/RailRow'
import { StatusBadge } from '@/components/saos/StatusBadge'

type EnvelopeWeave = {
  envelopeExists: boolean
  rotatedAt: string | null
  cloudAddress: string | null
  networkAddress: string | null
  custody: 'OPEN' | 'GATED'
  via: string | null
  networkKeyCached: boolean
}
type EnvelopeHc = {
  envelopeExists: boolean
  sealedAt: string | null
  zeroRotation: boolean
  localKeyPresent: boolean
  localKeyPath: string
  custody: 'OPEN' | 'GATED'
}
type SealResp = {
  ok: boolean
  weave: EnvelopeWeave
  headcorner: EnvelopeHc
  door: string
  noteHe: string
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const short = (a: string | null) => (a ? `${a.slice(0, 10)}…${a.slice(-4)}` : '—')

export default function SealCard() {
  const [st, setSt] = useState<SealResp | null>(null)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/saos/seal', { cache: 'no-store' })
      setSt(await r.json())
    } catch {
      /* next poll retries */
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  const submit = useCallback(async () => {
    if (!pass.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/arm/seal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: pass }),
      })
      const j = await r.json()
      if (j?.ok) {
        setMsg({ ok: true, text: j?.detailHe ?? 'הסמכות הושבה' })
        setPass('')
      } else {
        setMsg({
          ok: false,
          text:
            j?.error === 'passphrase-rejected'
              ? 'ה-seal לא נפתח — AEAD דחה את הסיסמה. שום דבר לא נכתב.'
              : j?.error === 'rate-limited'
                ? 'מגבלת-קצב: 5 ניסיונות לשעה — נסה מאוחר יותר.'
                : (j?.detail ?? 'נכשל — שום דבר לא נכתב'),
        })
      }
      await load()
    } catch {
      setMsg({ ok: false, text: 'הדלת לא זמינה כרגע — נסה שוב' })
    } finally {
      setBusy(false)
    }
  }, [pass, load])

  const weave = st?.weave
  const hc = st?.headcorner
  const weaveOpen = weave?.custody === 'OPEN'
  const hcOpen = hc?.custody === 'OPEN'

  return (
    <SectionCard
      icon={KeyRound}
      tone={weaveOpen && hcOpen ? 'emerald' : 'amber'}
      title={
        <>
          חותם-הרשת · seal <span dir="ltr" className="text-slate-500">· zero-rotation</span>
        </>
      }
      meta="המעטפות הקנוניות בתוך תא-הפיקוד (sovereign/) · הסיסמה במשמרת-מפוצלת ולעולם לא בגיט · מפתחות-הענן-והרשת מעולם לא הוחלפו (r72)"
      actions={
        <StatusBadge tone={weaveOpen && hcOpen ? 'emerald' : 'amber'} pulse={weaveOpen && hcOpen}>
          {weaveOpen && hcOpen ? 'פתוח' : 'סגור-כנה'}
        </StatusBadge>
      }
    >
      {/* מעטפת weave */}
      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
        <div className="mb-2 flex items-center gap-2">
          {weaveOpen ? (
            <LockOpen className="h-4 w-4 text-emerald-400" aria-hidden />
          ) : (
            <Lock className="h-4 w-4 text-amber-400" aria-hidden />
          )}
          <span className="text-xs font-bold text-slate-200">weave-seal · מפתחות-הענן-והרשת</span>
          <StatusBadge tone={weaveOpen ? 'emerald' : 'amber'} solid>
            {weaveOpen ? 'פתוח-מקומית' : 'GATED'}
          </StatusBadge>
        </div>
        <RailRow label="כתובת-ענן" value={<span dir="ltr">{short(weave?.cloudAddress ?? null)}</span>} />
        <RailRow label="כתובת-רשת" value={<span dir="ltr">{short(weave?.networkAddress ?? null)}</span>} />
        <RailRow label="סבב-סיסמה" value={fmtDate(weave?.rotatedAt ?? null)} />
        {weave?.via && <RailRow label="נתיב-פתיחה" value={weave.via === 'lineage(a776515)' ? 'שושלת-הגיט (r72)' : weave.via} />}
        {weave?.networkKeyCached && <RailRow label="מטמון-מפתח" value="חי ב-DB מקומי" />}
      </div>

      {/* מעטפת headcorner */}
      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
        <div className="mb-2 flex items-center gap-2">
          {hcOpen ? (
            <LockOpen className="h-4 w-4 text-emerald-400" aria-hidden />
          ) : (
            <Lock className="h-4 w-4 text-amber-400" aria-hidden />
          )}
          <span className="text-xs font-bold text-slate-200">headcorner-seal · חותם-מפתח-הראש</span>
          <StatusBadge tone={hcOpen ? 'emerald' : 'amber'} solid>
            {hcOpen ? 'פתוח' : 'GATED'}
          </StatusBadge>
        </div>
        <RailRow label="אוטם" value={fmtDate(hc?.sealedAt ?? null)} />
        <RailRow label="אפס-סיבוב" value={hc?.zeroRotation ? 'כן — אותו מפתח, מעטפת-DR בלבד' : '—'} />
        <RailRow label="מפתח-חי-מקומי" value={hc?.localKeyPresent ? `${hc.localKeyPath} (0600)` : '— ממתין לאימוץ'} />
      </div>

      {/* דלת-ההשבה של המפעיל (r135) */}
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden />
          <span className="text-xs font-bold text-emerald-300">דלת-ההשבה · הצעד-היחיד של המפעיל</span>
        </div>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
          הסיסמה נבדקת מול המעטפות בזיכרון בלבד — לא נשמרת, לא נכתבת לדיסק, לא נכנסת ללוג.
          מגבלת-קצב: 5 ניסיונות לשעה.
        </p>
        <div className="flex gap-2">
          <Input
            dir="ltr"
            type="password"
            inputMode="text"
            autoComplete="off"
            placeholder="seal passphrase…"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            aria-label="סיסמת ה-seal להשבת-סמכות"
            className="h-9 border-slate-700 bg-slate-950/60 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus-visible:ring-emerald-500/40"
          />
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={busy || !pass.trim()}
            className="h-9 shrink-0 border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
            השבה
          </Button>
        </div>
        {msg && (
          <p
            role="status"
            className={`mt-2 rounded-md border px-2 py-1.5 text-[11px] leading-relaxed ${
              msg.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-slate-600">
        נתיב-השושלת (r72): המפתחות זהים לאורך כל ההיסטוריה — הסבבים החליפו סיסמאות בלבד. הסיסמה-הקודמת חיה במטא שבגיט
        (דוקטרינת ריפו-פרטי דאז), ולכן השחזור-המקומי אפשרי בלי שום מסירה חוץ-גיט.
        <a
          href="https://github.com/roshpinacare-sys/Zip/blob/main/sovereign/weave-seal.meta.json"
          target="_blank"
          rel="noreferrer"
          className="mx-1 inline-flex items-center gap-0.5 text-slate-500 underline decoration-dotted hover:text-slate-400"
        >
          המעטפת-ב-Zip <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </p>
    </SectionCard>
  )
}
