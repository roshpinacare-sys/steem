'use client'

import { Globe, PenLine } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-22f · צוותים-עומדים — ONE card, TWO standing teams (from status.webintel + status.content).
 * The engine computes everything (one-body law); this card only renders the truth.
 * Tone law: verdicts map to emerald/amber/rose/slate ONLY (zero blue/indigo).
 * Long lists are scrollable: max-h-60 + a thin local scrollbar (no project-wide class existed).
 */

/* thin scrollbar utility — local law reused by both scroll lists */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700/70'

const relTime = (iso?: string | null): string => {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (min < 1) return 'עכשיו'
  if (min < 60) return `לפני ${min} דק`
  const h = Math.floor(min / 60)
  if (h < 24) return `לפני ${h} שע'`
  return `לפני ${Math.floor(h / 24)} ימים`
}

const intelVerdictTone = (v?: string | null): Tone => {
  const s = v ?? ''
  if (s === 'INTEL-OK') return 'emerald'
  if (/bridge|down|fail|error/i.test(s)) return 'rose'
  if (/gate|cadence|pend/i.test(s)) return 'slate'
  return 'slate'
}

const contentVerdictTone = (v?: string | null, bridgeError?: string | null): Tone => {
  if (bridgeError) return 'rose'
  const s = v ?? ''
  if (s === 'DRAFTS-QUEUED') return 'emerald'
  if (/no-drafts|empty|none/i.test(s)) return 'amber'
  if (/bridge|fail|error/i.test(s)) return 'rose'
  return 'slate'
}

const draftStatusTone = (s?: string): Tone => {
  const v = (s ?? '').toLowerCase()
  if (v === 'drafted' || v === 'queued') return 'emerald'
  if (/pend|wait|hold/i.test(v)) return 'amber'
  if (/block|fail|error/.test(v)) return 'rose'
  return 'slate'
}

type Finding = NonNullable<NonNullable<NonNullable<Status['webintel']>['scans']>[number]['findings']>[number]
type Draft = NonNullable<NonNullable<Status['content']>['queue']>[number]

/**
 * up to `n` findings with breadth-first coverage: one per scan first, then fill (honest spread, not a single-scan dump).
 * Same URL surfaced by several scans = one truth shown once (dedup by url) — no duplicate rows, no duplicate React keys.
 */
function roundRobinPick(lists: Finding[][], n: number): NonNullable<Finding>[] {
  const out: NonNullable<Finding>[] = []
  const seenUrls = new Set<string>()
  for (let i = 0; out.length < n; i++) {
    let any = false
    for (const list of lists) {
      const f = list[i]
      if (f) {
        if (f.url && seenUrls.has(f.url)) continue
        if (f.url) seenUrls.add(f.url)
        out.push(f)
        any = true
        if (out.length === n) break
      }
    }
    if (!any) break
  }
  return out
}

function FindingRow({ f }: { f: NonNullable<Finding> }) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-200" title={f.title ?? f.snippet ?? undefined}>
        {f.title ?? f.host ?? '—'}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-slate-500">{f.host ?? '—'}</span>
      <span className="tnum w-[72px] shrink-0 text-end text-[10px] text-slate-600">{f.date ? f.date.slice(0, 10) : '—'}</span>
    </>
  )
  if (!f.url) {
    return <div className="flex items-center gap-2 px-2.5 py-2">{body}</div>
  }
  return (
    <a
      href={f.url}
      target="_blank"
      rel="noopener noreferrer"
      dir="ltr"
      title={f.url}
      className="flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/50"
    >
      {body}
    </a>
  )
}

export function TeamsCard({ webintel, content }: { webintel: Status['webintel']; content: Status['content'] }) {
  if (!webintel && !content) return null

  const scans = webintel?.scans ?? []
  const findings = roundRobinPick(scans.map((sc) => sc.findings ?? []), 5)
  const failedScans = webintel?.failedScans ?? 0
  const drafts = (content?.queue ?? []).slice(0, 3)
  const exposureBlocked = content?.exposureBlocked ?? 0

  return (
    <SectionCard
      tone="orange"
      className="md:col-span-2 lg:col-span-3"
      title={<>צוותים-עומדים · מודיעין-רשת + תוכן <span dir="ltr" className="text-slate-500">(T-22)</span></>}
      meta="שני-צוותים שמפתחים את-הצבא: סריקות-ממוקדות שמביאות אמת-חיצונית-ממוקורת, וטיוטות-תוכן שנכתבות רק מקרקעין-מדודות."
    >
      {/* ─── WEB-INTEL RECON ─── */}
      {webintel && (
        <section aria-label="מודיעין-רשת · סריקות-ממוקדות">
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
            <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">מודיעין-רשת · סריקות-ממוקדות</h3>
            <StatusBadge tone={intelVerdictTone(webintel.verdict)} solid title={webintel.verdict ?? undefined}>
              {webintel.verdict ?? '—'}
            </StatusBadge>
            <span className="tnum ms-auto text-[10px] text-slate-500" dir="ltr">
              {relTime(webintel.fetchedAt)}
              {scans.length > 0 && <> · {scans.length} סריקות</>}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat label="ממצאים-ממוקורים" value={webintel.totalFindings ?? 0} ltr />
            <Stat label="סריקות-כושלות" value={failedScans} tone={failedScans > 0 ? 'amber' : 'slate'} ltr />
            <Stat label="זבל-שנזרק" value={webintel.droppedJunk ?? 0} hint="בלי-מקור = לא נכנס" ltr />
          </div>

          <div className={`mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 divide-y divide-slate-800/60 ${THIN_SCROLLBAR}`}>
            {findings.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-500">אין ממצאים בסבב-הסריקה הנוכחי — הסבב-הבא ידווח כאן.</p>
            ) : (
              findings.map((f, i) => <FindingRow key={`${f.url ?? 'row'}-${i}`} f={f} />)
            )}
          </div>

          {webintel.law && <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{webintel.law}</p>}
        </section>
      )}

      {webintel && content && <Separator className="my-3 bg-slate-800" />}

      {/* ─── CONTENT DRAFTS ─── */}
      {content && (
        <section aria-label="תוכן · טיוטות-מקורקעות">
          <div className="flex flex-wrap items-center gap-2">
            <PenLine className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
            <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">תוכן · טיוטות-מקורקעות</h3>
            <StatusBadge tone={contentVerdictTone(content.verdict, content.bridgeError)} solid title={content.verdict ?? undefined}>
              {content.verdict ?? '—'}
            </StatusBadge>
            <span className="tnum ms-auto text-[10px] text-slate-500" dir="ltr">{relTime(content.draftedAt)}</span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="טיוטות-בתור" value={content.draftsQueued ?? 0} tone={(content.draftsQueued ?? 0) > 0 ? 'emerald' : 'amber'} ltr />
            <Stat
              label="חשיפה-חסומה"
              value={exposureBlocked}
              tone={exposureBlocked > 0 ? 'amber' : 'slate'}
              hint={exposureBlocked > 0 ? 'לא תקלה — החוק עובד' : undefined}
              ltr
            />
          </div>

          <div className={`mt-2 max-h-60 overflow-y-auto space-y-1.5 ${THIN_SCROLLBAR}`}>
            {drafts.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3 text-xs text-slate-500">אין טיוטות-בתור — התור ייכתב מהמחזור-הבא.</p>
            ) : (
              drafts.map((d, i) => <DraftRow key={`${d.id ?? 'draft'}-${i}`} d={d} />)
            )}
          </div>

          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            שידור-הטיוטות נעול בשער-אימות-האישורי — שער-חוקי, לא תקלה: הטיוטות ממתינות לאימות-החתימה (קונסול-הארנק), ואז נשדרות בטהרת-הנוסח.
          </p>
          {content.law && <p className="mt-1 text-[10px] leading-relaxed text-slate-600">{content.law}</p>}
        </section>
      )}
    </SectionCard>
  )
}

function DraftRow({ d }: { d: NonNullable<Draft> }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-200" dir="ltr" title={d.title ?? undefined}>
          {d.title ?? '—'}
        </span>
        <StatusBadge tone={draftStatusTone(d.status)}>{d.status ?? '—'}</StatusBadge>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {(d.tags ?? []).slice(0, 4).map((t, ti) => (
          <span key={`${t}-${ti}`} dir="ltr" className="rounded-full border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-[9px] leading-none text-slate-400">
            {t}
          </span>
        ))}
        {d.angle && <span className="ms-auto self-center text-[9px] text-slate-600" dir="ltr">{d.angle}</span>}
      </div>
    </div>
  )
}
