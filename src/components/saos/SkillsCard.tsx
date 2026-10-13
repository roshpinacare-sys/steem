'use client'

import { Blocks, ShieldCheck, FlaskConical, Ban } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'

/**
 * T-34 · רישום-היכולות — the skills registry, rendered honestly.
 * The SKILL.md doctrine (agentskills.io, via alirezarezvani/claude-skills —
 * examined live) adopted: the machine's capability face is machine-readable
 * (manifests with triggers, laws, verification, when-NOT-to-use), body
 * progressive-disclosure. Every manifest is generated from real code laws —
 * the bulk 388-skill library, personas, and Python tools were rejected as
 * noise. Tone law: emerald when all manifests validate, amber when any was
 * skipped. Zero blue/indigo.
 */

export function SkillsCard({ skills }: { skills: Status['skills'] }) {
  if (!skills) return null
  const count = skills.count ?? 0
  const skipped = (skills.skipped ?? []).length
  const tone = skipped === 0 && count > 0 ? ('emerald' as const) : ('amber' as const)

  return (
    <SectionCard
      icon={Blocks}
      tone={tone}
      className="md:col-span-2 lg:col-span-3"
      title={<>רישום-היכולות · פנים-קריאות-מכונה <span dir="ltr" className="text-slate-500">(T-34 · SKILL.md)</span></>}
      actions={<StatusBadge tone={tone} solid>{count} מיומנויות</StatusBadge>}
      meta="דוקטרינת SKILL.md (agentskills.io) אומצה מ-alirezarezvani/claude-skills — נבדק חי: האינדקס נושא טריגרים/חוקים/אימות/מגבלות, הגוף נטען-לפי-דרישה. כל מניפסט נוצר מחוקים-אמיתיים-בקוד; הספרייה-המלאה (388 מיומנויות + פרסונות + כלי-Python) נדחתה כרעש."
    >
      <div className="grid gap-1.5 md:grid-cols-2">
        {(skills.skills ?? []).map((s) => (
          <div key={s.name ?? Math.random()} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold text-slate-200" dir="ltr">{s.name}</span>
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
            </div>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-400" dir="ltr">{s.description}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {(s.triggers ?? []).slice(0, 5).map((t) => (
                <span key={t} className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[9px] text-slate-300" dir="ltr">{t}</span>
              ))}
            </div>
            {s.verification && (
              <p className="mt-1 flex items-center gap-1 text-[9px] leading-relaxed text-slate-500" dir="ltr">
                <FlaskConical className="h-3 w-3 shrink-0" aria-hidden /> {s.verification}
              </p>
            )}
            {s.whenNot && (
              <p className="mt-0.5 flex items-start gap-1 text-[9px] leading-relaxed text-amber-400/70" dir="ltr">
                <Ban className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {s.whenNot}
              </p>
            )}
          </div>
        ))}
      </div>

      {skipped > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-300" dir="ltr">
          {skipped} manifest(s) skipped fail-closed: {(skills.skipped ?? []).map((x) => x.reason).join(', ')}
        </p>
      )}
      {skills.law && <p className="text-[10px] leading-relaxed text-slate-500">{skills.law}</p>}
    </SectionCard>
  )
}
