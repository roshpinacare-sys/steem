// sovereign.ts — שכבת-נתונים חיה למרכז-הפיקוד הריבוני (server-only)
// כל-הנתונים אמיתיים מה-git (roshpinacare-sys) — אפס מוקים. כשל = מתווגן בכנות.

export type Panel<T> = { ok: boolean; data: T | null; error?: string; at: string }

const GH = "https://api.github.com"
const ORG = "roshpinacare-sys"

// רוטציית-טוקן לעולם לא תעוור את הפיקוד: שרשרת-מועמדים, הריבונות (saos-steem) קודמת
const PAT_FILES = [
  "/home/z/saos-steem/upload/pat.env", // מקור-האמת הריבוני (אטום ב-git-vault, חי דרך כל הגלים)
  "/home/z/my-project/upload/pat.env", // עותק מקומי של ה-builder (עלול להתיישן)
]

function parsePat(raw: string): string {
  const m = raw.match(/=(.+)/)
  return (m ? m[1] : raw).replace(/[\r\n"'\s]/g, "")
}

function patCandidates(): string[] {
  const out: string[] = []
  for (const f of PAT_FILES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tok = parsePat(require("fs").readFileSync(f, "utf8"))
      if (tok && !out.includes(tok)) out.push(tok)
    } catch {
      /* כנה: קובץ חסר = דלג */
    }
  }
  return out
}

function pat(): string {
  return patCandidates()[0] ?? ""
}

async function authedFetch(url: string, ms = 9000): Promise<Response> {
  const cands = patCandidates()
  let last: Response | null = null
  for (const tok of cands) {
    const r = await fetchT(url, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" },
    }, ms)
    if (r.ok) return r
    last = r
    if (r.status !== 401 && r.status !== 403) return r // שגיאה שאינה-אימות: אין טעם לנסות טוקן אחר
  }
  return last as Response
}

async function fetchT(url: string, opts: RequestInit = {}, ms = 9000): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, cache: "no-store" })
  } finally {
    clearTimeout(t)
  }
}

// קובץ גולמי מ-main (ריפו ציבורי) — עם fallback ל-contents-API מאומת (ריפו פרטי)
export async function rawFile(repo: string, path: string, branch = "main"): Promise<unknown> {
  const r = await fetchT(`https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${path}`)
  if (r.ok) return JSON.parse(await r.text())
  // fallback: contents API (עבור ריפואים פרטיים) — עם שרשרת-טוקנים
  const api = await authedFetch(
    `${GH}/repos/${ORG}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
  )
  if (!api.ok) throw new Error(`raw ${repo}/${path} → ${r.status}/${api.status}`)
  const j = (await api.json()) as { content?: string; encoding?: string }
  if (j.encoding === "base64" && j.content) {
    return JSON.parse(Buffer.from(j.content, "base64").toString("utf8"))
  }
  throw new Error(`raw ${repo}/${path}: unexpected encoding`)
}

export async function rawText(repo: string, path: string, branch = "main"): Promise<string> {
  const r = await fetchT(`https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${path}`)
  if (r.ok) return await r.text()
  const api = await authedFetch(
    `${GH}/repos/${ORG}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
  )
  if (!api.ok) throw new Error(`rawText ${repo}/${path} → ${r.status}/${api.status}`)
  const j = (await api.json()) as { content?: string; encoding?: string }
  if (j.encoding === "base64" && j.content) return Buffer.from(j.content, "base64").toString("utf8")
  throw new Error(`rawText ${repo}/${path}: unexpected`)
}

export async function ghApi<T>(path: string): Promise<T> {
  const r = await authedFetch(`${GH}${path}`)
  if (!r || !r.ok) throw new Error(`ghApi ${path} → ${r ? r.status : "no-token"}`)
  return (await r.json()) as T
}

// —— צורות ( defensive ) ——
export type Snapshot = {
  version: number
  savedAt: string
  state: {
    height: number
    balances: Record<string, Record<string, number>>
    credits: Record<string, number>
    feeMeter?: number
    pools?: Record<string, { base?: string; quote?: string; rBase?: number; rQuote?: number; k?: number; feeBps?: number } | Record<string, number>>
    stats?: Record<string, unknown>
    treasuryProfit?: number
    treasuryProfitEver?: number
    gasUsed?: number
    journal?: unknown[]
  }
}

export type ArmyPublic = {
  schema: string
  at: string
  roster: number
  acted: number
  stasis: number
  halted: number
  estateOpenOrders: number
  estateLockedSteem: number
  estateCapSteem: number
  verdict: string
  mid?: number
}

export type VolumeVerify = {
  schema: string
  at: string
  verdict: string
  txChecks: { total: number; verified: number; exposed: number; unreachable: number }
  chainFills: { count: number; makerFills: number; takerFills: number; volumeSteem: number; volumeSbd: number; byAccount: Record<string, number> }
}

export type Klines = { version: number; savedAt: number; pairs: Record<string, Array<{ t: number; o: number; h: number; l: number; c: number; vMu: number; qMu: number; n: number }>> }

export type MakerStats = { recs: Record<string, { fills: number; volMu: number; lastAt: number; lastH: number }> }

export type WorkflowRun = {
  id: number
  name: string
  status: string
  conclusion: string | null
  created_at: string
  updated_at: string
  html_url: string
  run_attempt: number
}

export type GhCommit = {
  sha: string
  html_url: string
  commit: { message: string; author: { name?: string; date: string } }
}

export type FeedItem = { repo: string; sha: string; msg: string; at: string | null; url: string }

// יומן-הריבונות: ה-commit-ים הם הקבלות — קיר אחד מ-4-הריפואים
export async function repoCommits(repo: string, perPage = 8): Promise<FeedItem[]> {
  const arr = await ghApi<GhCommit[]>(`/repos/${ORG}/${repo}/commits?per_page=${perPage}`)
  return arr.map((c) => ({
    repo,
    sha: c.sha.slice(0, 7),
    msg: (c.commit.message ?? "").split("\n")[0].slice(0, 160),
    at: c.commit.author?.date ?? null,
    url: c.html_url,
  }))
}

// —— מגן-השרידות (W4-G): כלי-התחייה על הענן + סריקת-אפס-סודות ——
// החוק: הארסנל חי על main ב-hub; הסנדבוקס אפמרלי. האתר עצמו מציג-בכל-רגע
// שכלי-התחייה קיימים בענן ושאפס סודות דלף. חסר/דלף = אדום גלוי.

export type RecoveryAsset = {
  path: string
  exists: boolean
  sha: string | null
  lastAt: string | null
  msg: string | null
  url: string | null
}

export const ARSENAL_PATHS = [
  "BOOTSTRAP.sh",
  "BOOTSTRAP-COMMAND-CENTER.sh",
  "RECOVER-ALL.sh",
  "AGENT-MANUAL.md",
  "RESURRECTION.md",
  "command-center/src/app/page.tsx",
  "command-center/worklog.md",
] as const

export async function recoveryAssets(): Promise<RecoveryAsset[]> {
  return Promise.all(
    ARSENAL_PATHS.map(async (p): Promise<RecoveryAsset> => {
      try {
        const arr = await ghApi<GhCommit[]>(
          `/repos/${ORG}/saos-owner-channel/commits?path=${encodeURIComponent(p)}&per_page=1`,
        )
        if (!arr.length) return { path: p, exists: false, sha: null, lastAt: null, msg: null, url: null }
        const c = arr[0]
        return {
          path: p,
          exists: true,
          sha: c.sha.slice(0, 7),
          lastAt: c.commit.author?.date ?? null,
          msg: (c.commit.message ?? "").split("\n")[0].slice(0, 110),
          url: c.html_url,
        }
      } catch (e: unknown) {
        // 404 (נתיב שלא-התקיים-מעולם) או כשל-רשת — שניהם מוצגים fail-closed כ"חסר"
        return {
          path: p,
          exists: false,
          sha: null,
          lastAt: null,
          msg: e instanceof Error && e.message.includes("404") ? null : `api: ${e instanceof Error ? e.message : String(e)}`.slice(0, 80),
          url: null,
        }
      }
    }),
  )
}

export type SecretSweep = { clean: boolean; suspects: string[]; scanned: string[] }

// —— בריאות-יד-החתימה (W5-β) ——
// המד-האמיתי חי ב-saos-runtime ("signing-health (runtime-host)", שעתי :43):
// G1..G4 — WIF-active + WIF-posting מנתחים ונגזרים, ונגד-סמכויות-חיות-בשרשרת.
// מוודא-חי: העותק-בריפו-steem מעולם לא רץ (0 צעדים, לוגים-ריקים) — הענן-הוא הבית.
export type SigningHealth = {
  conclusion: "success" | "failure" | "unknown"
  startedAt: string | null
  url: string | null
}

export async function signingHealth(): Promise<SigningHealth> {
  try {
    const d = await ghApi<{ workflow_runs: Array<{ id: number; conclusion: string | null; run_started_at: string | null; html_url: string }> }>(
      `/repos/${ORG}/saos-runtime/actions/workflows/signing-health.yml/runs?per_page=1`,
    )
    const r = d.workflow_runs?.[0]
    if (!r) return { conclusion: "unknown", startedAt: null, url: null }
    const c = r.conclusion === "success" ? "success" : r.conclusion === "failure" ? "failure" : "unknown"
    return { conclusion: c, startedAt: r.run_started_at, url: r.html_url ?? null }
  } catch {
    return { conclusion: "unknown", startedAt: null, url: null }
  }
}

// —— המוח-הריבוני (W6): מחזור-ההחלטות SOV-POLICY/1 ב-FleetHQ ——
// העיקרון שהקובץ מצהיר: הריבונות מחליטה ומבצעת; הפניה-לבעלים = שלילת-הריבונות.
// sense (מדדי-טריות של 6 מקורות) → decisions (ראיה-מדודה לכל-החלטה) → record (git commit).
// מחזור decide חצי-שעתי ב-FleetHQ משכתב-את-הקובץ; האתר מציג-את-המוח — לא-חבוי.
export type DecisionSense = { ok: boolean; ageMin: number }

export type DecisionItem = {
  id: string
  from?: string
  area?: string
  title?: string
  status?: string
  decidedAt?: string
  executedAt?: string
  reasoning?: string
  evidence?: Record<string, unknown>
}

export type SovereignDecisions = {
  schema: string
  generatedAt: string
  policyVersion: string
  principle?: string
  authority: string
  authorityOf?: string
  authorityEnvelope?: { execute?: string[]; gates?: string[] }
  sense: Record<string, DecisionSense>
  decisions: DecisionItem[]
  stats?: { standing?: number; thisRun?: number; total?: number }
}

export async function sovereignDecisions(): Promise<SovereignDecisions> {
  const j = (await rawFile("FleetHQ", "office/state/sovereign-decisions.json")) as SovereignDecisions
  if (!j || !Array.isArray(j.decisions) || !j.policyVersion) {
    throw new Error("sovereign-decisions: unexpected shape")
  }
  return j
}

// —— תור-האשרורים (W7): מה-מחכה-להחלטת-הבעלים ——
// שלושה-מקורות-אמת: (1) fabric/saos-dex — הצעות-הלמידה-האוטונומית וכמה-נשפטו;
// (2) תוכנית-הערך ב-outbox ה-hub — הבלתי-הפיכים-הממתינים-לחתימה;
// (3) החלטות-חמושות-מותנות מקובץ-המוח — מחושב-צד-לקוח מהנתונים-שכבר-נשלפו.
export type FabricQueue = {
  proposals: number
  reviewed: number
  reviewPaths: string[]
}

export async function fabricQueue(): Promise<FabricQueue> {
  const root = await ghApi<{ tree: Array<{ path: string; type: string; sha: string }> }>(
    `/repos/${ORG}/saos-dex/git/trees/main`,
  )
  const fabric = (root.tree ?? []).find((e) => e.type === "tree" && e.path === "fabric")
  if (!fabric) return { proposals: 0, reviewed: 0, reviewPaths: [] }
  const t = await ghApi<{ tree: Array<{ path: string; type: string }> }>(
    `/repos/${ORG}/saos-dex/git/trees/${fabric.sha}?recursive=1`,
  )
  const dirs = new Set(t.tree.map((e) => e.path.split("/")[0]).filter((p) => p && !p.includes(".")))
  const reviews = t.tree.filter((e) => e.type === "blob" && /REVIEW/i.test(e.path.split("/").pop() ?? ""))
  return { proposals: dirs.size, reviewed: reviews.length, reviewPaths: reviews.map((r) => r.path).slice(0, 10) }
}

export type IrreversiblesQuote = { found: boolean; quote: string | null; source: string }

export async function irreversiblesQuote(): Promise<IrreversiblesQuote> {
  const path = "outbox/W5-VALUE-PLAN-2026-10-18.md"
  const t = await rawText("saos-owner-channel", path)
  const flat = t.replace(/\s+/g, " ")
  const i = flat.indexOf("נותרים-בתור-החתימה")
  return {
    found: i >= 0,
    quote: i >= 0 ? flat.slice(i, i + 320) : null,
    source: `https://github.com/${ORG}/saos-owner-channel/blob/main/${path}`,
  }
}

// —— פעימת-יד-המנוע (W5-γ) ——
// הגשר (steem-hand-revival ב-runtime) = האיבר-היחיד-עם-אפקט-אמיתי:
// מחזור doctrine-capped (SENSE→DECIDE→ACT→RECORD) — curate מצביע, execute כפוף
// לשערי-המנוע. האתר מציג-את-פסק-הריצה-האחרון — היכן-שהוא-לא-צריך-להיות-חבוי.
export type EnginePulse = {
  conclusion: "success" | "failure" | "running" | "unknown"
  event: string | null
  at: string | null
  url: string | null
}

export async function enginePulse(): Promise<EnginePulse> {
  try {
    const d = await ghApi<{ workflow_runs: Array<{ conclusion: string | null; event: string; created_at: string | null; html_url: string }> }>(
      `/repos/${ORG}/saos-runtime/actions/workflows/steem-hand-revival.yml/runs?per_page=1`,
    )
    const r = d.workflow_runs?.[0]
    if (!r) return { conclusion: "unknown", event: null, at: null, url: null }
    const c = r.conclusion === "success" ? "success" : r.conclusion === "failure" ? "failure" : r.conclusion === null ? "running" : "unknown"
    return { conclusion: c, event: r.event, at: r.created_at, url: r.html_url ?? null }
  } catch {
    return { conclusion: "unknown", event: null, at: null, url: null }
  }
}

// אפס-סודות בענן (חוק-מפתח של ה-owner): סריקת שורש ה-hub + command-center —
// אסורים: pat.env/.env*/מפתחות/קרדנשלים/tokens. היסטוריית my-project המקומית מעולם לא יצאה מהמכונה.
const SECRET_RX = /^(pat\.env|\.env(\..+)?|.*\.pem|id_rsa.*|id_ed25519.*|.*credentials.*|.*token\.(env|txt|key))$/i

export async function secretSweep(): Promise<SecretSweep> {
  const [root, cc] = await Promise.all([
    ghApi<Array<{ name: string; type: string }>>(`/repos/${ORG}/saos-owner-channel/contents`),
    ghApi<Array<{ name: string; type: string }>>(`/repos/${ORG}/saos-owner-channel/contents/command-center`),
  ])
  const scanned: string[] = []
  const suspects: string[] = []
  for (const list of [root, cc]) {
    for (const f of list) {
      scanned.push(f.name)
      if (f.type === "file" && SECRET_RX.test(f.name)) suspects.push(f.name)
    }
  }
  return { clean: suspects.length === 0, suspects, scanned }
}

// —— סיכום-איברים (אורגנים) ——
export const ORGAN_NAMES = [
  "dex-beat",
  "sovereign-runtime",
  "sovereign-pulse",
  "grid-watchdog",
  "army-ladder",
  "arb-grid",
  "treasury-ladder",
  "fleet-fuel",
  "sovereign-evolution",
  "escrow-payroll",
  "fee-engine",
  "self-memory",
  "system-map",
  "directive-now",
] as const

// קצבים נמדדים (W1.5/W2): beat 39–46 דק' → fresh 4500s; ladders שעתיים;
// sovereign-pulse = 4+4 פעימות/יום (crons :17/:47) → fresh 6.5h; sovereign-runtime = הקצב של חצי-שעה
export const ORGAN_FRESHNESS_SEC: Record<string, number> = {
  "dex-beat": 4500,
  "sovereign-runtime": 4500,
  "sovereign-pulse": 23400,
  "grid-watchdog": 5400,
  "army-ladder": 7200,
  "arb-grid": 7200,
  "treasury-ladder": 25200,
  "fleet-fuel": 7200,
  "sovereign-evolution": 93600,
  "escrow-payroll": 93600,
  "fee-engine": 93600,
  "self-memory": 93600,
  "system-map": 93600,
  "directive-now": 93600,
}

// —— המנוע-הריבוני · חי (W22-a) ——
// הקופה האמיתית של הריבונות על-גבי Steem: headcorner + הצבא + הספרים.
// עד-היום המנוע היה בלתי-נראה במרכז-הפיקוד — ה-owner ביקש זרימה וראה ריק.
// מקורות: קריאה-ישירה למנוע בן-אותו-מארח (אפס-שהות), קבצי-מדינה מקומיים,
// ונפילה-ל-GitHub (rawFile) כשהקופסא מתה — הפאנל לעולם לא שקרי.

export type EngineExecEntry = {
  at?: string
  tag?: string
  account?: string
  txid?: string | null
  error?: string | null
  verdict?: string
}

export type EngineLive = {
  ok: boolean
  at: string
  account: string | null
  healthAt: string | null
  custody: { verified: number; total: number; accounts: Record<string, string> } | null
  credentialMode: string | null
  inventory: { steem: number | null; sbd: number | null; spOwn: number | null; rcPct: number | null } | null
  pnl: { fills: number | null; buys: number | null; sells: number | null; realizedSbd: number | null } | null
  orders: number | null
  lastFillAt: string | null
  feed: number | null
  conversions: number | null
  cycles: { autoRuns?: number; ok?: number; fail?: number; blocked?: number; lastAutoRunAt?: string | null; lastMs?: number | null } | null
  armed: Array<{ id: string; armed?: boolean; op?: string }>
  execLog: EngineExecEntry[]
  sources: { engine: string; sovereign: string; orders: string; exec: string }
}

async function engineHttp<T>(path: string, ms: number): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(`http://127.0.0.1:3040${path}`, { signal: ctl.signal, cache: "no-store" })
    if (!r.ok) throw new Error(`engine ${path} → ${r.status}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(t)
  }
}

function localJson<T>(p: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return JSON.parse(require("fs").readFileSync(p, "utf8")) as T
  } catch {
    return null
  }
}

function localTextTail(p: string, lines: number): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const t = require("fs").readFileSync(p, "utf8").trim()
    if (!t) return null
    return t.split("\n").filter(Boolean).slice(-lines).join("\n")
  } catch {
    return null
  }
}

async function githubJsonFallback<T>(repo: string, path: string): Promise<T | null> {
  try {
    return (await rawFile(repo, path)) as T
  } catch {
    return null
  }
}

type OperatorOrdersFile = { orders?: Record<string, { armed?: boolean; op?: string }> }

export async function engineLive(): Promise<EngineLive> {
  const STEEM = "/home/z/saos-steem/mini-services/saos-engine"
  const sources = { engine: "dead", sovereign: "dead", orders: "dead", exec: "dead" }

  // 1) המנוע חי? (אפס-שהות — אותו-מארח)
  let status: Record<string, unknown> | null = null
  let health: Record<string, unknown> | null = null
  try {
    status = await engineHttp<Record<string, unknown>>("/status", 9000)
    sources.engine = "live-local"
  } catch {
    try {
      health = await engineHttp<Record<string, unknown>>("/health", 5000)
      sources.engine = "health-only"
    } catch {
      /* המנוע מת — כנות */
    }
  }
  if (!health) {
    try {
      health = await engineHttp<Record<string, unknown>>("/health", 5000)
    } catch {
      /* כנות */
    }
  }

  // 2) מדינה מקומית → GitHub נפילה
  let cycles = localJson<EngineLive["cycles"]>(`${STEEM}/state/sovereign.json`)?.cycles ?? null
  if (cycles) sources.sovereign = "local"
  else {
    const gh = await githubJsonFallback<{ cycles?: EngineLive["cycles"] }>("steem", "mini-services/saos-engine/state/sovereign.json")
    if (gh?.cycles) {
      cycles = gh.cycles
      sources.sovereign = "github"
    }
  }

  let ordersFile = localJson<OperatorOrdersFile>(`${STEEM}/state/operator-orders.json`)
  if (ordersFile) sources.orders = "local"
  else {
    ordersFile = await githubJsonFallback<OperatorOrdersFile>("steem", "mini-services/saos-engine/state/operator-orders.json")
    if (ordersFile) sources.orders = "github"
  }

  let execRaw = localTextTail(`${STEEM}/state/exec-log.jsonl`, 8)
  if (execRaw) sources.exec = "local"
  else {
    try {
      execRaw = await rawText("steem", "mini-services/saos-engine/state/exec-log.jsonl")
      sources.exec = "github"
    } catch {
      execRaw = null
    }
  }
  const execLog: EngineExecEntry[] = (execRaw ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        const j = JSON.parse(l) as Record<string, unknown>
        return {
          at: typeof j.at === "string" ? j.at : undefined,
          tag: typeof j.tag === "string" ? j.tag : undefined,
          account: typeof j.account === "string" ? j.account : undefined,
          txid: typeof j.txid === "string" ? j.txid : null,
          error: typeof j.error === "string" ? j.error : null,
          verdict: typeof j.verdict === "string" ? j.verdict : undefined,
        }
      } catch {
        return { tag: "unparsed" }
      }
    })

  // 3) מוזיאון-הנתונים מה-/status החי
  const observe = (status?.observe ?? null) as Record<string, unknown> | null
  const inv = (observe?.inventory ?? null) as Record<string, number> | null
  const pnl = (observe?.pnl ?? null) as Record<string, number> | null
  const ordersArr = (observe?.orders ?? null) as unknown[] | null
  const ac = (health?.armyCustody ?? null) as { verified?: number; total?: number; accounts?: Record<string, string> } | null
  const convArr = (status?.conversions ?? null) as unknown[] | null

  const armed: Array<{ id: string; armed?: boolean; op?: string }> = Object.entries(ordersFile?.orders ?? {}).map(
    ([id, v]) => ({ id, armed: v?.armed, op: v?.op }),
  )

  return {
    ok: !!status,
    at: (typeof status?.at === "string" ? status.at : null) ?? new Date().toISOString(),
    account: (typeof status?.account === "string" ? status.account : null) ?? (typeof health?.account === "string" ? (health.account as string) : null),
    healthAt: typeof health?.at === "string" ? health.at : null,
    custody: ac ? { verified: ac.verified ?? 0, total: ac.total ?? 0, accounts: ac.accounts ?? {} } : null,
    credentialMode: typeof health?.credentialMode === "string" ? health.credentialMode : null,
    inventory: inv
      ? {
          steem: typeof inv.steem === "number" ? inv.steem : null,
          sbd: typeof inv.sbd === "number" ? inv.sbd : null,
          spOwn: typeof inv.spOwn === "number" ? inv.spOwn : null,
          rcPct: typeof inv.rcPct === "number" ? inv.rcPct : null,
        }
      : null,
    pnl: pnl
      ? {
          fills: typeof pnl.fills === "number" ? pnl.fills : null,
          buys: typeof pnl.buys === "number" ? pnl.buys : null,
          sells: typeof pnl.sells === "number" ? pnl.sells : null,
          realizedSbd: typeof pnl.realizedSbd === "number" ? pnl.realizedSbd : null,
        }
      : null,
    orders: Array.isArray(ordersArr) ? ordersArr.length : null,
    lastFillAt: typeof observe?.lastFillAt === "string" ? (observe.lastFillAt as string) : null,
    feed: typeof observe?.feed === "number" ? observe.feed : null,
    conversions: Array.isArray(convArr) ? convArr.length : null,
    cycles,
    armed,
    execLog,
    sources,
  }
}
