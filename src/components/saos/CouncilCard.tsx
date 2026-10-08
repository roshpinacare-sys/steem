'use client'

/**
 * CouncilCard: R237 · מועצת-האיברים: רשת-התקשורת החיה בין-הסוכנים.
 *
 * הטענה של המפעיל ("אין תקשורת בין הסוכנים") תוקנה במקור: המנוע קורא כל
 * מחזור את האיברים החיים (custodian :3041 · metrics :3042 · builder :3043)
 * ומדווח: verdicts ממודדים, לא מנוחשים. הכרטיס מציג:
 *   1. רשת-האיברים (verdict + גיל + ראיה לכל איבר)
 *   2. פקודת-העבודה האחרונה engine→builder (המכונה מזינה את מהנדס-שלה)
 *   3. רישום-החסימות (כל חסימה עם בעלים + סיבה, חסימה בלי בעלים לא קיימת)
 *   4. אינטליגנציית-ה-power-up (מדוד: מה הגן על-הסורג, מה נדחה ולמה)
 */
import { Network, ShieldCheck, Hammer, Lock } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { Stat } from './Stat'

type Organ = {
  id?: string
  port?: number
  law?: string
  verdict?: string
  ageMs?: number | null
  error?: string | null
  evidence?: { drift?: { drift?: boolean | null; dirtyNow?: number | null }; builder?: { queue?: number | null; proposals?: number | null } } | null
}
export type CouncilData = {
  at?: string
  mesh?: string
  organs?: Organ[]
  builderTask?: { at?: string; file?: string; basis?: string; verdict?: string | null; error?: string | null } | null
} | null
type Blockage = { source?: string; owner?: string; lawful?: boolean; reason?: string }
type Intel = { verdict?: string; scale?: number; reason?: string; urgency?: string | null; factors?: { planned?: number; askNeed?: number; rcPct?: number | null } } | null

const verdictTone = (v?: string) =>
  v === 'ALIVE' || v === 'MESH-ALIVE' ? 'emerald' : v === 'STALE' || v === 'MESH-PARTIAL' ? 'amber' : 'rose'

export function CouncilCard({ council, blockages, intel }: { council?: CouncilData; blockages?: Blockage[] | null; intel?: Intel }) {
  const organs = council?.organs ?? []
  const mesh = council?.mesh ?? 'MESH-DARK'
  const ageTxt = (ms?: number | null) => (typeof ms === 'number' ? `${Math.round(ms / 1000)}s` : '-')
  return (
    <SectionCard icon={Network} tone={mesh === 'MESH-ALIVE' ? 'emerald' : 'amber'} title="מועצת-האיברים · רשת-התקשורת החיה (R237)">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={verdictTone(mesh) as 'emerald' | 'amber' | 'rose'}>{mesh}</StatusBadge>
        {council?.at && <span className="tnum text-[11px] text-slate-500">{council.at.replace('T', ' ').slice(0, 19)} UTC</span>}
      </div>

      {/* 1 · האיברים: verdicts ממודדים מול /health חי */}
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-900/80 text-slate-400">
              <th className="px-3 py-2 text-right font-medium">איבר</th>
              <th className="px-3 py-2 text-right font-medium">מצב</th>
              <th className="px-3 py-2 text-right font-medium">גיל</th>
              <th className="px-3 py-2 text-right font-medium">ראיה-חיה</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {organs.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3 text-slate-500">המועצה תיפתח במחזור הבא של המנוע (≤10 דק), קריאות /health חיות לכל איבר</td></tr>
            )}
            {organs.map((o) => (
              <tr key={o.id} className="transition-colors hover:bg-slate-800/40">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-200">{o.id} <span className="tnum text-slate-500">:{o.port}</span></div>
                  <div className="text-[10px] text-slate-500">{o.law}</div>
                </td>
                <td className="px-3 py-2"><StatusBadge tone={verdictTone(o.verdict) as 'emerald' | 'amber' | 'rose'}>{o.verdict ?? '?'}</StatusBadge></td>
                <td className="tnum px-3 py-2 text-slate-300">{ageTxt(o.ageMs)}</td>
                <td className="px-3 py-2 text-[10px] text-slate-500">
                  {o.error ? <span className="text-rose-400">{o.error}</span> : null}
                  {o.evidence?.drift && <div>drift: {String(o.evidence.drift.drift)} · dirty: {o.evidence.drift.dirtyNow ?? '-'}</div>}
                  {o.evidence?.builder && <div>queue: {o.evidence.builder.queue ?? '-'} · proposals: {o.evidence.builder.proposals ?? '-'}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 2 · פקודת-העבודה engine→builder: המכונה מזינה את המהנדס שלה */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-300">
          <Hammer className="h-3.5 w-3.5" /> זרימת-עבודה engine→builder (הזנה 1/יום, תור-ריק בלבד)
        </div>
        {council?.builderTask ? (
          <div className="text-[11px] leading-relaxed text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={council.builderTask.verdict === 'QUEUED' ? 'emerald' : 'amber'}>{council.builderTask.verdict ?? '?'}</StatusBadge>
              <span className="font-mono text-slate-300">{council.builderTask.file}</span>
              <span className="tnum text-slate-500">{council.builderTask.at?.replace('T', ' ').slice(0, 19)}</span>
            </div>
            <div className="mt-1">בסיס: {council.builderTask.basis}</div>
            {council.builderTask.error && <div className="text-amber-400">{council.builderTask.error}</div>}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">אין פקודת-עבודה פתוחה: התור מלא או שהלקח-המדוד היומי כבר הוזן</div>
        )}
      </div>

      {/* 3 · רישום-החסימות: כל חסימה עם בעלים + סיבה */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-300">
          <Lock className="h-3.5 w-3.5" /> רישום-החסימות · כל חסימה עם בעלים וסיבה
        </div>
        {!blockages?.length ? (
          <div className="text-[11px] text-slate-500">אין חסימות במחזור-האחרון, הכל רץ</div>
        ) : (
          <div className="space-y-1.5">
            {blockages.map((b, i) => (
              <div key={i} className="text-[11px] leading-relaxed">
                <span className="font-medium text-slate-200">{b.source}</span>
                <span className="mx-1.5 text-slate-500">·</span>
                <span className="text-amber-300/90">בעלים: {b.owner}</span>
                {b.lawful && <span className="ms-1.5 text-emerald-400/80">חוקי</span>}
                <div className="text-slate-400">{b.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4 · אינטליגנציית-ה-power-up: המדוד שמגן על הסורג */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5" /> אינטליגנציית-ה-power-up (מחושב, דוקטרינה-מעל-הכל)
        </div>
        {intel?.verdict ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="פסק-דין" value={intel.verdict} />
            <Stat label="סקאלה" value={`×${(intel.scale ?? 1).toFixed(3)}`} ltr />
            <Stat label="צורך-סורג (STEEM)" value={intel.factors?.askNeed != null ? intel.factors.askNeed.toFixed(3) : '-'} ltr />
            <Stat label="RC%" value={intel.factors?.rcPct != null ? String(intel.factors.rcPct) : '-'} ltr />
            <div className="col-span-2 text-[11px] leading-relaxed text-slate-400 sm:col-span-4">{intel.reason}</div>
            {intel.urgency && <div className="col-span-2 text-[11px] text-amber-300/90 sm:col-span-4">דחיפות: {intel.urgency}</div>}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">אין החלטת-power-up במחזור-האחרון (HOLD/COOLDOWN, ראה רישום-החסימות)</div>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        חוק-המועצה: המנוע קורא, לא חותם, לא משדר. ה-custodian נשאר החותם-היחיד; ה-builder נשאר proposal-only.
        חסימה בלי בעלים היא הסוג-היחיד שהמכונה כבר לא סובלת.
      </p>
    </SectionCard>
  )
}
