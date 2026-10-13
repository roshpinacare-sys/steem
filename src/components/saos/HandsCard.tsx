'use client'

import { Hand, ScanEye, Globe2, Unplug, MousePointerClick } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'

/**
 * T-33 · מסילת-הידיים — the computer-use rail, rendered honestly.
 * CUA-inspired (trycua/cua): an agent that can ACT → PERCEIVE → JUDGE over
 * rendered interfaces, not just APIs. SAOS's loop: agent-browser (the
 * driver), DOM anchors + screenshots (perception), VLM through the vision
 * bridge (the judge), strict fail-closed parsing (the bench law). The card
 * shows the machine's own eyes' verdicts — and the leash: allowlist,
 * act=click-class under intent laws (T-52), sense-class. Tone law:
 * HANDS-OK → emerald, degraded → amber. Zero blue/indigo.
 */

const TASK_LABEL: Record<string, string> = {
  'self-inspect': 'הסתכלות-עצמית · הקוקפיט (דסקטופ+מובייל)',
  presence: 'נוכחות-ציבורית · הפוסט היומי ב-steemit.com',
  'cockpit-tour': 'סיור-הקוקפיט · חמשת המקטעים במובייל (T-52 · ACT)',
}

export function HandsCard({ hands }: { hands: Status['hands'] }) {
  if (!hands) return null
  const ok = hands.verdict === 'HANDS-OK'
  const tone = ok ? ('emerald' as const) : ('amber' as const)

  return (
    <SectionCard
      icon={Hand}
      tone={tone}
      className="md:col-span-2 lg:col-span-3"
      title={<>מסילת-הידיים · לולאת-השימוש-במחשב <span dir="ltr" className="text-slate-500">(T-33 · CUA-inspired)</span></>}
      actions={
        <StatusBadge tone={tone} solid>
          {ok ? 'העיניים פועלות' : 'ירוד · נבדק'}
        </StatusBadge>
      }
      meta="בהשראת trycua/cua: לולאת ACT→PERCEIVE→JUDGE על ממשקים מוצגים — לא רק APIs. המכונה מסתכלת על פניה-שלה ועל הארטיפקט הציבורי שלה, ומדווחת מה העיניים רואות."
    >
      <div className="space-y-1.5">
        {(hands.lastTasks ?? []).length ? (
          (hands.lastTasks ?? []).map((t, i) => (
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {t.task === 'self-inspect' ? (
                    <ScanEye className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  ) : t.task === 'cockpit-tour' ? (
                    <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  ) : (
                    <Globe2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  )}
                  <span className="truncate text-[11px] font-extrabold text-slate-200">
                    {TASK_LABEL[t.task ?? ''] ?? t.task}
                  </span>
                </div>
                <StatusBadge tone={t.ok ? 'emerald' : 'amber'}>
                  {t.verdict ?? (t.ok ? 'ok' : 'fail')}
                </StatusBadge>
              </div>

              {/* self-inspect: per-viewport DOM anchor + the VLM's own summary */}
              {!!(t.shots ?? []).length && (
                <div className="mt-1.5 space-y-1">
                  {(t.shots ?? []).map((s, j) => (
                    <div key={j} className="flex flex-wrap items-baseline gap-x-2 text-[10px] leading-relaxed text-slate-400" dir="ltr">
                      <span className="font-bold text-slate-300">{s.name}</span>
                      <span className={s.domAnchor ? 'text-emerald-400' : 'text-amber-400'}>
                        anchor {s.domAnchor ? '✓' : '✗'}
                      </span>
                      {s.vision ? (
                        <span className={s.vision.rendered ? 'text-emerald-400' : 'text-rose-400'}>
                          vlm {s.vision.rendered ? 'rendered' : 'NOT-rendered'}
                          {s.vision.errorVisible ? ' · error-visible' : ''}
                        </span>
                      ) : (
                        <span className="text-slate-500">vlm unreadable</span>
                      )}
                      {s.vision?.summary && <span className="text-slate-500">· {s.vision.summary}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* presence: which permlinks the public browser actually saw */}
              {!!(t.checked ?? []).length && (
                <p className="tnum mt-1 text-[10px] leading-relaxed text-slate-400" dir="ltr">
                  {(t.checked ?? []).map((c, j) => (
                    <span key={j}>
                      {j > 0 && ' · '}
                      {c.permlink}:{' '}
                      {c.visible ? (
                        <span className="text-emerald-400">visible</span>
                      ) : c.botWall ? (
                        <span className="text-amber-400">bot-walled (Cloudflare)</span>
                      ) : (
                        <span>not-visible</span>
                      )}
                    </span>
                  ))}
                </p>
              )}

              {/* cockpit-tour (T-52): per-section click + aria + the VLM's own verdict */}
              {!!(t.sections ?? []).length && (
                <div className="mt-1.5 flex flex-wrap gap-1.5" dir="ltr">
                  {(t.sections ?? []).map((s, j) => {
                    const good = s.clicked && s.ariaSelected && s.vision?.rendered && !s.vision?.errorVisible
                    return (
                      <span
                        key={j}
                        title={s.vision?.summary ?? s.error ?? s.id ?? ''}
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tnum ${
                          good
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        {s.id ?? '?'}: click {s.clicked ? '✓' : '✗'} · aria {s.ariaSelected == null ? '?' : s.ariaSelected ? '✓' : '✗'} · vlm {s.vision ? (s.vision.rendered ? 'ok' : 'bad') : 'unreadable'}
                      </span>
                    )
                  })}
                </div>
              )}

              {t.error && (
                <p className="mt-1 flex items-center gap-1.5 text-[10px] leading-relaxed text-amber-300" dir="ltr">
                  <Unplug className="h-3 w-3 shrink-0" aria-hidden /> {t.error}
                </p>
              )}
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
            עוד לא רץ — המסילה חמושה, הקצב 6h/24h (או הרצה-מאולצת להוכחה).
          </p>
        )}
      </div>

      {hands.lastRun && (
        <p className="tnum text-[10px] text-slate-500" dir="ltr">last run {hands.lastRun}</p>
      )}
      {hands.law && <p className="text-[10px] leading-relaxed text-slate-500">{hands.law}</p>}
    </SectionCard>
  )
}
