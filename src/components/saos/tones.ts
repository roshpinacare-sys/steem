/**
 * T-21d · SAOS cockpit design tokens.
 * Palette law: emerald (live/ok) · amber (warning) · rose (dead/fail) · orange (fleet) · slate/zinc neutrals.
 * NO indigo, NO blue, no cyan/teal/violet/fuchsia, every panel maps to one of the five tones.
 */
import { cn } from '@/lib/utils'

export type Tone = 'emerald' | 'amber' | 'rose' | 'orange' | 'slate'

/** Outlined badge classes per tone (paired with shadcn Badge variant="outline"). */
export const badgeTone: Record<Tone, string> = {
  emerald: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
  amber: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  rose: 'border-rose-500/40 text-rose-300 bg-rose-500/10',
  orange: 'border-orange-500/40 text-orange-300 bg-orange-500/10',
  slate: 'border-slate-700 text-slate-300 bg-slate-800/40',
}

/** Solid badge classes per tone (status pills that must pop). */
export const badgeSolidTone: Record<Tone, string> = {
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  slate: 'bg-slate-800 text-slate-200 border-slate-700',
}

/** SectionCard skin per tone: border + accent gradient + title color + icon chip. */
export const cardTone: Record<Tone, { card: string; title: string; chip: string }> = {
  emerald: {
    card: 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60',
    title: 'text-emerald-300',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  },
  amber: {
    card: 'border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-slate-900/60',
    title: 'text-amber-300',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  },
  rose: {
    card: 'border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-slate-900/60',
    title: 'text-rose-300',
    chip: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
  },
  orange: {
    card: 'border-orange-500/25 bg-gradient-to-br from-orange-500/10 to-slate-900/60',
    title: 'text-orange-300',
    chip: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  },
  slate: {
    card: 'border-slate-800 bg-slate-900/60',
    title: 'text-slate-300',
    chip: 'border-slate-700 bg-slate-800/60 text-slate-400',
  },
}

/** Numeric value colors (tabular numbers always). */
export const valueTone: Record<Tone, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  rose: 'text-rose-400',
  orange: 'text-orange-400',
  slate: 'text-slate-100',
}
