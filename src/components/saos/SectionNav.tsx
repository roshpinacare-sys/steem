'use client'

import { useEffect, useRef } from 'react'
import { Banknote, BrainCircuit, Radio, Users, Activity } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * T-21d · THE mobile navigation fix: a sticky segmented section nav.
 * On mobile the cockpit renders ONE section at a time (real app-like menu, not a broken
 * long scroll); the pills filter sections with snap scrolling and 44px touch targets.
 * Hidden on lg+ where the full grid renders as always.
 */
export type SectionId = 'command' | 'market' | 'army' | 'economy' | 'system'

export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'command', label: 'פיקוד', icon: Radio, hint: 'מנוע · מחזור · ארנק' },
  { id: 'market', label: 'שוק', icon: Activity, hint: 'ספר · היפר-גריד' },
  { id: 'army', label: 'צבא', icon: Users, hint: 'צי · חיילים · תפקידים' },
  { id: 'economy', label: 'כלכלה', icon: Banknote, hint: 'מסילות · P&L · דלק' },
  { id: 'system', label: 'מערכת', icon: BrainCircuit, hint: 'קיורציה · למידה · אינטל' },
]

export function SectionNav({ active, onChange }: { active: SectionId; onChange: (id: SectionId) => void }) {
  const railRef = useRef<HTMLDivElement>(null)

  // keep the active pill inside the scroll viewport (also after programmatic switches)
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const el = rail.querySelector<HTMLElement>(`[data-section="${active}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [active])

  return (
    <nav
      aria-label="ניווט-מקטעים של תא-הפיקוד"
      className="sticky top-14 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur supports-[backdrop-filter]:bg-slate-950/75 lg:hidden"
    >
      <div
        ref={railRef}
        role="tablist"
        aria-label="מקטעי-הקוקפיט"
        className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-3 py-2.5"
      >
        {SECTIONS.map(({ id, label, icon: Icon, hint }) => {
          const isActive = id === active
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`${label}: ${hint}`}
              data-section={id}
              onClick={() => onChange(id)}
              className={cn(
                'flex h-11 shrink-0 snap-start touch-manipulation items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
                isActive
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600 hover:text-slate-200',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
