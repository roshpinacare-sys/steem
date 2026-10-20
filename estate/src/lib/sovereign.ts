// sovereign.ts — שכבת-נתונים חיה למרכז-הפיקוד הריבוני (server-only)
// כל-הנתונים אמיתיים מה-git (roshpinacare-sys) — אפס מוקים. כשל = מתווגן בכנות.

export type Panel<T> = { ok: boolean; data: T | null; error?: string; at: string }

const GH = "https://api.github.com"
const ORG = "roshpinacare-sys"

function pat(): string {
  try {
    const raw = readPatFile()
    const m = raw.match(/=(.+)/)
    return (m ? m[1] : raw).replace(/[\r\n"'\s]/g, "")
  } catch {
    return ""
  }
}

function readPatFile(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("fs").readFileSync("/home/z/my-project/upload/pat.env", "utf8")
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
  const tok = pat()
  const r = await fetchT(`https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${path}`)
  if (r.ok) return JSON.parse(await r.text())
  // fallback: contents API (עבור ריפואים פרטיים)
  const api = await fetchT(
    `${GH}/repos/${ORG}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" } },
  )
  if (!api.ok) throw new Error(`raw ${repo}/${path} → ${r.status}/${api.status}`)
  const j = (await api.json()) as { content?: string; encoding?: string }
  if (j.encoding === "base64" && j.content) {
    return JSON.parse(Buffer.from(j.content, "base64").toString("utf8"))
  }
  throw new Error(`raw ${repo}/${path}: unexpected encoding`)
}

export async function rawText(repo: string, path: string, branch = "main"): Promise<string> {
  const tok = pat()
  const r = await fetchT(`https://raw.githubusercontent.com/${ORG}/${repo}/${branch}/${path}`)
  if (r.ok) return await r.text()
  const api = await fetchT(
    `${GH}/repos/${ORG}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" } },
  )
  if (!api.ok) throw new Error(`rawText ${repo}/${path} → ${r.status}/${api.status}`)
  const j = (await api.json()) as { content?: string; encoding?: string }
  if (j.encoding === "base64" && j.content) return Buffer.from(j.content, "base64").toString("utf8")
  throw new Error(`rawText ${repo}/${path}: unexpected`)
}

export async function ghApi<T>(path: string): Promise<T> {
  const tok = pat()
  const r = await fetchT(`${GH}${path}`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" },
  })
  if (!r.ok) throw new Error(`ghApi ${path} → ${r.status}`)
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
