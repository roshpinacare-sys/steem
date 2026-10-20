'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// —— סוגים מוקטנים (מה-API) ——
type Organ = {
  name: string
  status: string | null
  conclusion: string | null
  at: string | null
  url: string | null
  ageSec: number | null
  freshSec: number
  verdict: string
  fails24h: number
}
type SovereignData = {
  at: string
  chain: {
    ok: boolean
    error?: string
    height: number | null
    savedAt: string | null
    creditsSum: number
    creditsHolders: Array<{ holder: string; mu: number }>
    feeMeter: number | null
    treasuryProfitEver: number | null
    gasUsed: number | null
    pools: Array<{ pair: string; detail: string; valueHint: string }>
    lpTreasury: Array<{ pair: string; balance: number }>
  }
  army: {
    ok: boolean
    error?: string
    data: null | {
      roster: number
      acted: number
      stasis: number
      halted: number
      estateOpenOrders: number
      estateLockedSteem: number
      estateCapSteem: number
      verdict: string
      mid?: number
      at: string
    }
    receipts?: { ok: boolean; data?: Array<Record<string, unknown>> }
  }
  volume: {
    ok: boolean
    error?: string
    data: null | {
      verdict: string
      at: string
      txChecks: { total: number; verified: number; exposed: number; unreachable: number }
      chainFills: { count: number; makerFills: number; takerFills: number; volumeSteem: number; volumeSbd: number; byAccount: Record<string, number> }
    }
  }
  grid: { ok: boolean; error?: string; data: null | Record<string, unknown> }
  klines: { ok: boolean; error?: string; pairs?: Record<string, Array<{ t: number; o: number; h: number; l: number; c: number; vMu: number; qMu: number; n: number }>> }
  makers: { ok: boolean; error?: string; top?: Array<{ name: string; fills: number; volMu: number; lastH: number }> }
  policies: { ok: boolean; data?: null | { at?: string; authority?: string; gears?: unknown[] } }
  organs: Organ[]
  hub: { ok: boolean; error?: string; data?: unknown }
  digest: { ok: boolean; error?: string; data?: unknown }
  feed?: { ok: boolean; error?: string; data?: Array<{ repo: string; sha: string; msg: string; at: string | null; url: string }> }
  recovery?: { ok: boolean; error?: string; data?: Array<{ path: string; exists: boolean; sha: string | null; lastAt: string | null; msg: string | null; url: string | null }> }
  secrets?: { ok: boolean; error?: string; data?: { clean: boolean; suspects: string[]; scanned: string[] } }
  signing?: { ok: boolean; error?: string; data?: { conclusion: 'success' | 'failure' | 'unknown'; startedAt: string | null; url: string | null } }
  engine?: { ok: boolean; error?: string; data?: { conclusion: 'success' | 'failure' | 'running' | 'unknown'; event: string | null; at: string | null; url: string | null } }
  decisions?: {
    ok: boolean
    error?: string
    data?: null | {
      generatedAt: string
      policyVersion: string
      authority: string
      authorityOf?: string
      principle?: string
      sense: Record<string, { ok: boolean; ageMin: number }>
      decisions: Array<{ id: string; area?: string; title?: string; status?: string; decidedAt?: string; reasoning?: string }>
      stats?: { standing?: number; thisRun?: number; total?: number }
      authorityEnvelope?: { execute?: string[]; gates?: string[] }
    }
  }
  fabric?: { ok: boolean; error?: string; data?: null | { proposals: number; reviewed: number; reviewPaths: string[] } }
  irreversibles?: { ok: boolean; error?: string; data?: null | { found: boolean; quote: string | null; source: string } }
}

const fmtMu = (mu: number | null | undefined): string =>
  mu === null || mu === undefined
    ? '—'
    : new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(mu) + 'µ'

const fmtN = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('he-IL', { maximumFractionDigits: 3 }).format(n)

function ageHe(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—'
  if (sec < 60) return `${sec} שנ׳`
  if (sec < 3600) return `${Math.round(sec / 60)} דק׳`
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} שע׳`
  return `${(sec / 86400).toFixed(1)} ימ׳`
}

function verdictTone(v: string): { dot: string; text: string; label: string } {
  switch (v) {
    case 'fresh':
      return { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'חי' }
    case 'aging':
      return { dot: 'bg-amber-400', text: 'text-amber-400', label: 'מזדקן' }
    case 'stale':
      return { dot: 'bg-rose-500', text: 'text-rose-400', label: 'איטי' }
    default:
      return { dot: 'bg-zinc-500', text: 'text-zinc-400', label: 'לא-נצפה' }
  }
}

function decisionTone(status?: string): { dot: string; text: string; label: string } {
  switch ((status ?? '').split(' ')[0]) {
    case 'executed':
      return { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'בוצע' }
    case 'attested':
      return { dot: 'bg-teal-400', text: 'text-teal-300', label: 'מאומת' }
    case 'armed-conditional':
      return { dot: 'bg-amber-400', text: 'text-amber-300', label: 'חמוש-מותנה' }
    case 'watch':
      return { dot: 'bg-amber-400/70', text: 'text-amber-200/90', label: 'במעקב' }
    case 'clear':
      return { dot: 'bg-zinc-400', text: 'text-zinc-300', label: 'תקין' }
    default:
      return { dot: 'bg-zinc-600', text: 'text-zinc-400', label: status ?? '—' }
  }
}

function repoBadge(repo: string): string {
  switch (repo) {
    case 'saos-dex':
      return 'bg-emerald-900/40 text-emerald-300'
    case 'saos-runtime':
      return 'bg-amber-900/40 text-amber-300'
    case 'saos-owner-channel':
      return 'bg-teal-900/40 text-teal-300'
    case 'steem':
      return 'bg-rose-900/40 text-rose-300'
    case 'FleetHQ':
      return 'bg-lime-900/40 text-lime-300'
    default:
      return 'bg-zinc-800 text-zinc-300'
  }
}

function Panel({ title, children, tone = '', sub, className = '' }: { title: string; children: React.ReactNode; tone?: string; sub?: string; className?: string }) {
  return (
    <section className={`rounded-xl border border-emerald-900/40 bg-[#0c1713]/90 p-4 shadow-lg shadow-black/30 ${tone} ${className}`}>
      <header className="mb-3 flex items-baseline justify-between gap-2 border-b border-emerald-900/30 pb-2">
        <h2 className="text-sm font-bold tracking-wide text-emerald-200">{title}</h2>
        {sub ? <span className="font-mono text-[10px] text-emerald-600">{sub}</span> : null}
      </header>
      {children}
    </section>
  )
}

function Spark({ closes, w = 560, h = 72 }: { closes: number[]; w?: number; h?: number }) {
  if (!closes || closes.length < 2) return <div className="h-[72px] text-xs text-zinc-500">אין נתוני קו-מחיר</div>
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || 1
  const pts = closes.map((c, i) => `${(i / (closes.length - 1)) * w},${h - 6 - ((c - min) / span) * (h - 12)}`).join(' ')
  const up = closes[closes.length - 1] >= closes[0]
  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" role="img" aria-label="קו מחיר SAOS/USDS">
        <polyline points={pts} fill="none" stroke={up ? '#34d399' : '#fb7185'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={4} y={12} fontSize="10" fill="#6b7280" fontFamily="monospace">
          {min.toFixed(3)} → {max.toFixed(3)}
        </text>
      </svg>
    </div>
  )
}

export default function Home() {
  const [data, setData] = useState<SovereignData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/sovereign', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as SovereignData
      if (alive.current) {
        setData(j)
        setErr(null)
      }
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    load()
    const iv = setInterval(() => {
      setTick((t) => t + 1)
      load()
    }, 60_000)
    return () => {
      alive.current = false
      clearInterval(iv)
    }
  }, [load])

  const kline = useMemo(() => data?.klines?.pairs?.['SAOS/USDS'] ?? [], [data])
  const closes = useMemo(() => kline.map((k) => k.c), [kline])
  const organsFresh = data?.organs.filter((o) => o.verdict === 'fresh').length ?? 0
  const organsTotal = data?.organs.length ?? 0
  const pulseOk = organsFresh >= Math.ceil(organsTotal * 0.6)

  const manualRefresh = useCallback(async () => {
    setRefreshing(true)
    setTick((t) => t + 1)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-[#07100d] text-emerald-50">
      {/* כותרת */}
      <header className="sticky top-0 z-20 border-b border-emerald-900/40 bg-[#07100d]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`relative flex h-3 w-3`}>
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pulseOk ? 'bg-emerald-400' : 'bg-amber-400'} opacity-60`}></span>
              <span className={`relative inline-flex h-3 w-3 rounded-full ${pulseOk ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            </span>
            <h1 className="text-lg font-black tracking-tight text-emerald-100">מרכז-הפיקוד הריבוני</h1>
            <span className="hidden font-mono text-[11px] text-emerald-600 sm:inline">SAOS · git-home · cloud-first</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px] text-emerald-500">
            <span dir="ltr">
              height <b className="text-emerald-300">{fmtN(data?.chain.height)}</b>
            </span>
            <span>ריענון 60ש׳ #{tick + 1}</span>
            <button
              onClick={manualRefresh}
              disabled={refreshing}
              className="rounded border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-1.5 text-[10px] text-emerald-300 transition hover:border-emerald-600 hover:bg-emerald-900/40 disabled:cursor-wait disabled:opacity-50"
              aria-label="רענון ידני של הנתונים"
            >
              {refreshing ? 'מרענן…' : 'רענן עכשיו'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {loading && !data ? (
          <div className="grid min-h-[50vh] place-items-center">
            <div className="animate-pulse text-sm text-emerald-500">מתחבר לריבונות החיה…</div>
          </div>
        ) : err && !data ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 p-6 text-center text-sm text-rose-300">
            שגיאת-חיבור ל-API: <span className="font-mono">{err}</span> — הריבונות עצמה בענן ממשיכה לפעול.
          </div>
        ) : data ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* סטטוס-ריבונות */}
            <Panel title="סטטוס-ריבונות" sub={data.at.slice(11, 19) + 'Z'} className="md:col-span-2 xl:col-span-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {data.organs.map((o) => {
                  const t = verdictTone(o.verdict)
                  return (
                    <a
                      key={o.name}
                      href={o.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="group rounded-lg border border-emerald-900/30 bg-black/30 p-2.5 transition hover:border-emerald-700/60"
                      title={`${o.name} · ${o.conclusion ?? o.status ?? '—'} · ${ageHe(o.ageSec)}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`}></span>
                        <span className="truncate font-mono text-[11px] text-emerald-300">{o.name}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className={`text-[10px] ${t.text}`}>{t.label}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{ageHe(o.ageSec)}</span>
                      </div>
                      {o.fails24h > 0 ? (
                        <div className="mt-0.5 font-mono text-[9px] text-rose-400/80">×{o.fails24h} כשלים/24h</div>
                      ) : null}
                    </a>
                  )
                })}
              </div>
            </Panel>

            {/* כלכלה */}
            <Panel title="כלכלה חיה" sub="Σ credits · feeMeter">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-black/30 p-3">
                    <div className="text-[10px] text-zinc-400">Σ קרדיטים (מחזור-פנימי)</div>
                    <div className="mt-1 font-mono text-lg font-bold text-emerald-300" dir="ltr">
                      {fmtMu(data.chain.creditsSum)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-black/30 p-3">
                    <div className="text-[10px] text-zinc-400">feeMeter (עמלות שנאספו)</div>
                    <div className="mt-1 font-mono text-lg font-bold text-amber-300" dir="ltr">
                      {fmtMu(data.chain.feeMeter)}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] text-zinc-400">מחזיקים מובילים</div>
                  <div className="max-h-36 space-y-1 overflow-y-auto pr-1 font-mono text-[11px]" style={{ scrollbarWidth: 'thin' }}>
                    {data.chain.creditsHolders.map((h) => (
                      <div key={h.holder} className="flex items-center justify-between rounded bg-black/20 px-2 py-1">
                        <span className="text-emerald-400">{h.holder}</span>
                        <span dir="ltr" className="text-zinc-300">
                          {fmtMu(h.mu)}
                        </span>
                      </div>
                    ))}
                    {data.chain.creditsHolders.length === 0 ? <div className="text-zinc-500">—</div> : null}
                  </div>
                </div>
                <div className="flex justify-between border-t border-emerald-900/30 pt-2 font-mono text-[10px] text-zinc-500" dir="ltr">
                  <span>profitEver {fmtMu(data.chain.treasuryProfitEver)}</span>
                  <span>gasUsed {fmtMu(data.chain.gasUsed)}</span>
                </div>
              </div>
            </Panel>

            {/* צבא */}
            <Panel title="צבא-ה-12 · ספר-החשבונות" sub={data.army.data?.verdict ?? '—'}>
              {data.army.ok && data.army.data ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-black/30 p-2">
                      <div className="font-mono text-xl font-bold text-emerald-300">{data.army.data.acted}</div>
                      <div className="text-[10px] text-zinc-400">פעלו / {data.army.data.roster}</div>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <div className="font-mono text-xl font-bold text-amber-300">{data.army.data.stasis}</div>
                      <div className="text-[10px] text-zinc-400">עצירה</div>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <div className="font-mono text-xl font-bold text-emerald-200" dir="ltr">
                        {fmtN(data.army.data.mid)}
                      </div>
                      <div className="text-[10px] text-zinc-400">מחיר-אמצע (order-book)</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[10px] text-zinc-400" dir="ltr">
                    <span>openOrders {data.army.data.estateOpenOrders}</span>
                    <span>locked {fmtN(data.army.data.estateLockedSteem)} STEEM</span>
                    <span>cap {fmtN(data.army.data.estateCapSteem)}</span>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] text-zinc-400">קבלות אחרונות</div>
                    <div className="max-h-32 space-y-1 overflow-y-auto font-mono text-[10px] text-zinc-400" dir="ltr" style={{ scrollbarWidth: 'thin' }}>
                      {(data.army.receipts?.data ?? []).map((r, i) => (
                        <div key={i} className="truncate rounded bg-black/20 px-2 py-0.5">
                          {JSON.stringify(r).slice(0, 110)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-rose-400">מנותק: {data.army.error}</div>
              )}
            </Panel>

            {/* ווליום */}
            <Panel title="ווליום-מאומת" sub={data.volume.data?.verdict ?? '—'}>
              {data.volume.ok && data.volume.data ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-lg bg-black/30 p-2">
                      <div className="font-mono text-lg font-bold text-emerald-300">{data.volume.data.txChecks.verified}</div>
                      <div className="text-[9px] text-zinc-400">אומתו</div>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <div className="font-mono text-lg font-bold text-emerald-200">{data.volume.data.chainFills.count}</div>
                      <div className="text-[9px] text-zinc-400">fills בשרשרת</div>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <div className={`font-mono text-lg font-bold ${data.volume.data.txChecks.exposed ? 'text-rose-400' : 'text-zinc-400'}`}>
                        {data.volume.data.txChecks.exposed}
                      </div>
                      <div className="text-[9px] text-zinc-400">חשיפות</div>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <div className="font-mono text-lg font-bold text-zinc-400">{data.volume.data.txChecks.unreachable}</div>
                      <div className="text-[9px] text-zinc-400">לא-נגישות</div>
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-300" dir="ltr">
                    vol {fmtN(data.volume.data.chainFills.volumeSteem)} STEEM · {fmtN(data.volume.data.chainFills.volumeSbd)} SBD
                  </div>
                  <div className="flex flex-wrap gap-1" dir="ltr">
                    {Object.entries(data.volume.data.chainFills.byAccount).map(([a, n]) => (
                      <span key={a} className="rounded bg-emerald-900/30 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                        {a} ×{n}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-rose-400">מנותק: {data.volume.error}</div>
              )}
            </Panel>

            {/* DEX נזילות */}
            <Panel title="DEX · נזילות ומחיר" sub={`${data.chain.pools.length} pools`} className="md:col-span-2">
              <div className="space-y-3">
                <Spark closes={closes} />
                <div className="text-[10px] text-zinc-500">SAOS/USDS · 72 נרות אחרונים (סגירה)</div>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-emerald-900/30" style={{ scrollbarWidth: 'thin' }}>
                  <table className="w-full font-mono text-[11px]">
                    <thead className="sticky top-0 bg-black/60 text-zinc-500">
                      <tr>
                        <th className="p-2 text-right font-normal">pool</th>
                        <th className="p-2 text-right font-normal">שריונות</th>
                        <th className="p-2 text-right font-normal">פרמטרים</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.chain.pools.map((p) => (
                        <tr key={p.pair} className="border-t border-emerald-900/20 hover:bg-emerald-950/20">
                          <td className="p-2 text-emerald-300" dir="ltr">
                            {p.pair}
                          </td>
                          <td className="p-2 text-zinc-300" dir="ltr">
                            {p.detail}
                          </td>
                          <td className="p-2 text-zinc-500" dir="ltr">
                            {p.valueHint}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.makers.ok ? (
                  <div>
                    <div className="mb-1 text-[10px] text-zinc-400">מייקרים מובילים (ווליום)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.makers.top?.map((m) => (
                        <span key={m.name} className="rounded bg-black/30 px-2 py-1 font-mono text-[10px]" dir="ltr">
                          <span className="text-emerald-300">{m.name}</span> <span className="text-zinc-400">{fmtMu(m.volMu)}</span>
                          <span className="text-zinc-600"> · {m.fills} fills</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </Panel>

            {/* דאונפאוור + אישורי-בעלים */}
            <Panel title="מטבע-הכוח · downpower 1000 SP" sub="owner-approved">
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-amber-200">1000 SP → נזיל (אושר ובוצע, chain-verified)</span>
                    <span className="font-mono text-[10px] text-amber-500">250/wk × 4</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-black/40">
                    <div className="h-full w-[25%] bg-amber-500/70 transition-all"></div>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-zinc-500">תשלום ראשון: 2026-10-25 · to_withdraw=1,611,699 VESTS</div>
                </div>
                <div className="text-[11px] leading-relaxed text-zinc-400">
                  הגריד ב-Steemit פועל: הצבא על ספר-החשבונות עם caps מוגבהים, ladders שעתיים, arb-grid לנזילות ה-DEX — הכל מתוזמן בענן וממשיך לבד גם בשינה.
                </div>
                {data.policies.ok && data.policies.data ? (
                  <div className="rounded-lg bg-black/30 p-2 font-mono text-[10px] text-zinc-500" dir="ltr">
                    <div className="truncate text-emerald-500">gears authority: {(data.policies.data as { authority?: string }).authority?.slice(0, 90) ?? '—'}</div>
                    <div>gears: {Array.isArray((data.policies.data as { gears?: unknown[] }).gears) ? (data.policies.data as { gears?: unknown[] }).gears!.length : 0}</div>
                  </div>
                ) : null}
              </div>
            </Panel>

            {/* hub + משרד */}
            <Panel title="ה-hub · חוזים ומשרד" sub="leases · office digest">
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between rounded bg-black/30 px-2 py-1.5">
                  <span className="text-zinc-400">CLAIMS.json (הרשאות-סוכנים)</span>
                  <span className={`font-mono ${data.hub.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{data.hub.ok ? 'זמין' : 'מנותק'}</span>
                </div>
                <div className="flex items-center justify-between rounded bg-black/30 px-2 py-1.5">
                  <span className="text-zinc-400">FleetHQ office digest</span>
                  <span className={`font-mono ${data.digest.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{data.digest.ok ? 'זמין' : 'מנותק'}</span>
                </div>
                {data.hub.ok && data.hub.data ? (
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[9px] leading-relaxed text-zinc-500" dir="ltr" style={{ scrollbarWidth: 'thin' }}>
                    {JSON.stringify(data.hub.data, null, 1).slice(0, 1800)}
                  </pre>
                ) : (
                  <div className="font-mono text-[10px] text-rose-400/80">{data.hub.error}</div>
                )}
              </div>
            </Panel>

            {/* המוח-הריבוני — מחזור-ההחלטות SOV-POLICY/1 (W6) */}
            <Panel title="המוח · מחזור-ההחלטות הריבוני" sub="FleetHQ · SOV-POLICY/1" className="md:col-span-2">
              {data.decisions?.ok && data.decisions.data ? (
                <div className="space-y-2 text-[11px]">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(data.decisions.data.sense).map(([k, v]) => (
                      <span
                        key={k}
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${v.ok ? 'bg-emerald-950/60 text-emerald-300' : 'bg-rose-950/60 text-rose-300'}`}
                        dir="ltr"
                      >
                        {k} {v.ok ? '✓' : '✗'} {v.ageMin}m
                      </span>
                    ))}
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    {data.decisions.data.decisions.map((d) => {
                      const t = decisionTone(d.status)
                      return (
                        <div key={d.id} className="flex items-start gap-2 rounded bg-black/20 px-2 py-1" title={d.reasoning ?? undefined}>
                          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
                          <span className="shrink-0 font-mono text-[10px] text-zinc-500" dir="ltr">{d.id}</span>
                          <span className="hidden shrink-0 font-mono text-[9px] text-zinc-600 sm:inline" dir="ltr">{d.area ?? ''}</span>
                          <span className={`truncate ${t.text}`}>{d.title ?? d.id}</span>
                          <span className="ms-auto shrink-0 text-[9px] text-zinc-600">{t.label}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-black/30 px-2 py-1.5 font-mono text-[9px] text-zinc-500" dir="ltr">
                    <span>{data.decisions.data.authority} · {data.decisions.data.authorityOf ?? ''}</span>
                    <span>
                      exec {data.decisions.data.authorityEnvelope?.execute?.length ?? 0} · gates{' '}
                      {data.decisions.data.authorityEnvelope?.gates?.length ?? 0} · Σ{data.decisions.data.stats?.total ?? '?'} (run{' '}
                      {data.decisions.data.stats?.thisRun ?? '?'})
                    </span>
                  </div>
                  <div className="text-[10px] leading-relaxed text-zinc-500">
                    עדכון אחרון לפני{' '}
                    {ageHe(Math.max(0, Math.round((Date.now() - new Date(data.decisions.data.generatedAt).getTime()) / 1000)))} · הריבונות
                    מחליטה ומבצעת — כל-החלטה עם ראיה מדודה, עגונה ב-git, ומוצגת כאן ללא צנזורה.
                  </div>
                </div>
              ) : (
                <div className="text-xs text-rose-400">המוח מנותק: {data.decisions?.error ?? 'אין נתונים'}</div>
              )}
            </Panel>

            {/* תור-הבעלים — מה-מחכה-להחלטתך (W7) */}
            <Panel title="תור-הבעלים · ממתין-להחלטתך" sub="אפס-ביצוע-בלעדיך · הצגה-בלבד">
              <div className="space-y-2 text-[11px]">
                {data.fabric?.ok && data.fabric.data ? (
                  <a
                    href="https://github.com/roshpinacare-sys/saos-dex/tree/main/fabric"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded bg-black/30 px-2 py-1.5 transition hover:bg-emerald-950/40"
                  >
                    <span className="text-zinc-300">הצעות-למידה אוטונומית (fabric/saos-dex)</span>
                    <span className="font-mono">
                      <span className={data.fabric.data.reviewed < data.fabric.data.proposals ? 'text-amber-300' : 'text-emerald-400'}>
                        {data.fabric.data.proposals} בתור · {data.fabric.data.reviewed} נשפטו
                      </span>
                    </span>
                  </a>
                ) : (
                  <div className="rounded bg-black/30 px-2 py-1.5 text-rose-400/80">fabric: {data.fabric?.error ?? 'אין נתונים'}</div>
                )}
                {data.irreversibles?.ok && data.irreversibles.data?.quote ? (
                  <a
                    href={data.irreversibles.data.source}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded bg-black/30 px-2 py-1.5 transition hover:bg-emerald-950/40"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-300">בלתי-הפיכים — חוק-הבעלים עומד</span>
                      <span className="font-mono text-amber-300">
                        {Math.max(1, (data.irreversibles.data.quote.match(/·/g) ?? []).length + 1)} בתור
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[10px] text-zinc-500" title={data.irreversibles.data.quote}>
                      {data.irreversibles.data.quote.slice(0, 160)}…
                    </div>
                  </a>
                ) : (
                  <div className="rounded bg-black/30 px-2 py-1.5 text-rose-400/80">
                    בלתי-הפיכים: {data.irreversibles?.error ?? (data.irreversibles?.data && !data.irreversibles.data.found ? 'המקטע-לא-נמצא-בתוכנית' : 'אין נתונים')}
                  </div>
                )}
                {(() => {
                  const armed = (data.decisions?.data?.decisions ?? []).filter((d) => (d.status ?? '').startsWith('armed'))
                  if (!armed.length) return null
                  return (
                    <div className="rounded bg-black/30 px-2 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-300">החלטות-המוח החמושות-מותנות</span>
                        <span className="font-mono text-amber-300">{armed.length} חמושות</span>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {armed.map((d) => (
                          <div key={d.id} className="flex items-center gap-2 text-[10px]">
                            <span className="font-mono text-zinc-500" dir="ltr">{d.id}</span>
                            <span className="truncate text-amber-200/90">{d.title ?? d.id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                <div className="text-[10px] leading-relaxed text-zinc-500">
                  כלום-מהתור-לא-בוצע-אוטומטית — השער-שלך. השיפוט-העזר האחרון: fabric cmvdxs6w → REJECTED-AS-WRITTEN · IDEA-ENDORSED (4 חוסמים מדודים, גרסה-מתוקנת-מוצעת ב-review).
                </div>
              </div>
            </Panel>

            {/* איברי-ענן מלאים */}
            <Panel title="איברי-הענן · ריצות אחרונות" sub="GitHub Actions" className="md:col-span-2 xl:col-span-3">
              <div className="max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                <table className="w-full font-mono text-[11px]">
                  <thead className="sticky top-0 bg-black/60 text-zinc-500">
                    <tr>
                      <th className="p-2 text-right font-normal">איבר</th>
                      <th className="p-2 text-right font-normal">מצב</th>
                      <th className="p-2 text-right font-normal">גיל</th>
                      <th className="p-2 text-right font-normal">סף-רעננות</th>
                      <th className="p-2 text-right font-normal">כשלים/24h</th>
                      <th className="p-2 text-right font-normal">קישור</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.organs.map((o) => {
                      const t = verdictTone(o.verdict)
                      return (
                        <tr key={o.name} className="border-t border-emerald-900/20 hover:bg-emerald-950/20">
                          <td className="p-2 text-emerald-300" dir="ltr">{o.name}</td>
                          <td className={`p-2 ${t.text}`}>{o.conclusion ?? o.status ?? '—'}</td>
                          <td className="p-2 text-zinc-400">{ageHe(o.ageSec)}</td>
                          <td className="p-2 text-zinc-600" dir="ltr">{Math.round(o.freshSec / 60)}min</td>
                          <td className={`p-2 ${o.fails24h > 0 ? 'text-rose-400' : 'text-zinc-600'}`}>{o.fails24h}</td>
                          <td className="p-2">
                            {o.url ? (
                              <a href={o.url} target="_blank" rel="noreferrer" className="text-emerald-500 hover:text-emerald-300">
                                run ↗
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* יומן-הריבונות — קיר-הקבלות החי */}
            <Panel title="יומן-הריבונות · קיר-הקבלות החי" sub="4 repos · ה-commit הוא הקבלה" className="md:col-span-2 xl:col-span-3">
              {data.feed?.ok && data.feed.data && data.feed.data.length > 0 ? (
                <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-[11px]" style={{ scrollbarWidth: 'thin' }}>
                  {data.feed.data.map((c, i) => (
                    <a
                      key={`${c.repo}-${c.sha}-${i}`}
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded bg-black/20 px-2 py-1 transition hover:bg-emerald-950/40"
                    >
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${repoBadge(c.repo)}`}>{c.repo}</span>
                      <span className="shrink-0 text-zinc-600" dir="ltr">
                        {c.at ? c.at.slice(5, 16).replace('T', ' ') : '—'}
                      </span>
                      <span className="truncate text-zinc-300" dir="ltr">
                        {c.msg}
                      </span>
                      <span className="ms-auto shrink-0 text-zinc-600" dir="ltr">
                        {c.sha}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-rose-400">יומן מנותק: {data.feed?.error ?? 'אין קבלות'}</div>
              )}
            </Panel>

            {/* מגן-השרידות — ארסנל-התחייה על הענן (W4-G) */}
            <Panel title="מגן-השרידות · ארסנל-התחייה על הענן" sub="כלי הקיומים על main · אפס-סודות" className="md:col-span-2 xl:col-span-3">
              <div className="grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2 xl:grid-cols-4">
                {(data.recovery?.data ?? []).map((a) => (
                  <a
                    key={a.path}
                    href={a.exists && a.url ? a.url : 'https://github.com/roshpinacare-sys/saos-owner-channel'}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded-lg border bg-black/30 p-2.5 transition hover:border-emerald-700/60 ${a.exists ? 'border-emerald-900/40' : 'border-rose-900/60'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${a.exists ? 'bg-emerald-900/50 text-emerald-300' : 'bg-rose-900/50 text-rose-300'}`}>
                        {a.exists ? '✓ על main' : '✗ חסר'}
                      </span>
                      <span className="truncate font-mono text-[10px] text-emerald-300" dir="ltr">{a.path}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[9px] text-zinc-500" dir="ltr">
                      {a.sha ? `${a.sha} · ${a.lastAt ? a.lastAt.slice(5, 16).replace('T', ' ') : '—'}` : a.msg ?? 'לא בהיסטוריה' }
                    </div>
                  </a>
                ))}
                {!data.recovery?.ok ? (
                  <div className="rounded-lg border border-rose-900/60 bg-rose-950/20 p-2.5 text-[10px] text-rose-300 md:col-span-2 xl:col-span-4">
                    מגן-השרידות מנותק: {data.recovery?.error ?? 'אין נתונים'}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {data.engine?.ok && data.engine.data ? (
                  <a
                    href={data.engine.data.url ?? 'https://github.com/roshpinacare-sys/saos-runtime/actions/workflows/steem-hand-revival.yml'}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded px-2 py-1 text-[10px] font-bold transition hover:opacity-80 ${
                      data.engine.data.conclusion === 'success'
                        ? 'bg-emerald-900/50 text-emerald-300'
                        : data.engine.data.conclusion === 'failure'
                          ? 'bg-rose-900/60 text-rose-200'
                          : 'bg-amber-900/40 text-amber-300'
                    }`}
                  >
                    {data.engine.data.conclusion === 'success'
                      ? '✓ יד-המנוע: מחזור דוקטרינה שלם (SENSE→DECIDE→ACT→RECORD)'
                      : data.engine.data.conclusion === 'running'
                        ? 'יד-המנוע: מחזור בעיצומו'
                        : data.engine.data.conclusion === 'failure'
                          ? '✗ יד-המנוע: הריצה האחרונה נכשלה — fail-honest'
                          : 'יד-המנוע: אין מדידה'}
                  </a>
                ) : (
                  <span className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">יד-המנוע: {data.engine?.error ?? 'לא זמין'}</span>
                )}
                {data.signing?.ok && data.signing.data ? (
                  <a
                    href={data.signing.data.url ?? 'https://github.com/roshpinacare-sys/saos-runtime/actions/workflows/signing-health.yml'}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded px-2 py-1 text-[10px] font-bold transition hover:opacity-80 ${
                      data.signing.data.conclusion === 'success'
                        ? 'bg-emerald-900/50 text-emerald-300'
                        : data.signing.data.conclusion === 'failure'
                          ? 'bg-rose-900/60 text-rose-200'
                          : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {data.signing.data.conclusion === 'success'
                      ? '✓ יד-החתימה חיה — active+posting מאומתים מול השרשרת'
                      : data.signing.data.conclusion === 'failure'
                        ? '✗ יד-החתימה אדומה — נבדק fail-honest'
                        : 'יד-החתימה: אין מדידה'}
                  </a>
                ) : (
                  <span className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">מד-החתימה: {data.signing?.error ?? 'לא זמין'}</span>
                )}
                {data.secrets?.ok && data.secrets.data ? (
                  <span className={`rounded px-2 py-1 text-[10px] font-bold ${data.secrets.data.clean ? 'bg-emerald-900/50 text-emerald-300' : 'bg-rose-900/60 text-rose-200'}`}>
                    {data.secrets.data.clean ? '✓ אפס-סודות בענן — סריקה נקייה' : `✗ חשודים: ${data.secrets.data.suspects.join(', ')}`}
                  </span>
                ) : (
                  <span className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">סריקת-סודות: {data.secrets?.error ?? 'לא זמין'}</span>
                )}
                <span className="font-mono text-[9px] text-zinc-600" dir="ltr">
                  scanned: {(data.secrets?.data?.scanned.length ?? 0)} files (hub root + command-center)
                </span>
              </div>
              <div className="mt-2 rounded bg-black/40 p-2 font-mono text-[9px] leading-relaxed text-emerald-600" dir="ltr">
                resurrection: git clone …saos-owner-channel &amp;&amp; PAT=*** bash RECOVER-ALL.sh — one command, whole organism
              </div>
            </Panel>

            {/* מפת-כלים */}
            <Panel title="ארגז-הכלים" sub="usability — מפה אחת לכל-9-הסוכנים" className="md:col-span-2 xl:col-span-3">
              <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { t: 'saos-dex', d: 'ה-DEX החי · engines · keeper · army lanes · builder scripts', r: 'roshpinacare-sys/saos-dex' },
                  { t: 'saos-runtime', d: '14+ וורקפלואים — האיברים האוטונומיים בענן', r: 'roshpinacare-sys/saos-runtime' },
                  { t: 'saos-owner-channel', d: 'ה-hub · CLAIMS · COORDINATION · BOOTSTRAP · RESURRECTION', r: 'roshpinacare-sys/saos-owner-channel' },
                  { t: 'FleetHQ', d: 'מפקדת-הצי · office-pages digest · כלי-ניתוח שנאספו', r: 'roshpinacare-sys/FleetHQ' },
                ].map((c) => (
                  <a key={c.t} href={`https://github.com/${c.r}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-900/30 bg-black/30 p-3 transition hover:border-emerald-700/60">
                    <div className="font-mono text-xs font-bold text-emerald-300" dir="ltr">{c.t}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-zinc-400">{c.d}</div>
                    <div className="mt-1 font-mono text-[9px] text-emerald-700" dir="ltr">{c.r}</div>
                  </a>
                ))}
              </div>
            </Panel>
          </div>
        ) : null}
      </main>

      {/* פוטר דביק */}
      <footer className="mt-auto border-t border-emerald-900/40 bg-[#07100d]/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500">
          <span>הריבונות החיה עובדת בעצמה · git הוא הבית · הענן הוא הבונה</span>
          <span className="font-mono" dir="ltr">
            last fetch {data?.at?.slice(11, 19) ?? '—'}Z · err: {err ? 'yes' : 'none'}
          </span>
        </div>
      </footer>
    </div>
  )
}
