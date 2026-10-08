'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * T-21d · paste-revival state machine: bulletproof by construction:
 *  - the secret lives ONLY in this hook's state + the POST body (never logged, never stored)
 *  - explicit step states so the operator NEVER sees a stuck "ממתין": שולח… → מאמת מול-השרשרת… → תוצאה
 *  - client-side 30s abort guard (adoptCred has a fetch-timeout risk engine-side) with an
 *    explicit message: "המנוע לא הגיב ב-30 שניות, בדוק שהמנוע רץ"
 * Success/failure semantics are identical to the T-16 flow (verified → emerald, mismatch → amber guidance).
 */

export type AdoptStep = 'idle' | 'sending' | 'verifying' | 'ok' | 'mismatch' | 'fail'

export type AdoptState = {
  text: string
  setText: (v: string) => void
  busy: boolean
  step: AdoptStep
  msg: { ok: boolean; text: string } | null
  adopt: () => void
  reset: () => void
}

const ADOPT_TIMEOUT_MS = 30_000
/** the single engine call covers send+secure+chain-verify; these labels are honest progress, not fake phases */
const VERIFY_LABEL_DELAY_MS = 1_500

export function useAdoptCredential(onDone?: () => void | Promise<void>): AdoptState {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<AdoptStep>('idle')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textRef = useRef('')
  textRef.current = text
  const busyRef = useRef(false)
  busyRef.current = busy

  const reset = useCallback(() => {
    setStep('idle')
    setMsg(null)
  }, [])

  useEffect(() => () => {
    if (stageTimer.current) clearTimeout(stageTimer.current)
  }, [])

  const adopt = useCallback(() => {
    const value = textRef.current.trim()
    if (!value || busyRef.current) return
    setBusy(true)
    setMsg(null)
    setStep('sending')
    stageTimer.current = setTimeout(() => {
      setStep((st) => (st === 'sending' ? 'verifying' : st))
    }, VERIFY_LABEL_DELAY_MS)

    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(new DOMException('adopt-timeout', 'TimeoutError')), ADOPT_TIMEOUT_MS)

    void (async () => {
      try {
        const r = await fetch('/api/saos/adopt-credential', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: value }),
          signal: ctrl.signal,
          cache: 'no-store',
        })
        const j = await r.json().catch(() => null) as Record<string, unknown> | null
        if (j?.ok && j?.verified) {
          setStep('ok')
          setMsg({ ok: true, text: `אומץ ואומת מול-השרשרת (${j.account} · טביעת-אצבע ${j.fingerprint}), המחזור-הבא מקים את הצי החותם` })
          setText('')
          await onDone?.()
        } else if (j?.ok) {
          setStep('mismatch')
          setMsg({ ok: false, text: `אומץ אך לא נמצא תואם לחשבון (${j.reason ?? 'CREDENTIAL-MISMATCH'}) — אין-דרישה-מהמפעיל: החתימה ממשיכה דרך החיאת-הוולט האוטומטית (wif-direct, מאומת-שרשרת)` })
        } else if (typeof j?.reason === 'string' && j.reason.startsWith('ACCOUNT-MISMATCH-DOCTRINE')) {
          /* T-21 identity-integrity: the engine refuses foreign-account pastes
           * at the door, the measurement rails are never hijacked again */
          setStep('mismatch')
          setMsg({ ok: false, text: `ההדבקה נדחתה: הדבקת חשבון אחר מחשבון-המערכת: מנוע זה מנהל את ${j.doctrineAccount ?? 'headcorner'} בלבד. הדבק: <${j.doctrineAccount ?? 'headcorner'}> <הסיסמה-הראשית-הנוכחית>` })
        } else {
          setStep('fail')
          setMsg({ ok: false, text: `אימוץ נכשל: ${j?.reason ?? j?.error ?? 'שגיאה'}` })
        }
      } catch (e) {
        setStep('fail')
        const name = (e as DOMException | null)?.name
        setMsg({
          ok: false,
          text: name === 'TimeoutError' || name === 'AbortError'
            ? `המנוע לא הגיב ב-${ADOPT_TIMEOUT_MS / 1000} שניות, בדוק שהמנוע רץ`
            : 'המנוע לא זמין, נסה שוב',
        })
      } finally {
        clearTimeout(to)
        if (stageTimer.current) { clearTimeout(stageTimer.current); stageTimer.current = null }
        setBusy(false)
      }
    })()
  }, [onDone])

  return { text, setText, busy, step, msg, adopt, reset }
}
