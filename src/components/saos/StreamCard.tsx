import { ExternalLink, Radio } from 'lucide-react'
import { RailRow } from './RailRow'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'

/**
 * R310 · THE LIVE STREAM CARD (the missing sight-channel).
 * The operator's measured complaint: "אני לא רואה פוסטים" — posts breathe
 * on-chain (proven txids in the sent ledger) and the cockpit had NO panel
 * showing them. This card renders the ENGINE's stream truth (one-body law:
 * computed once at :3040, passed through /api/saos/status): every recent
 * broadcast as a REAL steemit link (title, account, time, txid), today's
 * count vs the released cap, and the runway (queue drafts + revenue-READY
 * packages). Nothing here is measured — everything is displayed.
 */
export function StreamCard({ stream }: { stream: Record<string, unknown> | null }) {
  const posts = (Array.isArray(stream?.posts) ? stream.posts : []) as Array<Record<string, unknown>>
  const todayCount = Number(stream?.todayCount ?? 0)
  const cap = stream?.cap != null ? Number(stream.cap) : null
  return (
    <SectionCard
      icon={Radio}
      tone="emerald"
      title={<>זרם-חי · הפוסטים על-השרשרת <span dir="ltr" className="text-slate-500">(R310)</span></>}
      actions={
        <StatusBadge tone={todayCount > 0 ? 'emerald' : 'slate'} pulse={todayCount > 0}>
          {todayCount}/{cap ?? '?'} היום
        </StatusBadge>
      }
    >
      {posts.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          עדיין אין-שידורים בפנקס; הזרם ניזון מהמחזורים (bridge → תור → משדר) ויתעדכן כאן מיד.
        </p>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto pe-1 [scrollbar-width:thin]">
          {posts.map((p, i) => {
            const url = typeof p.url === 'string' ? p.url : null
            const title = typeof p.title === 'string' && p.title ? p.title : String(p.permlink ?? '').slice(0, 44)
            const at = typeof p.at === 'string' ? p.at.slice(11, 16) : '?'
            const txid = typeof p.txid === 'string' ? p.txid : null
            return (
              <a
                key={i}
                href={url ?? '#'}
                target="_blank"
                rel="noreferrer"
                aria-label={`פתח את הפוסט ${title} של ${String(p.account ?? '')} בsteemit`}
                className="block rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-2 transition-colors hover:border-emerald-500/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-slate-100" dir="ltr">{title || '-'}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-500" dir="ltr">
                  <span>@{String(p.account ?? '?')}</span>
                  <span>{at}Z</span>
                  {txid && <span>tx {txid.slice(0, 10)}…</span>}
                </div>
              </a>
            )
          })}
        </div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <RailRow label="runway · טיוטות-בתור" value={String(stream?.runwayDrafts ?? '-')} ltr />
        <RailRow label="revenue · חבילות-READY" value={String(stream?.readyRevenue ?? '-')} ltr />
      </div>
    </SectionCard>
  )
}
