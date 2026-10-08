'use client'

import { BatteryCharging, KeyRound, ShieldCheck, Wallet } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { Stat } from './Stat'
import { RailRow } from './RailRow'
import { StatusBadge } from './StatusBadge'
import { AdoptCredentialFlow } from './AdoptCredentialFlow'
import type { AdoptState } from './useAdoptCredential'
import type { Order, Status } from './types'

/**
 * T-21d · ארנק וקונסול: the ONE authoritative wallet+console card.
 * Replaces the scattered wallet-ish pieces: balances (chain inventory + live chain-read),
 * fuel (measured rails), credential status (engine-held key / keyless / verdict),
 * and the paste-revival adopt flow with explicit step states and a 30s abort guard.
 */
export function WalletConsoleCard({ s, adopt, orders }: { s: Status | null; adopt: AdoptState; orders: Order[] }) {
  const inv = s?.observe?.inventory ?? null
  const fuel = s?.observe?.fuel ?? null
  const cred = s?.credential ?? null
  const exec = s?.execution ?? null
  const asks = orders.filter((o) => o.side === 'ask').length
  const bids = orders.filter((o) => o.side === 'bid').length
  const rcPct = inv?.rcPct ?? s?.live?.rc?.rcPct ?? null
  const rcTone = typeof rcPct === 'number' && rcPct < 20 ? 'amber' : 'emerald'
  const verdict = exec?.verdict ?? null

  return (
    <SectionCard
      icon={Wallet}
      tone="emerald"
      title={<>ארנק וקונסול · <span dir="ltr">{s?.engine?.info?.account ?? 'headcorner'}</span></>}
      actions={cred?.present
        ? <StatusBadge tone="emerald" solid pulse>אישורי-חי</StatusBadge>
        : <StatusBadge tone="rose" solid>אין-תעודה</StatusBadge>}
    >
      {/* יתרות: מלאי-השרשרת הנמדד */}
      {inv ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="STEEM נזיל" value={inv.steem ?? '-'} tone="emerald" ltr />
          <Stat label="SBD" value={inv.sbd ?? '-'} tone="emerald" ltr />
          <Stat label="SP · כוח-שרשרת" value={inv.spOwn != null ? inv.spOwn.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'} hint="המנוף-הריבוני (RC ∝ SP)" ltr />
          <Stat label="דלק-RC" value={typeof rcPct === 'number' ? `${rcPct}%` : '-'} tone={rcTone} hint="רצפת 20% להצבעות" ltr />
        </div>
      ) : s?.live?.balances ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="STEEM נזיל (chain)" value={s.live.balances.steem} tone="emerald" ltr />
          <Stat label="SBD (chain)" value={s.live.balances.sbd} tone="emerald" ltr />
        </div>
      ) : (
        <p className="text-xs text-slate-500">קריאת-chain לא-זמינה כרגע (RPC), מוצג-בכנות</p>
      )}

      {/* מלאי-מוקפא בפקודות-פתוחות */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>מלאי-מוקפא בפקודות-פתוחות:</span>
        <StatusBadge tone="amber">{asks} אסקים</StatusBadge>
        <StatusBadge tone="emerald">{bids} בידים</StatusBadge>
      </div>

      {/* דלק נמדד */}
      <div className="mt-3 space-y-1 border-t border-slate-800 pt-2">
        <RailRow
          label={<span className="flex items-center gap-1.5"><BatteryCharging className="h-3.5 w-3.5 text-emerald-400" aria-hidden />דלק-קיורציה נמדד</span>}
          value={typeof fuel?.fuelUsdPerDay === 'number' ? `$${fuel.fuelUsdPerDay.toFixed(4)}/יום` : '-'}
          tone={(fuel?.fuelUsdPerDay ?? 0) > 0 ? 'emerald' : 'amber'}
        />
        <RailRow label="מחבר/יום" value={typeof fuel?.authorUsdPerDay === 'number' ? `$${fuel.authorUsdPerDay.toFixed(4)}/יום` : '-'} />
        <RailRow label="חלון-מדידה" value={fuel?.windowSpanDays != null ? `${fuel.windowSpanDays} ימים · ${fuel.histLen ?? '-'} אופס` : '-'} ltr />
        {fuel?.windowNote && <p className="text-[10px] leading-relaxed text-amber-400/80">{fuel.windowNote}</p>}
      </div>

      {/* קונסול-אישורים */}
      <div className="mt-3 space-y-1 border-t border-slate-800 pt-2">
        <RailRow
          label={<span className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />חזקת-מפתח</span>}
          value={s?.engine?.info?.keyless ? 'keyless (בלי-מפתח)' : 'מפתח-מוחזק-מנוע'}
          tone={s?.engine?.info?.keyless ? 'amber' : 'emerald'}
        />
        {cred?.keyFile && <RailRow label="קובץ-תעודה" value={cred.keyFile} ltr mono tone="slate" />}
        {/* T-21 · identity-integrity: החשבון-של-המערכת מול חשבון-קובץ-התעודה */}
        {cred?.doctrineAccount && (
          <RailRow label="חשבון-המערכת (דוקטרינה)" value={cred.doctrineAccount} ltr mono tone="emerald" />
        )}
        {cred?.credentialAccount != null && cred.credentialAccount !== cred.doctrineAccount && (
          <RailRow label="חשבון-קובץ-תעודה (זר!)" value={cred.credentialAccount} ltr mono tone="rose" />
        )}
        {cred?.foreignCredential && (
          <p className="text-[10px] leading-relaxed text-rose-300 font-semibold">
            אזעקת-שלמות-זהות: קובץ-התעודה מחזיק חשבון זר: החתימה מתה בכנות, ומסילות-המדידה נשארות על חשבון-המערכת. הדבק את האישורי-הנכון למטה.
          </p>
        )}
        {cred?.alerts != null && cred.alerts > 0 && (
          <RailRow label="התראות-אישורי" value={cred.alerts} tone={cred.present ? 'amber' : 'rose'} />
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {verdict && (
            <StatusBadge tone={verdict === 'VERIFIED' ? 'emerald' : verdict === 'CREDENTIAL-MISMATCH' ? 'amber' : 'rose'} solid>
              <ShieldCheck className="h-3 w-3 me-1" aria-hidden />{verdict}
            </StatusBadge>
          )}
          {exec?.armed != null && (
            <StatusBadge tone={exec.armed ? 'emerald' : 'amber'}>
              {exec.armed ? 'חמוש · דוקטרינה-מוגבל' : 'מושהה/מנוטרל'}
            </StatusBadge>
          )}
          {verdict === 'CREDENTIAL-MISMATCH' && (
            <span className="text-[10px] leading-relaxed text-amber-400/90">
              המפתחות-הנגזרים אינם תואמים את רשויות-השרשרת, הדבק את הסיסמה-הנוכחית למטה (ערוץ-ההקמה-המהיר)
            </span>
          )}
        </div>
      </div>

      {/* paste-revival: אפס-ריסטרט, שירות-עצמי */}
      <div className="mt-3 border-t border-slate-800 pt-2">
        <p className="text-[11px] leading-relaxed text-slate-400">
          <b className="text-slate-200">הקמת-חתימה (שירות-עצמי):</b> הדבק את האישורי: המנוע מאבטח (0600), מאמץ, ומאמת מול-השרשרת באותו-רגע. ערוץ-חלופי: הפל את קובץ-הסיסמה-הראשית כ-<code dir="ltr">upload/headcorner.txt</code>.
        </p>
        <AdoptCredentialFlow adopt={adopt} />
      </div>
    </SectionCard>
  )
}
