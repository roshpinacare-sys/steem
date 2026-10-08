import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { badgeTone, badgeSolidTone, type Tone } from './tones'

/**
 * T-21d · unified status pill: one place for the tone law.
 * Replaces the dozens of inline tone ternaries the old page repeated per card.
 */
export function StatusBadge({
  tone,
  children,
  solid = false,
  pulse = false,
  className,
  title,
}: {
  tone: Tone
  children: ReactNode
  /** solid = filled pill for headline states; default = outlined. */
  solid?: boolean
  /** pulse = alive ping dot on the leading edge. */
  pulse?: boolean
  className?: string
  title?: string
}) {
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        solid ? badgeSolidTone[tone] : badgeTone[tone],
        'hover:bg-inherit',
        className,
      )}
    >
      {pulse && (
        <span className="relative flex h-2 w-2 me-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {children}
    </Badge>
  )
}
