'use client'

import { Megaphone, ExternalLink } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'
import type { Status } from './types'

/**
 * T-26 · הקול-לרשת · THE PUBLISHER (from status.publish).
 * The drafts finally reach the network: one sanitized draft per day goes out
 * as a REAL post from the doctrine account — chain dedup (get_content is the
 * truth), posting-key only, post-verified on-chain. This card only renders;
 * the engine publishes. Tone law: PUBLISHED/ALREADY-PUBLISHED → emerald;
 * caps/gates/waiting → amber; real failures → rose. Zero blue/indigo.
 */

const verdictTone = (v?: string | null): Tone => {
  const s = (v ?? '').toUpperCase()
  if (s === 'PUBLISHED' || s === 'ALREADY-PUBLISHED') return 'emerald'
  if (/CAP|NO-DRAFT|BLOCKED|GATED|PAUSED|WAITING|INVALID/.test(s)) return 'amber'
  if (/FAIL|ERROR|UNVERIFIED/.test(s)) return 'rose'
  return 'slate'
}

const shortTx = (t?: string | null): string =>
  t ? `${String(t).slice(0, 8)}…${String(t).slice(-6)}` : '—'

export function PublishCard({ publish }: { publish: Status['publish'] }) {
  if (!publish) return null

  const acted = publish.verdict === 'PUBLISHED' || publish.verdict === 'ALREADY-PUBLISHED'
  const title = publish.lastTitle ?? null
  const permlink = publish.lastPermlink ?? null

  return (
    <SectionCard
      icon={Megaphone}
      tone="emerald"
      className="md:col-span-2 lg:col-span-3"
      title={<>קול-הרשת · המפרסם <span dir="ltr" className="text-slate-500">(T-26)</span></>}
      meta="הטיוטות המטוהרות מגיעות לרשת — פוסט-תוכן אחד ביום מהחשבון עצמו: dedup על-השרשרת, מפתח-פרסום בלבד, אימות-אחרי-שידור. טוהר-החשיפה נאכף לפני-התור; לעולם לא נחשוף קואורדינציה."
      actions={
        <>
          {publish.verdict && (
            <StatusBadge tone={verdictTone(publish.verdict)} solid title={publish.reason ?? publish.verdict}>
              {publish.verdict}
            </StatusBadge>
          )}
          {publish.day && <span className="tnum text-[10px] text-slate-500" dir="ltr">{publish.day}</span>}
        </>
      }
    >
      {/* ─── HEADLINE TILES ─── */}
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="פרסומים-היום"
          value={`${publish.publishedToday ?? 0} / ${publish.cap ?? 1}`}
          tone={(publish.publishedToday ?? 0) > 0 ? 'emerald' : 'slate'}
          ltr
          hint="תקרת-תוכן/יום — לצד דוח-השקיפות, לא במקומו"
        />
        <Stat
          label="תור-טיוטות"
          value={`${publish.queueDepthDrafted ?? 0}`}
          tone={(publish.queueDepthDrafted ?? 0) > 0 ? 'amber' : 'slate'}
          ltr
          hint="ממתינות ליום-הפרסום הבא"
        />
        <Stat
          label="פורסמו (מצטבר)"
          value={`${publish.queueDepthPublished ?? 0}`}
          tone={(publish.queueDepthPublished ?? 0) > 0 ? 'emerald' : 'slate'}
          ltr
          hint="הקול חי — כל אחת עם txid על-השרשרת"
        />
      </div>

      {/* ─── THE LAST POST: chain-verified, linked ─── */}
      {acted && (title || permlink) && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-[11px] font-bold text-emerald-300">
              {publish.verdict === 'ALREADY-PUBLISHED' ? 'הפוסט כבר חי על-השרשרת (dedup)' : 'הפוסט חי על-השרשרת — נמצא ב-post-verify'}
            </span>
            {publish.lastTxid && (
              <a
                href={`https://steemscan.com/transaction/${publish.lastTxid}`}
                target="_blank"
                rel="noreferrer"
                className="tnum inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 underline-offset-2 hover:underline"
                dir="ltr"
              >
                {shortTx(publish.lastTxid)}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
          {title && (
            <p className="mt-1 text-[11px] font-semibold leading-relaxed text-emerald-100" dir="ltr">
              “{title}”
            </p>
          )}
          {permlink && (
            <a
              href={publish.lastUrl ?? `https://steemit.com/@headcorner/${permlink}`}
              target="_blank"
              rel="noreferrer"
              className="tnum mt-1 inline-flex max-w-full items-center gap-1 truncate text-[10px] text-emerald-400/90 underline-offset-2 hover:underline"
              dir="ltr"
            >
              steemit.com/@headcorner/{permlink}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          )}
        </div>
      )}

      {/* ─── HONEST STATE WHEN NOT ACTING ─── */}
      {!acted && publish.reason && (
        <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          {publish.reason}
        </p>
      )}

      {/* ─── THE LAWS — small slate footnotes, exactly as enforced ─── */}
      {Array.isArray(publish.laws) && publish.laws.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-slate-600">
          {publish.laws.map((l, i) => (
            <li key={i}><b className="text-slate-500">חוק:</b> {l}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
