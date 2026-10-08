'use client'

import type { KeyboardEvent } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AdoptState } from './useAdoptCredential'

/**
 * T-21d · the paste-revival flow as a reusable control.
 * Rendered inside the fleet alarm (top of page) AND inside the unified ארנק-וקונסול card,
 * one shared state (the hook lives in the page), so both entry points are always in sync.
 * Explicit step states: שולח… → מאמת מול-השרשרת… → תוצאה/שגיאה. Never a stuck "ממתין".
 */
export function AdoptCredentialFlow({ adopt, compact = false }: { adopt: AdoptState; compact?: boolean }) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      adopt.adopt()
    }
  }
  const busyLabel = adopt.step === 'verifying' ? 'מאמת מול-השרשרת…' : 'שולח…'

  return (
    <div className={cn('w-full', compact ? 'mt-2' : 'mt-3')}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={adopt.text}
          onChange={(e) => adopt.setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="הדבק כאן: <שם-חשבון> <סיסמה-ראשית>, נשלח ישירות למנוע (0600), לעולם לא נרשם"
          aria-label="הדבקת אישורי-חשבון להקמה"
          className="min-h-11 w-full flex-1 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          dir="ltr"
          autoComplete="off"
        />
        <Button
          size="sm"
          disabled={adopt.busy || !adopt.text.trim()}
          onClick={adopt.adopt}
          className="min-h-11 bg-emerald-600 font-bold text-white hover:bg-emerald-500 focus-visible:ring-emerald-500/50 sm:min-h-11 sm:min-w-32"
        >
          {adopt.busy ? (
            <>
              <Loader2 className="h-4 w-4 me-1.5 animate-spin" aria-hidden />
              {busyLabel}
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4 me-1.5" aria-hidden />
              אמץ ואמת
            </>
          )}
        </Button>
      </div>
      {adopt.busy && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300" role="status" aria-live="polite">
          <Loader2 className="h-3 w-3 animate-spin text-emerald-400" aria-hidden />
          {busyLabel}
        </p>
      )}
      {adopt.msg && (
        <p
          className={cn('mt-1.5 text-[11px] font-semibold leading-relaxed', adopt.msg.ok ? 'text-emerald-300' : 'text-amber-300')}
          role="status"
          aria-live="polite"
        >
          {adopt.msg.text}
        </p>
      )}
    </div>
  )
}
