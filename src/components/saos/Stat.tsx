import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { valueTone, type Tone } from './tones'

/**
 * T-21d · compact stat tile: label (small, muted) over value (bold, tabular-nums).
 * The single pattern behind every "grid of numbers" in the cockpit.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'slate',
  ltr = false,
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  ltr?: boolean
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2', className)}>
      <dt className="text-[11px] font-medium leading-tight text-slate-500">{label}</dt>
      <dd
        dir={ltr ? 'ltr' : undefined}
        className={cn('tnum mt-0.5 truncate text-sm font-bold leading-tight', valueTone[tone])}
        title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
      >
        {value}
      </dd>
      {hint != null && <p className="mt-0.5 text-[10px] leading-tight text-slate-600">{hint}</p>}
    </div>
  )
}
