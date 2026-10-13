'use client'

import { Store } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import type { Status } from './types'
import type { Tone } from './tones'

/**
 * T-25 · ההצעה — the offer catalog + the memo-payment rail (from status.catalog).
 * The machine SELLS its measured capabilities to the network: payments arrive as
 * on-chain transfers with memo "SAOS-CATALOG:<sku>", detected from chain-truth.
 * Honest law: NO-PAYMENTS renders as the armed-and-watching truth (not an error);
 * underpayments and unknown SKUs are surfaced, never swallowed. Zero blue/indigo.
 */

const verdictTone = (v?: string | null): Tone => {
  const s = v ?? ''
  if (s === 'PAID-NEW') return 'emerald'
  if (s === 'HONEST-EDGE') return 'amber'
  if (/FAIL|ERROR/.test(s)) return 'rose'
  return 'slate'
}

const statusTone = (s?: string | null): Tone =>
  s === 'PAID-NEW' ? 'emerald' : s === 'UNDERPAID' || s === 'UNKNOWN-SKU' ? 'amber' : 'slate'

export function OfferCard({ catalog, feed }: { catalog: Status['catalog']; feed?: Status['feed'] }) {
  if (!catalog) return null

  const skus = catalog.skus ?? []
  const orders = catalog.orders ?? []
  const counts = catalog.counts ?? null

  return (
    <SectionCard
      icon={Store}
      tone="orange"
      className="md:col-span-2 lg:col-span-3"
      title={<>ההצעה · קטלוג-יכולות מדודות <span dir="ltr" className="text-slate-500">(T-25)</span></>}
      actions={
        <>
          {catalog.verdict && (
            <StatusBadge tone={verdictTone(catalog.verdict)} solid title={catalog.verdict}>
              {catalog.verdict === 'PAID-NEW' ? 'הזמנה-חדשה' : catalog.verdict === 'NO-PAYMENTS' ? 'חמוש-וצופה' : catalog.verdict === 'HONEST-EDGE' ? 'קצה-כנה' : catalog.verdict}
            </StatusBadge>
          )}
          {catalog.scan?.rows != null && (
            <span className="tnum text-[10px] text-slate-500" dir="ltr">{catalog.scan.rows} rows scanned</span>
          )}
        </>
      }
      meta="המסילה הלא-פרופורציונלית להון: השרשרת היא קופת-המוכר. תשלום עם זיכרון SAOS-CATALOG:<sku> = הזמנה; לא-מוכר לא נבלע — מוצג כמו שהוא."
    >
      {/* SKU table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[300px] text-right text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
              <th className="py-1.5 font-medium">מוצר</th>
              <th className="py-1.5 font-medium">מחיר</th>
              <th className="py-1.5 font-medium">מימוש</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.id} className="border-b border-slate-800/50 last:border-0">
                <td className="py-1.5 pl-2">
                  <div className="font-bold text-slate-200" dir="ltr">{s.id}</div>
                  {s.what && <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{s.what}</div>}
                </td>
                <td className="tnum py-1.5 text-slate-300" dir="ltr">
                  {s.priceSbd === 0 ? 'חינם' : `${s.priceSbd ?? '—'} SBD`}
                  {s.per && <div className="text-[9px] text-slate-500">{s.per}</div>}
                </td>
                <td className="py-1.5 text-[10px] leading-relaxed text-slate-400">{s.fulfillment ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* orders + honest edges */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2">
          <div className="text-[10px] font-extrabold uppercase text-slate-400">הזמנות-שולמו</div>
          <div className="tnum mt-0.5 text-sm font-black text-emerald-300" dir="ltr">{counts?.paidNew ?? 0}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2">
          <div className="text-[10px] font-extrabold uppercase text-slate-400">תשלום-חלקי</div>
          <div className="tnum mt-0.5 text-sm font-black text-amber-300" dir="ltr">{counts?.underpaid ?? 0}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2">
          <div className="text-[10px] font-extrabold uppercase text-slate-400">sku לא-מוכר</div>
          <div className="tnum mt-0.5 text-sm font-black text-amber-300" dir="ltr">{counts?.unknownSku ?? 0}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2">
          <div className="text-[10px] font-extrabold uppercase text-slate-400">ידועים</div>
          <div className="tnum mt-0.5 text-sm font-black text-slate-300" dir="ltr">{counts?.known ?? 0}</div>
        </div>
      </div>

      {/* T-48 · the external-agent door — the product's second delivery lane */}
      {feed?.tools && feed.tools.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2" dir="ltr">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-bold text-slate-300">agent door (T-48) · POST /mcp — read-only tool registry</span>
            <span className="tnum text-[10px] text-slate-500">{feed.tools.length} tools · {feed.entitlements ?? 0} keys ({feed.entitlementsActive ?? 0} active)</span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-slate-500">{feed.tools.join(' · ')}</div>
          {/* T-59 · door telemetry — demand is measured, not remembered (survives restarts) */}
          {feed.telemetry && typeof feed.telemetry.hits === 'number' && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
              <span className="tnum" dir="ltr">{feed.telemetry.hits} hits{feed.telemetry.lastAt ? ` · last ${String(feed.telemetry.lastAt).slice(0, 16).replace('T', ' ')}Z` : ''}</span>
              {feed.telemetry.byVerdict && Object.keys(feed.telemetry.byVerdict).length > 0 && (
                <span className="font-mono" dir="ltr">
                  {Object.entries(feed.telemetry.byVerdict).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(' · ')}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {orders.length > 0 && (
        <div className="max-h-36 space-y-1 overflow-y-auto">
          {orders.slice(-6).reverse().map((o, i) => (
            <div key={`${o.txid}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800/70 bg-slate-900/30 px-2 py-1 text-[11px]">
              <span className="font-mono text-slate-400" dir="ltr">{o.txid?.slice(0, 12) ?? '—'}</span>
              <span className="text-slate-300" dir="ltr">@{o.from ?? '—'} · {o.sku ?? '—'} · {o.amountSbd ?? '—'} SBD</span>
              <StatusBadge tone={statusTone(o.status)}>{o.status ?? '—'}</StatusBadge>
            </div>
          ))}
        </div>
      )}

      {catalog.law && <p className="text-[10px] leading-relaxed text-slate-500">{catalog.law}</p>}
    </SectionCard>
  )
}
