import { StatusBadge } from './StatusBadge'

/**
 * T-21d · evidence-grade honesty labels: the cockpit's truth law in one place.
 * מדוד = measured on-chain (emerald, solid) · מוערך = estimated (amber) · פוטנציאל = potential (slate).
 */
export function HonestyBadge({ kind, className }: { kind: 'measured' | 'estimated' | 'potential' | string | null | undefined; className?: string }) {
  if (kind === 'measured') return <StatusBadge tone="emerald" solid className={className}>מדוד</StatusBadge>
  if (kind === 'estimated') return <StatusBadge tone="amber" className={className}>מוערך</StatusBadge>
  return <StatusBadge tone="slate" className={className}>פוטנציאל</StatusBadge>
}
