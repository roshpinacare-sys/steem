'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Activity, Anchor, Banknote, BatteryCharging, Brain, BrainCircuit, CircleCheck, Cpu, GitBranch, HeartPulse, KeyRound, Lightbulb, PauseCircle,
  Play, PlayCircle, Radio, RefreshCw, Route, Scale, ShieldAlert, ShieldCheck, Sigma, Target, TrendingUp, Users, Wrench, Zap
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { SectionCard } from '@/components/saos/SectionCard'
import { AdoptCredentialFlow } from '@/components/saos/AdoptCredentialFlow'
import { Stat } from '@/components/saos/Stat'
import { RailRow } from '@/components/saos/RailRow'
import { StatusBadge } from '@/components/saos/StatusBadge'
import { HonestyBadge } from '@/components/saos/HonestyBadge'
import { SectionNav, SECTIONS, type SectionId } from '@/components/saos/SectionNav'
import MetricsTrends from '@/components/metrics-trends'
import ClaimsAudit from '@/components/claims-audit'
import MerkleCoverage from '@/components/merkle-coverage'
import BuilderQueue from '@/components/builder-queue'
import { useAdoptCredential } from '@/components/saos/useAdoptCredential'
import { WalletConsoleCard } from '@/components/saos/WalletConsoleCard'
import { FleetCard } from '@/components/saos/FleetCard'
import { RolesCard } from '@/components/saos/RolesCard'
import { TeamsCard } from '@/components/saos/TeamsCard'
import { RcTankCard } from '@/components/saos/RcTankCard'
import { EconomicsRailsCard } from '@/components/saos/EconomicsRailsCard'
import { PayoutsCard } from '@/components/saos/PayoutsCard'
import { WeaveCard } from '@/components/saos/WeaveCard'
import SealCard from '@/components/saos/SealCard'
import { X2Card } from '@/components/saos/X2Card'
import type { Status, Sovereign } from '@/components/saos/types'

/* T-21d · the cockpit is now a composition: data plumbing (this file, verbatim behavior)
 * + design primitives (src/components/saos/*). Mobile gets a real segmented app-nav
 * (one section at a time); desktop keeps the full grid as always. */

const f2 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—')
const uptimeStr = (bootedAt?: string): string => {
  if (!bootedAt) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - new Date(bootedAt).getTime()) / 1000))
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}ש ${m}דק` : `${m}דק`
}

export default function Home() {
  const [s, setS] = useState<Status | null>(null)
  const [sov, setSov] = useState<Sovereign | null>(null)
  const [loading, setLoading] = useState(false)
  const [cycling, setCycling] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [cycleMsg, setCycleMsg] = useState<string | null>(null)
  const [actMsg, setActMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // T-21d · mobile section state — default פיקוד; on lg+ every section renders regardless
  const [section, setSection] = useState<SectionId>('command')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const a = await fetch('/api/saos/status', { cache: 'no-store' })
      setS(await a.json())
    } catch {
      setErr('קריאת-הסטטוס נכשלה — נסה רענון')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSov = useCallback(async () => {
    try {
      const a = await fetch('/api/saos/sovereign', { cache: 'no-store' })
      setSov(await a.json())
    } catch { /* next poll retries */ }
  }, [])

  // T-16/T-21d · paste-revival: shared state so the alarm banner + wallet console stay in sync
  const adopt = useAdoptCredential(load)

  const runCycle = useCallback(async () => {
    setCycling(true)
    setCycleMsg(null)
    try {
      /* T-17: the engine acks the start IMMEDIATELY and runs the cycle
       * detached (single-flight + marker). The cockpit polls the engine's
       * own marker until it closes — a UI wait can never outlive-or-kill a
       * healthy multi-vote signing cycle again, and the truth message is
       * built from the ENGINE's own classification, not from a hope. */
      const r = await fetch('/api/saos/engine', { method: 'POST' })
      const ack = await r.json()
      if (!ack.ok && ack.error !== 'cycle-in-flight') {
        setCycleMsg(`המנוע לא זמין: ${ack.error ?? ack.engine ?? 'שגיאה'}`)
        setCycling(false)
        return
      }
      if (ack.error === 'cycle-in-flight') {
        setCycleMsg('מחזור כבר רץ על המנוע — ממתין לסיומו…')
      }
      type Marker = { running?: boolean; health?: string; ms?: number; steps?: Record<string, boolean>; blockedSteps?: string[] | null; failedSteps?: string[] | null; error?: string | null }
      type PollResp = { ok?: boolean; running?: boolean; marker?: Marker | null; rollup?: { measuredTotalUsdPerDay?: number | null } | null; error?: string }
      const deadline = Date.now() + 15 * 60_000
      let done: Marker | null = null
      let rollup: { measuredTotalUsdPerDay?: number | null } | null = null
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 3000))
        const st: PollResp = await fetch('/api/saos/cycle-status', { cache: 'no-store' }).then((x) => x.json())
        const m = st.marker ?? null
        if (m && m.running === false) { done = m; rollup = st.rollup ?? null; break }
        if (st.running === false && m && m.running !== false) { done = { ...m, running: false, health: 'fail', error: 'engine-restarted-mid-cycle' }; break }
      }
      const stepsStr = () => Object.entries(done?.steps ?? {}).map(([k, ok]) => `${k}:${ok ? 'תקין' : 'כשל'}`).join(' · ')
      const measured = `$${(rollup?.measuredTotalUsdPerDay ?? 0).toFixed(4)}/יום`
      if (!done) {
        setCycleMsg('המחזור עדיין רץ מעבר לתקציב-ההמתנה (15 דק) — המנוע ממשיך בצד-שלו; בדוק את כרטיס-המחזור לעדכון')
      } else if (done.health === 'ok') {
        setCycleMsg(`מחזור הושלם (${Math.round((done.ms ?? 0) / 100) / 10}s) · ${stepsStr()} · מדידה ${measured}`)
      } else if (done.health === 'blocked') {
        setCycleMsg(`מחזור הושלם (חסום-חוקי — החתימה ממתינה לאישורי: ${(done.blockedSteps ?? []).join(', ')}) · ${stepsStr()} · מדידה ${measured}`)
      } else {
        setCycleMsg(`מחזור הושלם (כשל — נכשלו: ${(done.failedSteps ?? []).join(', ') || done.error || 'לא-ידוע'}) · ${stepsStr()} · מדידה ${measured}`)
      }
      await load()
    } catch {
      setCycleMsg('הרצת-המחזור נכשלה — בדוק שהמנוע רץ על :3040')
    } finally {
      setCycling(false)
    }
  }, [load])

  const sovAct = useCallback(async (action: string, label: string) => {
    setActing(action)
    setActMsg(null)
    try {
      const r = await fetch('/api/saos/sovereign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const j = await r.json()
      setActMsg(j?.ok ? `${label}: בוצע` : `${label}: נכשל — ${j?.error ?? 'שגיאה'}`)
      await Promise.all([loadSov(), load()])
    } catch {
      setActMsg(`${label}: הרכיב לא זמין כרגע`)
    } finally {
      setActing(null)
    }
  }, [load, loadSov])

  useEffect(() => {
    load()
    loadSov()
    const t = setInterval(load, 30000)
    const t2 = setInterval(loadSov, 30000)
    return () => { clearInterval(t); clearInterval(t2) }
  }, [load, loadSov])

  /** section wrapper: on mobile renders ONLY the active section (filtered by state);
   *  on lg+ every section renders — the full grid as always. */
  function renderSection(id: SectionId, children: ReactNode) {
    const meta = SECTIONS.find((x) => x.id === id)
    if (!meta) return null
    const Icon = meta.icon
    return (
      <section id={`sec-${id}`} aria-label={meta.label} className={cn('scroll-mt-28', section !== id && 'hidden lg:block')}>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md border border-slate-700 bg-slate-900 text-slate-400" aria-hidden>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">{meta.label}</h2>
          <span className="text-[10px] text-slate-600">{meta.hint}</span>
          <span className="h-px flex-1 bg-gradient-to-l from-slate-800 to-transparent" aria-hidden />
        </div>
        <div className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2 lg:grid-cols-3">{children}</div>
      </section>
    )
  }

  const handleSection = useCallback((id: SectionId) => {
    setSection(id)
    requestAnimationFrame(() => {
      document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const realFills = s?.profit?.fills ?? 0
  const realized = s?.profit?.realizedSbd
  const usdPerDay = s?.measuredPerDay ?? null
  const orders = s?.live?.orders ?? []
  const engineUp = s?.engine?.up ?? false
  const target = 1000

  return (
    <div dir="rtl" className="cockpit-glow flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* HEADER */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur supports-[backdrop-filter]:bg-slate-950/70">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/15">
              <Radio className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold leading-tight sm:text-lg">
                <span dir="ltr" className="inline-block align-baseline">SAOS <span className="hidden sm:inline">SOVEREIGN </span>COCKPIT</span>
                <span> · תא-הפיקוד</span>
              </h1>
              <p className="hidden truncate text-xs text-slate-400 sm:block">headcorner · מנוע-ריבוני-מקומי · אמת-מוטבעת-על-שרשרת · אפס-תלות-חיצונית</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge tone={engineUp ? 'emerald' : 'rose'} solid pulse={engineUp}>
              {engineUp ? 'מנוע-חי' : 'מנוע-כבוי'}
            </StatusBadge>
            <Button
              variant="outline"
              size="icon"
              onClick={load}
              disabled={loading}
              aria-label="רענון סטטוס"
              className="h-11 w-11 border-slate-700 hover:bg-slate-800 focus-visible:ring-emerald-500/50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {/* MOBILE SECTION NAV — the app-like menu (hidden on lg+) */}
      <SectionNav active={section} onChange={handleSection} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">
        {err && (
          <Card className="mb-4 border-rose-500/30 bg-rose-500/10 py-0 backdrop-blur-sm" role="alert">
            <CardContent className="p-4 text-sm text-rose-300">{err}</CardContent>
          </Card>
        )}

        {/* T-80 · באנר-הקפאה-ריבונית — דבר-מפעיל 2026-10-04: המערכת עובדת אוטומטית בלי-חשיבה → עצירה, ביקורת, שער-חשיבה.
            מוצג תמיד כשהמנוע כבוי או הריבונות מושהית — המפעיל חייב לראות את מצב-העצירה בראש-העמוד, לא דף-ריק. */}
        {(sov?.state?.paused || !engineUp) && (
          <Card className="mb-4 border-amber-500/40 bg-amber-500/10 py-0 backdrop-blur-sm" role="status">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-500/40 bg-amber-500/20">
                  <ShieldAlert className="h-5 w-5 text-amber-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-amber-300">
                    {sov?.state?.paused ? 'הקפאה-ריבונית (T-80) · הריבונות מושהית בפקודת-המפעיל' : 'T-80 · המנוע כבוי — האוטונומיה קפואה'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                    נעצר ונבדק בעקבות דבר-המפעיל (04.10): האצלות-אוטומטיות, מימון-חיילים חסרי-מפתח ושימוש-בהם בגריד — הופסקו ונחסמו מבנית.
                    שער-חשיבה (Think Gate) פעיל על כל שידור: אפוטרופסות-מוכחת קודם, העברות-כספים והאצלות אסורות כברירת-מחדל, כל החלטה מתועדת ביומן.
                    המנוע יופעל מחדש רק בהוראת-מפעיל (כפתור-ההפעלה בכרטיס-הריבונות).
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* T-15 · אזעקת-חתימה-מתה — לעולם לא שוב ריקבון-שקט: 3 סוכנים מתים בשקט יום-שלם עד שזה נחשף.
            המערכת חייבת לצרוח בראש-העמוד, עם נתיב-ההקמה המדויק. */}
        {s?.credential?.armedButNoCredential && (
          <Card className="mb-4 border-rose-500/40 bg-rose-500/10 py-0 backdrop-blur-sm" role="alert">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-rose-500/40 bg-rose-500/20">
                  <KeyRound className="h-5 w-5 text-rose-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-rose-300">חתימה-מתה · האישורי לא נמצא ({s.credential.agentsAffected?.join(', ') ?? 'סוכנים-חותמים'} לא עובדים)</p>
                  <p className="mt-1 text-xs leading-relaxed text-rose-200/80">
                    איפוס-הסביבה מחק את <code className="text-rose-300" dir="ltr">{s.credential.keyFile ?? '.secrets/headcorner.key'}</code>
                    {s.credential.missingSince && <> · מת כנראה מאז <span dir="ltr">{s.credential.missingSince.slice(0, 16).replace('T', ' ')}</span> UTC</>}
                    · הספר על-השרשרת נשאר חי, המחזורים ממשיכים — רק פעולות-חתימה מושבתות.
                  </p>
                  <p className="mt-1.5 text-xs font-semibold leading-relaxed text-emerald-300/90">
                    ההקמה (שירות-עצמי, אפס-ריסטרט): הדבק את האישורי למטה — המנוע מאבטח (0600), מאמץ, ומאמת מול-השרשרת באותו-רגע. ערוץ-חלופי: הפל את קובץ-הסיסמה-הראשית כ-<code dir="ltr">upload/headcorner.txt</code>.
                  </p>
                  {/* T-16 · בזבוז-VP — המחיר-הנראה של החתימה-החסומה (מדוד + מוערך) */}
                  {!!s.spoilage && ((s.spoilage.votesForegone ?? 0) > 0 || (s.spoilage.estSteemForegone ?? 0) > 0) && (
                    <p className="mt-1.5 text-xs font-semibold text-amber-300">
                      בזבוז-VP מתמשך: <span dir="ltr">{s.spoilage.votesForegone}</span> קולות-שנמנעו ב־<span dir="ltr">{s.spoilage.daysBlocked}</span> ימי-חסימה
                      {(s.spoilage.estSteemForegone ?? 0) > 0 && <> · ~<span dir="ltr">{s.spoilage.estSteemForegone}</span> STEEM שנמנעו <HonestyBadge kind="estimated" className="mx-1 px-1 py-0 text-[10px]" /></>}
                      <span className="font-normal text-amber-200/60"> · {s.spoilage.note}</span>
                    </p>
                  )}
                  {/* T-16/T-21d · paste-revival — הדרך-המהירה ביותר בחזרה לצי-חותם (מצב-משותף עם כרטיס הארנק) */}
                  <AdoptCredentialFlow adopt={adopt} compact />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!s && !err && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm" />
            ))}
          </div>
        )}

        {s && (
          <div className="space-y-6">
            {renderSection('command', (
              <>
                <WalletConsoleCard s={s} adopt={adopt} orders={orders} />

                {/* חותם-הרשת · המעטפות הקנוניות + דלת-ההשבה (r135) — המפעיל: החותם צריך להיות בתא-הפיקוד */}
                <SealCard />

                {/* ריבונות-מתמשכת · המערכת דואגת לעצמה (T-10) */}
                <SectionCard
                  icon={ShieldCheck}
                  tone="emerald"
                  title={<>ריבונות-מתמשכת · דואגת-לעצמה <span dir="ltr" className="text-slate-500">(T-10)</span></>}
                  actions={
                    <StatusBadge tone={sov?.state?.paused ? 'amber' : 'emerald'} pulse={!sov?.state?.paused}>
                      {sov?.state?.paused ? 'מושהה' : 'חמושה-אוטומטית'}
                    </StatusBadge>
                  }
                >
                  <RailRow label="זמן-רציפות" value={uptimeStr(sov?.state?.bootedAt)} />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stat label="בדיקות-דופק" value={sov?.state?.watchdog?.checks ?? '—'} hint={`נפילות ${sov?.state?.watchdog?.downs ?? 0}`} />
                    <Stat label="ריפויים-עצמיים" value={sov?.state?.watchdog?.heals ?? 0} tone="emerald" hint={`אומתו ${sov?.state?.watchdog?.healVerified ?? 0}`} />
                    <Stat
                      label="מחזורים-אוטומטיים"
                      value={sov?.state?.cycles?.ok ?? 0}
                      tone={(sov?.state?.cycles?.ok ?? 0) > 0 && sov?.state?.cycles?.lastOk !== false ? 'emerald' : 'slate'}
                      hint={`${sov?.state?.cycles?.blocked ?? 0} חסומים-חוקי · ${sov?.state?.cycles?.fail ?? 0} כשלים`}
                    />
                    <Stat label="מחזור-בא-בעקבות" value={sov?.state?.cycles?.nextAt ? `${Math.max(0, Math.round((new Date(sov.state.cycles.nextAt).getTime() - Date.now()) / 60000))} דק` : '—'} />
                  </div>
                  <MetricsTrends />
                  <ClaimsAudit />
                  <MerkleCoverage />
                  <BuilderQueue />
                  <div className="mt-2">
                    <RailRow
                      label="ביקורת-איכות (selftest) · כל 6 שעות"
                      value={sov?.state?.selftest?.lastAt
                        ? <StatusBadge tone={sov.state.selftest.lastOk ? 'emerald' : 'rose'}>{sov.state.selftest.lastOk ? 'עובר' : 'נכשל'} {sov.state.selftest.passed}/{sov.state.selftest.total}</StatusBadge>
                        : <span className="text-xs font-normal text-slate-500">ריצה-ראשונה בעוד רגעים…</span>}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Button onClick={() => sovAct(sov?.state?.paused ? 'resume' : 'pause', sov?.state?.paused ? 'הפעלה' : 'השהיה')} disabled={acting !== null} size="sm" variant="outline" aria-label={sov?.state?.paused ? 'הפעל-ריבונות' : 'השהה-ריבונות'} className="h-11 border-slate-700 px-0 hover:bg-slate-800">
                      {sov?.state?.paused ? <PlayCircle className="h-4 w-4" aria-hidden /> : <PauseCircle className="h-4 w-4" aria-hidden />}
                      <span className="text-[11px] ms-1">{sov?.state?.paused ? 'הפעל' : 'השהה'}</span>
                    </Button>
                    <Button onClick={() => sovAct('kick-cycle', 'כפיית-מחזור')} disabled={acting !== null || sov?.state?.paused} size="sm" variant="outline" aria-label="כפה-מחזור-ריבונות" className="h-11 border-slate-700 px-0 hover:bg-slate-800">
                      <HeartPulse className="h-4 w-4" aria-hidden />
                      <span className="text-[11px] ms-1">מחזור</span>
                    </Button>
                    <Button onClick={() => sovAct('force-heal', 'כפיית-ריפוי')} disabled={acting !== null} size="sm" variant="outline" aria-label="כפה-ריפוי-ריבונות" className="h-11 border-slate-700 px-0 hover:bg-slate-800">
                      <Wrench className="h-4 w-4" aria-hidden />
                      <span className="text-[11px] ms-1">ריפוי</span>
                    </Button>
                  </div>
                  {actMsg && <p className="mt-2 text-[11px] text-emerald-300/90 break-words">{actMsg}</p>}
                  <Separator className="my-3 bg-slate-800" />
                  <div className="max-h-24 space-y-1 overflow-y-auto">
                    {(sov?.events ?? []).slice(0, 4).map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="tnum">{e.at?.slice(11, 19)}</span>
                        <span className="text-emerald-300/80">{e.kind}</span>
                      </div>
                    ))}
                    {!sov?.events?.length && <p className="text-[11px] text-slate-500">יומן-החלטות ייפתח עם הביקורת-הראשונה…</p>}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    עצמאית-מהפעלה-שלך: מתעוררת עם השרת · דופק כל {sov?.intervals?.watchdogSec ?? 60} שניות · מחזור כל {Math.round((sov?.intervals?.cycleSec ?? 600) / 60)} דק · איכות כל {Math.round((sov?.intervals?.selftestSec ?? 21600) / 3600)} שעות. החתימה על-השרשרת מוחזקת-מנוע מאז T-12 (הוראת-עומד, מוגבלת-דוקטרינה) · השהיה = מתג-ההרג שלך.
                  </p>
                </SectionCard>

                {/* מנוע-ריבוני מקומי · שליטה (T-9d) */}
                <SectionCard
                  icon={Cpu}
                  tone="emerald"
                  title={<>מנוע-ריבוני-מקומי · <span dir="ltr">:3040</span> <span dir="ltr" className="text-slate-500">(T-9)</span></>}
                  actions={
                    <StatusBadge tone={engineUp ? 'emerald' : 'rose'} solid pulse={engineUp}>
                      {engineUp ? 'למעלה · מפתח-מוחזק-מנוע' : 'מושבת'}
                    </StatusBadge>
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="slate">account: {s?.engine?.info?.account ?? 'headcorner'}</StatusBadge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    observe → intel → tick → peg → convert → curate → execute → soldiers → learn → report — הכל מקומי, אפס-רפו-חיצוני. חתימה-מנוע-מוחזקת מאז T-12 (מוגבלת-דוקטרינה) · מתג-הרג = השהיה.
                  </p>
                  <Button onClick={runCycle} disabled={cycling || !engineUp} size="sm" aria-label="הרץ-מחזור-מנוע" className="mt-3 h-11 w-full border border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 focus-visible:ring-emerald-500/50">
                    <Play className="h-4 w-4 me-1.5" aria-hidden />
                    {cycling ? 'מריץ מחזור…' : 'הרץ מחזור עכשיו'}
                  </Button>
                  {cycleMsg && (
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-300/90 break-words" role="status" aria-live="polite">{cycleMsg}</p>
                  )}
                  <Separator className="my-3 bg-slate-800" />
                  <RailRow label="מחזור-אחרון" value={s?.rails?.autonomy?.lastCycle ? s.rails.autonomy.lastCycle.slice(11, 19) + ' UTC' : '—'} ltr />
                  <RailRow label="טיקים" value={s?.grid?.runCount ?? '—'} className="mt-1" />
                </SectionCard>

                {/* משימה */}
                <SectionCard icon={Target} tone="slate" title="המשימה · $1000/יום">
                  <div className="flex items-baseline gap-2">
                    <span className="tnum text-3xl font-black text-amber-400">${usdPerDay !== null ? usdPerDay.toFixed(2) : '—'}</span>
                    <span className="text-xs text-slate-400">נמדד/יום · מתוך ${target}</span>
                  </div>
                  <Progress value={Math.min(((usdPerDay ?? 0) / target) * 100, 100)} className="mt-3 h-2 bg-slate-800 [&>div]:bg-amber-400" />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {s?.execution?.verdict === 'VERIFIED'
                      ? 'מצב-חי (T-12): המנוע חתום וריבוני — ספר-פאריטי פרוס בחוקי-הרצפה, צי-חיילים על-הספר, מסילת-קידום רצה, הכל מוגבל-דוקטרינה ומתועד-על-השרשרת. ההכנסה נמדדת ממילויים אמת בלבד.'
                      : 'כל-מסילות-הביצוע קיימות וחמושות (ספר · המרה · חיילים · קידום) — מוגבלות-דוקטרינה. החסימה-היחידה: התאמת-מפתח.'}
                  </p>
                </SectionCard>

                {/* מד-אמת חי */}
                <SectionCard icon={Sigma} tone="emerald" title="מד-אמת חי · מילויים-מהשרשרת">
                  <div className="tnum text-4xl font-black text-emerald-400">{realFills}</div>
                  <p className="mt-1 text-xs text-slate-400">fill_order אמת בחלון-המדידה</p>
                  <Separator className="my-3 bg-slate-800" />
                  <RailRow
                    label="ממומש (A-10)"
                    value={typeof realized === 'number' ? `${realized.toFixed(3)} SBD` : '—'}
                    tone={(realized ?? 0) >= 0 ? 'emerald' : 'amber'}
                  />
                  <RailRow label="מילוי-אחרון" value={s?.observe?.lastFillAt ? s.observe.lastFillAt.slice(0, 16).replace('T', ' ') : '—'} ltr className="mt-1" />
                </SectionCard>
              </>
            ))}

            {renderSection('market', (
              <>
                {/* מיקרו-מסחר · דופק-רשת (T-19) — השוק נמדד, לא מובטח */}
                <SectionCard
                  icon={Activity}
                  tone="emerald"
                  title={<>מיקרו-מסחר · דופק-רשת <span dir="ltr" className="text-slate-500">(T-19)</span></>}
                  actions={<HonestyBadge kind="measured" />}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {s?.offer?.market?.tradesPerDay != null ? (
                      <span>
                        כל-השוק: <b className="tnum text-slate-200">{s.offer.market.tradesPerDay}</b> עסקאות/יום ({s.offer.market.trades ?? 0} ב-{s.offer.market.windowHours ?? 24}ש) · נפח <b className="tnum text-slate-200">{s.offer.market.volSteem ?? 0}</b> STEEM
                      </span>
                    ) : (
                      <span>מדידת-דופק-השוק תרוץ במחזור-הבא (מקצב 30 דק)</span>
                    )}
                    {!!s?.offer?.market?.book?.spreadBps && <span>מרווח-ספר <b className="tnum text-slate-200">{s.offer.market.book.spreadBps}bps</b>{s?.offer?.publishedAt && <span className="text-slate-600" dir="ltr"> @{s.offer.publishedAt.slice(11, 19)}Z</span>}</span>}
                    {!!s?.offer?.market?.rangeBps && <span>תנודה-24ש <b className="tnum text-slate-200">{s.offer.market.rangeBps}bps</b></span>}
                  </div>
                  {s?.offer?.flow ? (
                    <div className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-[11px]">
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Target className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> שכבת-זרימה <b className="text-emerald-300">פעילה</b> — נוכחות בחזית-הספר
                      </div>
                      <div className="ms-5 text-slate-500">
                        {s.offer.flow.flowAsks ?? 0} asks חזיתיים מ-{s.offer.flow.bestAsk ?? '—'} · {s.offer.flow.flowBids ?? 0} bids מ-{s.offer.flow.bestBid ?? '—'} · מרווח {s.offer.flow.spacingBps}bps · תקציב {s.offer.flow.askBudgetSteem ?? 0} STEEM / {s.offer.flow.bidBudgetSbd ?? 0} SBD
                      </div>
                      <div className="ms-5 text-slate-600">
                        עוגן-אמת: לעולם לא מוכרים מתחת לפיד-העדים ({s.offer.flow.feedAnchor ?? '—'} SBD/STEEM) — השוק-החי-היחיד-שקיים. רצפת-VF1 ({s.offer.marks?.floor ?? '—'}) שומרת על 80% מההון.
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">שכבת-הזרימה מושהית — אין קריאת-ספר-חי במחזור-האחרון (המנוע ממשיך בשכבת-הערך בלבד).</p>
                  )}
                  {!!s?.offer?.book && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      ספר-חי: asks {s.offer.book.bestAsk ?? '—'} / bids {s.offer.book.bestBid ?? '—'} · עומק {s.offer.book.askDepthSteem ?? '—'} STEEM / {s.offer.book.bidDepthSbd ?? '—'} SBD
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">אמת-מדידה: השוק-הפנימי סוחר ~49 עסקאות/יום (נמדד 2026-09-30) — זו התקרה-הכנה של כל אסטרטגיית-לכידה במקום-הזה. המכונה מייצרת נוכחות-מקסימלית בחזית ולוכדת נתח-זרימה, בלי להבטיח זרימה שהשוק לא נותן.</p>
                </SectionCard>

                {/* HYPER-GRID · שכבת-הנפח (T-19b) — המנוע שמייצר אלפי פעולות-שרשרת ביום */}
                <SectionCard
                  icon={Zap}
                  tone="amber"
                  title={<>HYPER-GRID · שכבת-הנפח <span dir="ltr" className="text-slate-500">(T-19b)</span></>}
                  actions={<StatusBadge tone="amber">{s?.hyper?.running ? 'חי' : 'כבוי'} · {s?.hyper?.lastVerdict ?? '—'}</StatusBadge>}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {s?.hyper?.ops?.opsToday != null && (
                      <span>
                        <b className="tnum text-amber-200">{s.hyper.ops.opsToday.toLocaleString()}</b> ops היום מתוך תקציב <b className="tnum text-slate-200">{(s.hyper.ops.opsDayCap ?? 0).toLocaleString()}</b>
                      </span>
                    )}
                    {s?.hyper?.liveHyper != null && <span>הזמנות-חיות: <b className="tnum text-slate-200">{s.hyper.liveHyper}</b></span>}
                    {s?.hyper?.rcPct != null && <span>RC: <b className="tnum text-slate-200">{s.hyper.rcPct}%</b></span>}
                  </div>
                  {s?.hyper?.ops?.opsToday != null && (s.hyper.ops.opsDayCap ?? 0) > 0 && (
                    <div className="mt-2">
                      <Progress value={Math.min(100, (s.hyper.ops.opsToday / (s.hyper.ops.opsDayCap ?? 1)) * 100)} aria-label="ops day budget" className="[&>div]:bg-amber-400" />
                    </div>
                  )}
                  {s?.hyper?.economics?.opsPerDay != null && (
                    <div className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-[11px]">
                      <div className="text-slate-400">
                        שיווי-משקל-נמדד: <b className="tnum text-amber-200">{s.hyper.economics.opsPerDay.toLocaleString()}</b> ops/יום — מיכל-RC {s.hyper.economics.regenPerDay != null ? `${(s.hyper.economics.regenPerDay / 1e12).toFixed(2)} טריליון` : '—'} שמתחדש 20%/יום, זוג-ריקוט (ביטול+יצירה) עולה {(s.hyper.economics.pairCost ?? 0) > 0 ? ((s.hyper.economics.pairCost ?? 0) / 1e6).toFixed(1) + 'M RC' : '—'} (מדידה-חיה rc-probe 2026-09-30).
                      </div>
                      <div className="text-slate-500">
                        לעומת התקציב-הישן (1,500/יום): זהו שיפור של <b className="text-amber-300">×{(s.hyper.economics.opsPerDay / 1500).toFixed(0)}</b> בנפח-הייצור. המושל שומר: רצפת-RC 25% (הצבעות לעולם לא נחנקות), שורף-רק-את-מה-שמתחדש.
                      </div>
                      {!!s?.hyper?.ops?.chainTail && (
                        <div className="text-slate-600">
                          אמת-שרשרת (זנב-400-אופס, {s.hyper.ops.chainTailAt ? new Date(s.hyper.ops.chainTailAt).toLocaleTimeString('he-IL') : '—'}): {s.hyper.ops.chainTail.creates ?? 0} יצירות + {s.hyper.ops.chainTail.cancels ?? 0} ביטולים = <b className="tnum">{s.hyper.ops.chainTail.total ?? 0}</b> פעולות-ספר של-החשבון-כולו (היפר + מחזור + חותם-שני).
                        </div>
                      )}
                      <div className="text-slate-600">
                        סולם-ה-100,000× (חוק-גידול נמדד): ops/יום ∝ מיכל-RC ∝ SP. היום 4,034 SP → ~32k/יום; 40k SP → ~320k/יום; תקרת-קצב-השרשרת (טקס/3ש × אצווה) ≈ 2.9M/יום. המנוף: האצלת-RC נכנסת אוטומטית ל-max_rc — השכבה מרוויחה ריאות בלי-שינוי-קוד.
                      </div>
                    </div>
                  )}
                  {s?.hyper?.lastTxid && (
                    <div className="mt-2 font-mono text-[10px] break-all text-slate-600">
                      שידור-אחרון: {s.hyper.lastTxid} · טיק-אחרון {s?.hyper?.lastTickAt ? new Date(s.hyper.lastTickAt).toLocaleTimeString('he-IL') : '—'} · טיקים: {s?.hyper?.ticks ?? 0}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">כנות: ops = נוכחות-ואופציה, לא רווח. כל פעולה ממקמת-מחדש רמה-חוקית בחזית-הספר (עוגן-פיד + תקרה); מילויים נמדדים בנפרד (fill_order) וה-P&amp;L נשאר כן (A-10). TTL-ריקוט מתויג כשימור-נוכחות — אפס-ציפייה-למילוי.</p>
                </SectionCard>

                {/* פאריטי + הצעה */}
                <SectionCard icon={Scale} tone="slate" title="הצעת-פאריטי · peg">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={s?.offer?.verdict === 'OFFER-READY' ? 'emerald' : 'amber'} solid>
                      <CircleCheck className="h-3 w-3 me-1" aria-hidden />{s?.offer?.verdict ?? '—'}
                    </StatusBadge>
                    {s?.offer?.marks?.lowConfidence && <StatusBadge tone="amber">מקור-פנימי · ביטחון-מופחת</StatusBadge>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Stat label="פאריטי" value={s?.offer?.marks?.paritySbdPerSteem ?? '—'} ltr />
                    <Stat label="סטייה (bps)" value={s?.offer?.parityBps ?? '—'} ltr />
                    <Stat label="אסקים" value={s?.offer?.plan?.asks?.length ?? '—'} tone="amber" />
                    <Stat label="בידים" value={s?.offer?.plan?.bids?.length ?? '—'} tone="emerald" />
                    <Stat label="רצפה" value={s?.offer?.marks?.floor ?? '—'} ltr />
                    <Stat label="dragK" value={s?.offer?.marks?.dragK ?? '—'} ltr hint="מבנה-החזקה — נגזר ממרווח-הספר במחזור-זה (dragK-הטיק ביומן נגרר-בנפרד מסטיית-הפאריטי)" />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">דוקטרינה: אמת-מחיר-או-כלום · אין-מכירה-מתחת-לפאריטי · מקור: {s?.offer?.marks?.source ?? '—'}</p>
                </SectionCard>

                {/* סולם-חי */}
                <SectionCard
                  icon={Activity}
                  tone="slate"
                  className="md:col-span-2 lg:col-span-2"
                  title="הסולם-החי · פקודות-פתוחות על ספר-STEEM"
                >
                  {orders.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      הספר ריק באמת (ordersOk: {String(s?.observe?.ordersOk ?? true)}) — כל ההון נזיל וממתין לפריסה בשער-האופרטור. התוכנית הדוקטרינית מוכנה בכל-מחזור.
                    </p>
                  ) : (
                    <div className="max-h-72 overflow-auto rounded-lg border border-slate-800">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead className="sticky top-0 bg-slate-900 text-xs text-slate-400">
                          <tr>
                            <th className="px-3 py-2 text-start font-medium">orderid</th>
                            <th className="px-3 py-2 text-start font-medium">צד</th>
                            <th className="px-3 py-2 text-start font-medium">מוכן-למכירה</th>
                            <th className="px-3 py-2 text-start font-medium">מקבל</th>
                            <th className="px-3 py-2 text-start font-medium">יחידה SBD/STEEM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((o) => (
                            <tr key={o.orderid} className="border-t border-slate-800/70 transition-colors hover:bg-slate-800/40">
                              <td className="tnum px-3 py-2 text-slate-400">{o.orderid}</td>
                              <td className="px-3 py-2">
                                <StatusBadge tone={o.side === 'ask' ? 'amber' : 'emerald'}>{o.side === 'ask' ? 'מכירה' : 'קנייה'}</StatusBadge>
                              </td>
                              <td className="tnum px-3 py-2">{o.base}</td>
                              <td className="tnum px-3 py-2 text-slate-300">{o.quote}</td>
                              <td className="tnum px-3 py-2 font-bold">{o.unit.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SectionCard>
              </>
            ))}

            {renderSection('army', (
              <>
                {/* הצי · אמת-אחת לכל-הסוכנים (T-15) */}
                <FleetCard s={s} />

                {/* T-21d · גיוס-תפקידים — אופציונלי, נטען רק כשהמנוע מדווח */}
                <RolesCard roles={s.roles} />

                {/* T-22f · הצוותים-העומדים — מודיעין-רשת + טיוטות-תוכן; אופציונלי, נטען רק כשהמנוע מדווח */}
                <TeamsCard webintel={s.webintel} content={s.content} />

                {/* T-23f · אריגה · חוזה-הגוף-האחד עם-החותם-השני; אופציונלי, נטען רק כשהמנוע מדווח */}
                <WeaveCard weave={s.weave} />

                {/* חיילים · צי-גרידים (T-12) · T-80 הקפאת-אפוטרופסות */}
                <SectionCard
                  icon={Users}
                  tone="orange"
                  title={<>חיילים · צי-גרידים <span dir="ltr" className="text-slate-500">(T-12)</span></>}
                  actions={<StatusBadge tone={s?.soldiers?.frozen ? 'amber' : s?.soldiers?.deployed ? 'emerald' : 'slate'}>{s?.soldiers?.frozen ? 'מוקפא · אין-אפוטרופסות' : s?.soldiers?.deployed ? `פרוס · ${s.soldiers.accounts?.length ?? 0} חיילים` : 'ממתין-לפריסה'}</StatusBadge>}
                >
                  {s?.soldiers?.frozen && (
                    <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300">
                      {s?.soldiers?.t80 ?? 'T-80: חיילים חסרי-מפתח מוקפאים — אפס מימון, אפס גריד, אפס חתימה'}
                    </p>
                  )}
                  {s?.soldiers?.fundedEach && (
                    <p className="text-[11px] text-slate-500">{s.soldiers.fundedEach.steem} STEEM + {s.soldiers.fundedEach.sbd} SBD לחייל</p>
                  )}
                  {!!s?.soldiers?.accounts?.length && (
                    <div className="mt-2 space-y-1">
                      {s.soldiers.accounts.map((a, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-200">{a.name}</span>
                          <span className={`font-mono text-[10px] ${a.custody === 'verified' ? 'text-emerald-400' : 'text-amber-500'}`}>
                            {a.custody === 'verified' ? `fp ${a.fingerprint}` : 'אין-מפתח · קפוא'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!s?.soldiers?.deployed && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      תוכנית-הצי: 3 חיילים (hcsoldier1..3) · מומנו מהמאסטר · כל-אחד מריץ סולם-מיקרו-משלו עם-אותן-חוקי-רצפת/פאריטי — מעמיק את האחיזה בספר. הפריסה חסומה-כנות עד-התאמת-מפתח (fail-closed).
                    </p>
                  )}
                </SectionCard>
              </>
            ))}

            {renderSection('economy', (
              <>
                {/* רווחיות-אמת (A-10) */}
                <SectionCard icon={Banknote} tone="amber" title="רווחיות-אמת · יסוד-עלות ממומש">
                  <div className="flex items-baseline gap-2">
                    <span className={`tnum text-3xl font-black ${(s?.profit?.realizedSbd ?? 0) >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {typeof s?.profit?.realizedSbd === 'number' ? `${s.profit.realizedSbd.toFixed(3)} SBD` : '—'}
                    </span>
                    <span className="text-xs text-slate-400">ממומש (A-10)</span>
                  </div>
                  <Separator className="my-3 bg-slate-800" />
                  <RailRow label="פוזיציה פתוחה" value={typeof s?.profit?.positionSteem === 'number' ? `${s.profit.positionSteem.toFixed(1)} STEEM` : '—'} ltr />
                  <RailRow label="יסוד-עלות ממוצע" value={s?.profit?.positionAvgCost ?? '—'} ltr className="mt-1" />
                  <RailRow
                    label="בלתי-ממומש @ פאריטי"
                    value={typeof s?.profit?.unrealizedAtParitySbd === 'number' ? `${s.profit.unrealizedAtParitySbd.toFixed(3)} SBD` : '—'}
                    tone={(s?.profit?.unrealizedAtParitySbd ?? 0) >= 0 ? 'emerald' : 'amber'}
                    ltr
                    className="mt-1"
                  />
                  <RailRow label="ספר · נזיל" value={`${f2(s?.rails?.deployedSteem)} / ${s?.live?.balances?.steem ?? '—'}`} ltr className="mt-1" />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    כנות: מכירה בלי יסוד-עלות נמדד ({typeof s?.profit?.unbasedSteem === 'number' ? s.profit.unbasedSteem.toFixed(1) : '—'} STEEM → {typeof s?.profit?.unbasedSbd === 'number' ? s.profit.unbasedSbd.toFixed(1) : '—'} SBD) נרשמת unbased — לא נטענת כרווח.
                  </p>
                </SectionCard>

                {/* מסילות-אמת (T-9) */}
                <SectionCard icon={Route} tone="emerald" title="מסילות-אמת · מדידה-מקומית-ריבונית">
                  <RailRow
                    label="דלק-קיורציה/יום"
                    value={typeof s?.rails?.fuel === 'number' ? `$${s.rails.fuel.toFixed(4)}` : '—'}
                    tone={(s?.rails?.fuel ?? 0) > 0 ? 'emerald' : 'amber'}
                    ltr
                  />
                  <RailRow label="מחבר/יום" value={typeof s?.rails?.author === 'number' ? `$${s.rails.author.toFixed(4)}` : '—'} ltr className="mt-1" />
                  <RailRow label="הון-עובד מוצב" value={`${f2(s?.rails?.deployedSteem)} STEEM`} tone={s?.rails?.bookEmpty ? 'amber' : 'emerald'} ltr className="mt-1" />
                  <RailRow label="SBD בספר" value={f2(s?.rails?.bidSbd)} ltr className="mt-1" />
                  <div className="mt-2">
                    <RailRow
                      label="מסילת-ההמרה D-023 (פנ-$1 → ‎3.5 ימים → STEEM)"
                      value={
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={s?.rails?.convert?.verdict === 'CONVERT-PLAN' ? 'emerald' : 'slate'}>{s?.rails?.convert?.verdict ?? '—'}</StatusBadge>
                          {s?.rails?.convert?.impliedSbdUsd != null && (
                            <span className="tnum text-[11px] font-normal text-slate-400">proxy-מרומז: ${s.rails.convert.impliedSbdUsd.toFixed(3)} (לא-מזין-חימוש)</span>
                          )}
                        </span>
                      }
                    />
                    {s?.rails?.convert?.marketSourceNote && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{s.rails.convert.marketSourceNote}</p>}
                  </div>
                  <div className="mt-2">
                    <RailRow
                      label="אוטונומיה (מחזור-מנוע)"
                      value={
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={s?.rails?.autonomy?.ok ? 'emerald' : 'slate'}>{s?.rails?.autonomy?.ok ? 'CYCLE-OK' : s?.rails?.autonomy ? 'DEGRADED' : 'טרם-רץ'}</StatusBadge>
                          {s?.rails?.autonomy?.steps && <span className="min-w-0 flex-1 text-[11px] font-normal leading-relaxed text-slate-500">{Object.entries(s.rails.autonomy.steps).map(([k, v]) => `${k}:${v}`).join(' · ')}</span>}
                        </span>
                      }
                    />
                  </div>
                  {(s?.rails?.bookNote || s?.rails?.fuelWindowNote) && (
                    <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
                      {s?.rails?.bookNote && <span className="block">{s.rails.bookNote}</span>}
                      {s?.rails?.fuelWindowNote && <span className="block">{s.rails.fuelWindowNote}</span>}
                    </p>
                  )}
                </SectionCard>

                {/* מה-יש-לנו · פוטנציאל-ריבוני (T-10) */}
                {(() => {
                  const steemLiquid = parseFloat(String(s?.live?.balances?.steem ?? '').replace(/[^0-9.]/g, '')) || 0
                  const sbdLiquid = parseFloat(String(s?.live?.balances?.sbd ?? '').replace(/[^0-9.]/g, '')) || 0
                  const parity = s?.offer?.marks?.paritySbdPerSteem ?? null
                  const steemUsd = s?.observe?.parity?.steemUsd ?? null
                  const capitalUsd = parity ? steemLiquid * parity + sbdLiquid : (steemUsd ? steemLiquid * steemUsd + sbdLiquid : null)
                  const rate = usdPerDay ?? 0
                  const needed = capitalUsd && rate > 0 ? capitalUsd * (1000 / rate) : null
                  return (
                    <SectionCard icon={TrendingUp} tone="emerald" title={<>מה-יש-לנו · פוטנציאל-ריבוני <span dir="ltr" className="text-slate-500">(T-10)</span></>}>
                      <div className="grid grid-cols-2 gap-2">
                        <Stat label="הון-נזיל (STEEM)" value={steemLiquid > 0 ? steemLiquid.toFixed(1) : '—'} ltr />
                        <Stat label="SBD נזיל" value={sbdLiquid > 0 ? sbdLiquid.toFixed(2) : '—'} ltr />
                        <Stat label="שווי-הון-עובד (מוערך)" value={capitalUsd ? `$${capitalUsd.toFixed(2)}` : '—'} tone="emerald" ltr />
                        <Stat label="קצב-נמדד (כנות)" value={`$${rate.toFixed(4)}/יום`} ltr />
                      </div>
                      <Separator className="my-3 bg-slate-800" />
                      <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-300">
                        <li className="flex items-start gap-1.5"><CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden /><span><b className="text-slate-100">ספר-פאריטי</b> — תשתית מוכנה מלאה: תכנון OFFER-READY בכל-מחזור + ביצוע-מוסיף (D-021/D-022) + רצפת-ערך (r134-VF1). הפוטנציאל: קציר-מרווחים מעל-פאריטי על {s?.rails?.bookEmpty ? 'הנזיל-המלא (הספר כרגע באמת ריק — התוכנית מוכנה בכל-מחזור)' : <span dir="ltr">~{f2(s?.rails?.deployedSteem)} STEEM בספר</span>}.</span></li>
                        <li className="flex items-start gap-1.5"><CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden /><span><b className="text-slate-100">קיורציה</b> — נמדדה $4.26/יום כשהייתה פעילה; כרגע רדומה, ממתינה ל-authority פוסטינג (שער X-1). הכלי קיים ומתוכנת (A-12).</span></li>
                        <li className="flex items-start gap-1.5"><CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden /><span><b className="text-slate-100">מסילת-המרה D-023</b> — יתרון פנימי שנמדד +40.8% (SBD→STEEM פנ-$1); מתחממת אוטומטית כשהאסקים קוצרים SBD.</span></li>
                        <li className="flex items-start gap-1.5"><CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden /><span><b className="text-slate-100">ריבונות-רציפה (היום)</b> — watchdog + מחזורים-אוטומטיים + ביקורת-איכות + ריפוי-עצמי; זמן-רציפות חי בכרטיס הראשון.</span></li>
                      </ul>
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        כנות: פוטנציאל ≠ רווח-נמדד. בקצב-הנמדד הנוכחי ${rate.toFixed(4)}/יום, ל-$1000/יום נדרש הון של {needed ? `≈ $${needed.toFixed(0)}` : '—'} (אנלוגיית X-2) או מסילות-תשואה-גבוהות-יותר. כל-מספר כאן חי וממקור-chain או מדידה-מקומית.
                      </p>
                    </SectionCard>
                  )
                })()}

                {/* T-21d · כלכלה · כל-המסילות — אופציונלי, נטען רק כשהמנוע מדווח */}
                <EconomicsRailsCard economics={s.economics} />

                {/* T-22f · מיכל-ה-RC — העקומה המדודה; אופציונלי, נטען רק כשהמנוע מדווח */}
                <RcTankCard rcTank={s.rcTank} />

                {/* T-23f · שעון-הפאייאוט + ספקטרום-ההון X-2; אופציונליים, נטענים רק כשהמנוע מדווח */}
                <PayoutsCard payouts={s.payouts} />
                <X2Card x2={s.economics?.x2} />
              </>
            ))}

            {renderSection('system', (
              <>
                {/* קיורציה · מסילת-דלק (T-13) */}
                <SectionCard
                  icon={BatteryCharging}
                  tone="emerald"
                  title={<>קיורציה · מסילת-דלק <span dir="ltr" className="text-slate-500">(T-13)</span></>}
                  actions={
                    <StatusBadge tone={s?.curator?.verdict === 'VOTED' ? 'emerald' : s?.curator?.verdict === 'DAY-CAP' ? 'amber' : 'slate'}>
                      {s?.curator?.verdict === 'VOTED' ? 'חי · מצביע'
                        : s?.curator?.verdict === 'DAY-CAP' ? 'מכסה-יומית מלאה'
                        : s?.curator?.verdict ? s.curator.verdict : 'מתחמם'}
                    </StatusBadge>
                  }
                >
                  {s?.curator?.vpEff != null && (
                    <p className="text-[11px] text-slate-500">VP אפקטיבי <b className="tnum text-slate-300">{s.curator.vpEff}%</b> · רצפה 60%</p>
                  )}
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Stat label="הצבעות-היום" value={`${s?.curator?.votesToday ?? 0}/${s?.curator?.maxPerDay ?? 10}`} tone="emerald" />
                    <Stat label="סה״כ" value={s?.curator?.totalVotes ?? 0} />
                    <Stat
                      label="מועמדים-נסרקו"
                      value={s?.curator?.candidatesScanned ?? 0}
                      hint={s?.curator?.candidatesScanned == null && s?.curator?.verdict && s.curator.verdict !== 'VOTED' ? `שער: ${s.curator.verdict} — הסריקה לא רצה במחזור-זה (חוקי)` : undefined}
                    />
                  </div>
                  {!!s?.curator?.lastVotes?.length && (
                    <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                      {s.curator.lastVotes.map((v, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-bold text-slate-200">{v.author}<span className="font-normal text-slate-500"> · {v.permlink?.slice(0, 24)}</span></span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-500">w{(v.weight ?? 0) / 100}% · {v.txid?.slice(0, 8)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    ה-VP המלא (98%+) ישב בטל — עכשיו ~4,034 SP עובדים (נמדד 05.10): הצבעות-בוקר טריות עם-ירידת-משקל-לפי-גיל, מכסה-יומית, רצפת-VP, אפס-הצבעה-עצמית, סינון-ספאם. מפתח-פרסום בלבד — פעולת-הצבעה לא-יכולה להזיז כספים. התשואה נמדדת מ-curation_reward חי (מסילת-הדלק).
                  </p>
                </SectionCard>

                {/* למידה-מתמשכת · גדילה (T-14) */}
                <SectionCard
                  icon={BrainCircuit}
                  tone="slate"
                  title={<>למידה-מתמשכת · גדילה <span dir="ltr" className="text-slate-500">(T-14)</span></>}
                  actions={
                    <StatusBadge tone={s?.learning?.verdict === 'LEARNED' ? 'emerald' : 'slate'}>
                      {s?.learning?.verdict === 'LEARNED' ? 'למד · התעדכן'
                        : s?.learning?.verdict === 'NO-NEW-LESSONS' ? 'אין-שיעורים-חדשים (תקין)'
                        : s?.learning?.verdict ? s.learning.verdict : 'הלולאה תרוץ במחזור-הבא'}
                    </StatusBadge>
                  }
                >
                  {/* R210 · הכלל-הנלמד החי (אדפטציה מאומתת מול-השרשרת) */}
                  {!!s?.adaptation && (
                    <div className="mb-3 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={s.adaptation.status === 'VERIFIED' ? 'emerald' : s.adaptation.status === 'SUPERSEDED' ? 'rose' : 'amber'}>
                          {s.adaptation.status === 'VERIFIED' ? 'כלל-נלמד · נתמך-בראיות'
                            : s.adaptation.status === 'SUPERSEDED' ? 'נפסל · המתנה-בטוחה (fail-closed)'
                            : s.adaptation.status ?? '—'}
                        </StatusBadge>
                        <span className="text-[11px] text-slate-400" dir="ltr">{s.adaptation.adaptationId}</span>
                      </div>
                      <div className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
                        <b>הכלל:</b> <code className="rounded bg-slate-900 px-1" dir="ltr">claim_reward_balance → role={String(s.adaptation.rule?.roleTo ?? '—')}</code>
                        {' '}· <b>תיקון-גוף:</b> <code className="rounded bg-slate-900 px-1" dir="ltr">op-id {String(s.adaptation.bodyFix?.opIdFrom ?? '?')}→{String(s.adaptation.bodyFix?.opIdTo ?? '?')}</code> (נשפט-מול-השרשרת)
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        ביטחון <b className="tnum text-slate-300">{s.adaptation.confidence ?? '—'}</b>
                        {' '}· צריכה-בנתיב-החתימה: <b className="tnum text-slate-300">{s.adaptation.consumptionCount ?? 0}</b>
                        {' '}· הישרדות-אתחולים: <b className="tnum text-slate-300">{s.adaptation.bootCount ?? 0}</b>
                        {' '}· ממתין-לטריגר-טבעי (pending=0 → אין-ניסוי, אמת-אפיסטמית)
                      </div>
                      <div className="mt-1 text-[10px] leading-relaxed text-slate-600" dir="rtl">
                        מפריך: {s.adaptation.falsifier ?? '—'}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {s?.learning?.cycleMetrics?.okRate != null && (
                      <span>מחזורים-תקינים <b className="tnum text-slate-300">{s.learning.cycleMetrics.okRate}%</b> מ-{s.learning.cycleMetrics.window ?? 0} אחרונים</span>
                    )}
                    {!!s?.learning?.runsTotal && <span>סבבי-למידה: <b className="tnum text-slate-300">{s.learning.runsTotal}</b></span>}
                  </div>
                  {!!s?.learning?.lessons?.length ? (
                    <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
                      {s.learning.lessons.map((l, i) => (
                        <li key={i} className="text-[11px] leading-relaxed">
                          <div className="flex items-start gap-1.5">
                            <StatusBadge tone={l.resolved ? 'emerald' : l.severity === 'high' ? 'rose' : l.severity === 'medium' ? 'amber' : 'slate'} className="shrink-0">{l.resolved ? 'נפתר · היסטורי' : l.severity ?? '?'}</StatusBadge>
                            <span><b className="text-slate-100">{l.lesson}</b></span>
                          </div>
                          {l.evidence && <div className="text-slate-500 me-6">ראיה: {l.evidence}</div>}
                          {l.action && <div className={l.resolved ? 'text-slate-500 me-6' : 'text-emerald-400/90 me-6'}>פעולה: {l.action}</div>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">לומד מהיסטוריה-מוקלטת בלבד — אפס המצאות: היסטוריה-ריקה = שיעורים-אפס.</p>
                  )}
                  {!!s?.learning?.tuningsApplied?.length && (
                    <div className="mt-2 text-[11px]">
                      <span className="text-slate-500">כיוונים-חסומים-שהוחלו: </span>
                      {s.learning.tuningsApplied.map((t, i) => (
                        <Badge key={i} variant="outline" className="me-1 border-slate-700 font-mono text-[10px] text-slate-300">
                          {t.key}{t.to != null ? ` ${t.from}→${t.to}` : t.added ? ` +${t.added}` : ''}
                        </Badge>
                      ))}
                      <div className="mt-1 text-slate-600">מוגבל-חוק (LEARN_CLAMP 30–60% משקל · גיל 5–12 דק · תגיות ≤8) — החוקים (רצפת-VF1, רצפת-VP, מכסה-יומית) בלתי-נגישים-ללמידה.</div>
                    </div>
                  )}
                  {!!s?.discovery?.opportunities?.length && (
                    <div className="mt-3 border-t border-slate-800 pt-2">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-300" aria-hidden /> אופציות-גדילה-שהתגלו ({s.discovery.verdict === 'OPTIONS-FOUND' ? 'מדורגות' : s.discovery.verdict ?? '—'})
                      </div>
                      <ul className="max-h-36 space-y-1 overflow-y-auto">
                        {s.discovery.opportunities.map((o, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                            <HonestyBadge kind={o.potentialClass ?? 'potential'} className="shrink-0" />
                            <span><b className="text-slate-100">{o.kind}</b> — <span className="text-slate-400">{o.evidence}</span>{o.gate && <span className="text-slate-600"> · שער: {o.gate}</span>}</span>
                          </li>
                        ))}
                      </ul>
                      {!!s.discovery.curationEst?.estimatedSteemPerDay && (
                        <p className="mt-1 text-[10px] text-slate-500">אומדן-מנת-קיורציה ציבורי: ~{s.discovery.curationEst.estimatedSteemPerDay} STEEM/יום (מוערך — רק curation_reward חי נחשב-נמדד)</p>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-slate-500">לולאה-סוגרת-עצמה: קורא-היסטוריה → שיעורים-מבוססי-ראיות → כיוונים-חסומים → המחזור-הבא רץ-חכם-יותר. הגילוי מדרג ביושר: נמדד &gt; מוערך &gt; פוטנציאל, ולעולם לא מבצע — השערים מחליטים.</p>
                </SectionCard>

                {/* אינטליגנציה · מפעילה-את-עצמה (T-12) */}
                <SectionCard
                  icon={Brain}
                  tone="slate"
                  title={<>אינטליגנציה · מחליטה-בעצמה <span dir="ltr" className="text-slate-500">(T-12)</span></>}
                >
                  {s?.intel?.book?.spreadBps != null && (
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span>מרווח-ספר-חי (חיצוני): <b className="tnum text-slate-200">{s.intel.book.spreadBps}bps</b></span>
                      {s.intel.book.bestAsk != null && <span>ask {s.intel.book.bestAsk.toFixed(4)}</span>}
                      {s.intel.book.bestBid != null && <span>bid {s.intel.book.bestBid.toFixed(4)}</span>}
                      {s?.intel?.at && <span className="text-[10px] text-slate-600" dir="ltr">measured {s.intel.at.slice(11, 19)}Z</span>}
                    </div>
                  )}
                  {!s?.intel?.decisions?.length ? (
                    <p className="text-sm text-slate-500">הסריקה-הראשונה תרוץ במחזור-הבא (כל 10 דק)</p>
                  ) : (
                    <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                      {s.intel.decisions.map((d, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                          <StatusBadge tone="slate" className="shrink-0">{d.kind}</StatusBadge>
                          <span><b className="text-slate-100">{d.decision}</b> — <span className="text-slate-400">{d.reason}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-[11px] text-slate-500">כל-החלטה עם-נימוק — המפעיל רואה הכל, המערכת מריצה הכל בעצמה.</p>
                </SectionCard>

                {/* ביצוע-חי · מפתח-ראשי (T-12) */}
                <SectionCard
                  icon={KeyRound}
                  tone="slate"
                  title={<>ביצוע-חי · מפתח-ראשי <span dir="ltr" className="text-slate-500">(T-12)</span></>}
                  actions={
                    <StatusBadge
                      tone={s?.execution?.verdict === 'VERIFIED' ? 'emerald' : s?.execution?.verdict === 'CREDENTIAL-MISMATCH' ? 'amber' : 'rose'}
                      solid
                    >
                      {s?.execution?.verdict ?? (s?.execution?.credentialPresent ? 'בודק' : 'אין-תעודה')}
                    </StatusBadge>
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {s?.execution?.fingerprint && <span className="text-[11px] text-slate-500">טביעת-אצבע: {s.execution.fingerprint}</span>}
                    {s?.execution?.armed != null && (
                      <span className={`text-[11px] ${s.execution.armed ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {s.execution.armed ? 'חמוש · דוקטרינה-מוגבל' : 'מושהה/מנוטרל'}
                      </span>
                    )}
                  </div>
                  {s?.execution?.verdict === 'CREDENTIAL-MISMATCH' && (
                    <p className="mt-2 text-[11px] leading-relaxed text-amber-400/90">
                      כנות: התעודה שהועלתה תקינה-מבנית אך המפתחות-הנגזרים-ממנה אינם תואמים את רשויות-השרשרת של {s.execution?.account ?? 'החשבון'} (נבדק מול הרשאות חיות). שני-מסלולים: (א) העלה את סיסמת-האם-הנוכחית כ-upload/headcorner.txt — המנוע מאבטח ומאמץ אוטומטית; (ב) ב-steemit.com → Permissions החלף את המפתחות ל-proposedPubkeys — לאחר-צעד-אחד זה המערכת ריבונית-מלאה לתמיד.
                    </p>
                  )}
                  {s?.execution?.proposedPubkeys && (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
                      {Object.entries(s.execution.proposedPubkeys).map(([k, v]) => <div key={k}><span className="text-slate-300">{k}</span>: {v}</div>)}
                    </div>
                  )}
                  {s?.execution?.roles && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(s.execution.roles).map(([k, v]) => (
                        <StatusBadge key={k} tone={v.matched ? 'emerald' : 'slate'}>{k}:{v.matched ? 'תואם' : 'לא-תואם'}</StatusBadge>
                      ))}
                    </div>
                  )}
                  {!!s?.execution?.log?.length && (
                    <div className="mt-2 max-h-32 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800">
                      {[...s.execution.log].reverse().map((l, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-x-2 px-2 py-1.5 text-[10px]">
                          <span className="tnum text-slate-500">{l.at?.replace('T', ' ')?.slice(0, 19)}</span>
                          <StatusBadge tone={l.ok ? 'emerald' : 'rose'}>{l.tag ?? l.ops?.join('+') ?? '?'}</StatusBadge>
                          {l.txid && <span className="font-mono text-slate-400">tx {l.txid.slice(0, 12)}…</span>}
                          {l.error && <span className="text-rose-400">{l.error.slice(0, 60)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {/* רשת-טריגרים */}
                <SectionCard icon={GitBranch} tone="slate" title="רשת-הטריגרים · דבר-גורר-דבר">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="טיקים" value={s?.grid?.runCount ?? '—'} />
                    <Stat label="מילויי-סימולציה" value={s?.grid?.simFills ?? '—'} />
                    <Stat label="עמלות-סימולציה (µ)" value={f2(s?.grid?.simFeesMu)} ltr />
                    <Stat label="גרידים-פעילים" value={`${s?.grid?.grids?.filter((g) => g.active).length ?? 0}/${s?.grid?.grids?.length ?? 0}`} tone="emerald" />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">טיק מזריק אירועים ל-bus → peg ומוביל ניזונים ממנו — השרשרת הפנימית חיה.</p>
                </SectionCard>

                {/* יומן-אירועים מקומי */}
                <SectionCard
                  icon={Anchor}
                  tone="slate"
                  className="md:col-span-2 lg:col-span-3"
                  title="יומן-אירועים · מנוע-ריבוני (state/events.jsonl)"
                >
                  {!s?.events?.length ? (
                    <p className="text-sm text-slate-500">אין-אירועים עדיין — השכבה-הריבונית מריצה מחזורים אוטומטית כל 10 דק (T-10)</p>
                  ) : (
                    <div className="max-h-64 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800">
                      {[...s.events].reverse().map((e, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs transition-colors hover:bg-slate-800/40">
                          <span className="tnum text-slate-500">{e.at?.replace('T', ' ')?.slice(0, 19)}</span>
                          <StatusBadge tone="slate">{e.type ?? '?'}</StatusBadge>
                          {Object.entries(e)
                            .filter(([k, v]) => !['type', 'at'].includes(k) && v !== null && v !== undefined && typeof v !== 'object')
                            .slice(0, 4)
                            .map(([k, v]) => <span key={k} className="text-slate-400">{k}: {String(v)}</span>)}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </>
            ))}
          </div>
        )}
      </main>

      {/* FOOTER — sticky (mt-auto) · counters + truth line */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500 sm:flex-row">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span className="tnum">מחזורים {sov?.state?.cycles?.ok ?? 0} תקינים · {sov?.state?.cycles?.blocked ?? 0} חסומים · {sov?.state?.cycles?.fail ?? 0} כשלים</span>
            <span className="tnum">דופק {sov?.state?.watchdog?.checks ?? 0} · ריפויים {sov?.state?.watchdog?.heals ?? 0}</span>
            {!!sov?.state?.custodian && <span className="tnum">זיכרות {sov.state.custodian.up ? 'שלמה' : 'פגועה'} · דופק-משמורת {sov.state.custodian.checks ?? 0} · ריפויים {sov.state.custodian.heals ?? 0}</span>}
            {!!sov?.state?.selftest?.total && <span className="tnum">selftest {sov.state.selftest.passed}/{sov.state.selftest.total}</span>}
          </div>
          <p className="text-center sm:text-end">
            אמת-מוטבעת-על-שרשרת בלבד · מפתח-מוחזק-מנוע · מוגבל-דוקטרינה · לעולם לא נרשם · ראיות: mini-services/saos-engine/state · T-21 · {s?.asof?.slice(11, 19) ?? ''} UTC
          </p>
        </div>
      </footer>
    </div>
  )

}
