'use client'

import { Users } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { FleetEvidence, MatrixAccount, MatrixChain, PublishVerdict } from './FleetEvidence'
import { cn } from '@/lib/utils'

/**
 * R269 · "וודא הכל על המשתמשים": the whole estate, both chains, one table:
 * authority custody, RC tank, delegations in/out, last post, and an honest
 * publish verdict per body. LIVE-PROVEN beats estimates: a body that posted
 * on-chain within 48h needs no RC math to prove it can publish.
 */
const VERDICT_HEB: Record<string, string> = {
  'LIVE-PROVEN': 'חי-מוכח',
  READY: 'מוכן-לפרסם',
  'RC-LOW': 'RC-נמוך',
  'NO-CUSTODY': 'אין-אפוטרופסות',
  'NOT-EXISTS': 'לא-קיים',
}
const VERDICT_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'slate'> = {
  'LIVE-PROVEN': 'emerald',
  READY: 'emerald',
  'RC-LOW': 'amber',
  'NO-CUSTODY': 'rose',
  'NOT-EXISTS': 'slate',
}

const vfmt = (n?: number) => (typeof n === 'number' && n > 0 ? `${Math.round(n).toLocaleString('en-US')}V` : '-')

function AccountRow({ name, a, vestsToHp }: { name: string; a: MatrixAccount; vestsToHp: number }) {
  const verdict = a.publish?.verdict ?? 'NOT-EXISTS'
  const delOut = a.delegations_out ?? []
  const delIn = a.delegations_in ?? []
  const delSummary = (() => {
    const parts: string[] = []
    if (delIn.length) parts.push(`←${delIn.length} (${vfmt(a.delegations_in_vests)})`)
    if (delOut.length) parts.push(`→${delOut.length} (${vfmt(a.delegations_out_vests)})`)
    return parts.join(' · ') || '-'
  })()
  const delDetail = [
    ...delIn.map((d) => `← ${d.from}: ${Math.round(d.vests).toLocaleString('en-US')}V ≈ ${Math.round(d.vests * vestsToHp).toLocaleString('en-US')} SP/HP`),
    ...delOut.map((d) => `→ ${d.to}: ${Math.round(d.vests).toLocaleString('en-US')}V ≈ ${Math.round(d.vests * vestsToHp).toLocaleString('en-US')} SP/HP`),
  ].join('\n')

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span dir="ltr" className="shrink-0 font-mono text-xs font-bold text-slate-200">{name}</span>
        <StatusBadge tone={VERDICT_TONE[verdict] ?? 'slate'} title={a.publish?.reason ?? undefined}>
          {VERDICT_HEB[verdict] ?? verdict}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[10px]">
        {a.rc ? (
          <span className="shrink-0 font-mono text-slate-400" title={`RC ${a.rc.available_g}G מתוך ${a.rc.max_g}G`}>
            RC {a.rc.available_g}G/{a.rc.max_g}G ({a.rc.pct ?? 0}%)
          </span>
        ) : (
          <span className="shrink-0 text-slate-600">RC -</span>
        )}
        <span className="shrink-0 text-slate-400" title={delDetail || 'אין האצלות'}>
          האצלות {delSummary}
        </span>
        <span dir="ltr" className="hidden shrink-0 font-mono text-slate-500 sm:inline" title={a.last_post ?? undefined}>
          {a.last_post ? a.last_post.slice(5, 10) : '-'}
        </span>
      </div>
    </div>
  )
}

function ChainBlock({ label, chain }: { label: string; chain?: MatrixChain }) {
  const entries = Object.entries(chain?.accounts ?? {})
  const s = chain?.summary
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span dir="ltr" className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">{label}</span>
        <StatusBadge tone={(s?.custodyVerified ?? 0) === (s?.bodies ?? -1) ? 'emerald' : 'amber'}>
          אפוטרופסות {s?.custodyVerified ?? 0}/{s?.bodies ?? 0}
        </StatusBadge>
        <StatusBadge tone="slate">חיים-מוכחים {s?.liveProven ?? 0}</StatusBadge>
        {typeof s?.rcLow === 'number' && s.rcLow > 0 && <StatusBadge tone="amber">RC-נמוך {s.rcLow}</StatusBadge>}
        {typeof s?.noCustody === 'number' && s.noCustody > 0 && <StatusBadge tone="rose">רוטציה {s.noCustody}</StatusBadge>}
      </div>
      <div className="max-h-96 space-y-1 overflow-y-auto pe-1">
        {entries.map(([name, a]) => (
          <AccountRow key={name} name={name} a={a} vestsToHp={chain?.vestsToHp ?? 0} />
        ))}
        {!entries.length && <p className="text-[11px] text-slate-500">אין מדידה, הרץ את probe-r269-fleet-matrix.mjs</p>}
      </div>
    </div>
  )
}

export function FleetMatrixCard({ evi, className }: { evi: FleetEvidence | null; className?: string }) {
  const steem = evi?.matrix?.chains?.steem
  const hive = evi?.matrix?.chains?.hive
  const measuredAt = evi?.matrix?.at ?? null
  const totOut = (steem?.summary?.delegations_out_vests ?? 0) + (hive?.summary?.delegations_out_vests ?? 0)
  const totIn = (steem?.summary?.delegations_in_vests ?? 0) + (hive?.summary?.delegations_in_vests ?? 0)

  return (
    <SectionCard
      icon={Users}
      tone="orange"
      title={<>מטריצת-הצי · כל-המשתמשים · שתי-השרשרות <span dir="ltr" className="text-slate-500">(R269)</span></>}
      meta="סמכות + מכל-RC + האצלות + פרסום-אחרון + פסק-פרסום: מדידה חיה מהצמתים, אפס טענות"
      className={className}
      actions={
        <StatusBadge tone="slate" title={measuredAt ?? undefined}>
          {measuredAt ? `נמדד ${measuredAt.slice(11, 16)}Z` : '-'}
        </StatusBadge>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded border border-slate-800 bg-slate-900/70 px-1.5 py-0.5 text-slate-400">
          האצלות-באחוזה: {Math.round(totOut + totIn).toLocaleString('en-US')} VESTS ≈ {Math.round((totOut + totIn) * (steem?.vestsToHp ?? 0)).toLocaleString('en-US')} SP/HP
        </span>
        <span className={cn('rounded border border-slate-800 bg-slate-900/70 px-1.5 py-0.5', totOut > 0 ? 'text-emerald-400' : 'text-slate-500')}>
          המפעיל-צדק: יש האצלות, {Math.round(totOut).toLocaleString('en-US')}V יוצאות
        </span>
      </div>
      <div className="space-y-3">
        <ChainBlock label="Steem · 14 גופות" chain={steem} />
        <ChainBlock label="Hive · 11 גופות" chain={hive} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
        פסקים: חי-מוכח = פרסם-על-השרשרת תוך 48ש (אין-צורך בהערכה) · מוכן = אפוטרופסות מאומתת + RC מעל קו-הפוסט-הנמדד · RC-נמוך = regen או הרמה-נדרשת · אין-אפוטרופסות = מפתח-רוטציה (תחום-מפעיל). ההאצלות-הנכנסות נמדדות מרשימת-היוצאות של המאצלים-שלנו (הגבלה-כנה של צמתי-הציבור).
      </p>
    </SectionCard>
  )
}
