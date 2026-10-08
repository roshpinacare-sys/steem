'use client'

import { Fingerprint } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Tone } from './tones'
import type { Status } from './types'

/**
 * R255 · פרסונות-הצי — the operator's visibility order made visible:
 * "לשפר את הנראות שלנו שנראה טוב שיתארגנו על פרופילים ואישיות וסלנג אישי
 * מאותו רקע פחות יותר בין מקצועי לשכונה". Every fleet account gets a
 * one-card soul sheet: display name, about-line, lens, traits, personal
 * slang, the pro/hood register dial, owned topics, and the development arc
 * measured by lifetime posts (chain truth, never a clock).
 * Data: engine /status → personas (verdicts only, no secrets by construction).
 */

const TOPIC_HE: Record<string, string> = {
  attention: 'קשב', habits: 'הרגלים', 'slow-learning': 'למידה-איטית', street: 'רחוב',
  waiting: 'המתנה', tools: 'כלים', 'food-memory': 'אוכל-וזיכרון', walking: 'הליכה',
  ideas: 'רעיונות', repair: 'תיקונים', 'everyday-money': 'כסף-יומיום', 'urban-nature': 'טבע-עירוני',
  craft: 'מלאכת-יד', 'digital-minimal': 'מינימליזם-דיגיטלי', questions: 'שאלות',
  seasons: 'עונות', language: 'שפה', objects: 'חפצים',
}

const syncTone = (v?: string): Tone =>
  v === 'BROADCAST' ? 'emerald' : v === 'SYNCED-IDEMPOTENT' ? 'emerald' : v === undefined ? 'slate' : 'amber'

const syncLabel = (v?: string) =>
  v === 'BROADCAST' ? 'פרופיל חתום-בשרשרת' : v === 'SYNCED-IDEMPOTENT' ? 'מסונכרן (אידמפוטנטי)' : v ? `ממתין: ${v}` : 'ממתין-למחזור-סנכרון'

export function PersonasCard({ s }: { s: Status | null }) {
  const p = s?.personas ?? null
  const canon = p?.canon ?? []
  const arcs = p?.arcs ?? {}
  const synced = canon.filter((c) => ['BROADCAST', 'SYNCED-IDEMPOTENT'].includes(p?.sync?.[c.id]?.verdict ?? '')).length

  return (
    <SectionCard
      icon={Fingerprint}
      tone="orange"
      className="md:col-span-2 lg:col-span-3"
      title={<>פרסונות-הצי · פרופילים, אישיות וסלנג אישי <span dir="ltr" className="text-slate-500">(R255)</span></>}
      actions={<StatusBadge tone={synced === canon.length && canon.length > 0 ? 'emerald' : synced > 0 ? 'amber' : 'slate'} solid>{synced}/{canon.length || 14} פרופילים חיים</StatusBadge>}
      meta={'מסילת "בין מקצועי לשכונה": לכל חשבון רקע, אישיות, סלנג אישי וקשת-התפתחות שנמדדת לפי פוסטים-חיים בשרשרת (לעולם לא לפי שעון)'}
    >
      <div className="grid max-h-96 gap-2 overflow-y-auto pe-1 sm:grid-cols-2 lg:grid-cols-3">
        {canon.map((c) => {
          const arc = arcs[c.id]
          const stage = arc?.stage ?? 0
          const next = c.arc.thresholds[stage + 1] ?? null
          const sync = p?.sync?.[c.id]
          return (
            <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 transition-colors hover:border-slate-600">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold leading-tight text-slate-100" dir="ltr">{c.name}</p>
                  <p className="font-mono text-[10px] text-slate-500" dir="ltr">@{c.id}</p>
                </div>
                <StatusBadge tone={syncTone(sync?.verdict)}>{sync?.verdict ? 'פרופיל' : 'המתנה'}</StatusBadge>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-slate-400" dir="ltr">{c.about}</p>
              <p className="mt-1 text-[10px] italic leading-snug text-slate-500" dir="ltr">{c.lens}</p>

              <div className="mt-2 flex flex-wrap gap-1">
                {c.traits.map((t) => (
                  <span key={t} className="rounded-full border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-[9px] text-slate-300" dir="ltr">{t}</span>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {c.slang.map((sl) => (
                  <span key={sl} className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300" dir="ltr">"{sl}"</span>
                ))}
              </div>

              {/* מסילת הרישום: מקצועי ↔ שכונה */}
              <div className="mt-2">
                <div className="flex items-center justify-between text-[9px] text-slate-500">
                  <span dir="ltr">professional {c.register.pro}%</span>
                  <span dir="ltr">neighborhood {c.register.hood}%</span>
                </div>
                <div className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-900" role="img" aria-label={`רישום: ${c.register.pro}% מקצועי, ${c.register.hood}% שכונתי`}>
                  <div className="h-full bg-emerald-500/70" style={{ width: `${c.register.pro}%` }} />
                  <div className="h-full bg-amber-500/70" style={{ width: `${c.register.hood}%` }} />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {c.owns.map((o) => (
                  <span key={o} className="rounded bg-slate-900/80 px-1.5 py-0.5 text-[9px] text-slate-400">{TOPIC_HE[o] ?? o}</span>
                ))}
              </div>

              {/* קשת-ההתפתחות: נמדדת בפוסטים-חיים */}
              <div className="mt-2 border-t border-slate-800/80 pt-1.5">
                <p className="text-[10px] leading-snug text-slate-400">
                  <span className="font-bold text-orange-300">קשת {stage + 1}/{c.arc.stages.length}:</span> {c.arc.stages[Math.min(stage, c.arc.stages.length - 1)]}
                  {next != null && <span className="text-slate-600"> · שלב-הבא ב-{next} פוסטים</span>}
                  {arc?.lifetimePosts != null && <span className="text-slate-600"> ({arc.lifetimePosts} חיים)</span>}
                </p>
              </div>

              {sync?.verdict && (
                <p className="mt-1.5 text-[9px] leading-snug text-slate-600">{syncLabel(sync.verdict)}{sync.txid ? ' · txid בשרשרת' : ''}</p>
              )}
            </div>
          )
        })}
        {!canon.length && <p className="text-xs text-slate-500">הקאנון ייפתח כשהמנוע יגיב…</p>}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        חוק-הפרסונה: קול-כתיבה, לא ביוגרפיה מדומיינת (אין משפחות-מומצאות, אין מקומות-אמיתיים בשמותם) · אפס מקפים וסלנג-מפתחים במינון טבעי · סנכרון-פרופילים על-השרשרת ממזג-metadata קיים (לעולם לא מוחק), אידמפוטנטי, עד 2 למחזור · {p?.law ?? ''}
      </p>
    </SectionCard>
  )
}
