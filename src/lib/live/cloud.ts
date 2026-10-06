// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Live Cloud Layer — האמת מהענן, בלי תלות בסנדבוקס.
//
// הסנדבוקס מת וחי מחדש — הרשת בענן ממשיכה לפעום. שכבה זו שולפת
// את האמת החיה מהמראה הציבורית (Console repo) ומה-API של גיטהאב,
// עם מטמון קצר (60 ש') כדי לא להציף. הסודות (PAT) נשארים צד-שרת
// בלבד — אף תשובה לעולם לא מחזירה אותם.
// ─────────────────────────────────────────────────────────────────────

import { appendFile, readFile } from "fs/promises";
import os from "os";
import path from "path";

const OWNER = "roshpinacare-sys";
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/Console/main`;
const GH_API = "https://api.github.com";

// ── מטמון פשוט בזיכרון (TTL לכל מפתח) ─────────────────────────────

interface CacheEntry {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

async function fetchJsonCached<T>(
  key: string,
  url: string,
  init?: RequestInit,
  ttlMs = 60_000
): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "the-weave-live/1.0",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`ענן השיב ${res.status} עבור ${key}`);
    }
    const value = (await res.json()) as T;
    cache.set(key, { at: now, value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

// ── המראה הציבורית (mirror.json) — נגזרת אמת, בלי סודות ────────────

export interface MirrorAttestation {
  seq: number;
  type: string;
  status: string;
  at: string;
  agentName: string;
  claim: string;
}
export interface MirrorCheckpoint {
  index: number;
  root: string;
  attFrom: number;
  attTo: number;
  at: string;
  anchoredOn: string[];
}
export interface MirrorAgent {
  name: string;
  role: string;
  status: string;
  address: string;
  attestations: number;
  lastAttestationSeq: number | null;
  lastAttestationAt: string | null;
}
export interface MirrorBrain {
  fingerprint: string;
  status: string;
  lastCode: string;
  verifiedAt: string;
}
export interface MirrorStats {
  attestations: number;
  checkpoints: number;
  agents: number;
  brainKeys: number;
  brainLive: number;
  attByStatus: Record<string, number>;
  headHash: string;
  // R119 · חיות קנונית — נחשבת מהספר המלא בזמן הפרסום (mirror.ts ← vitality.ts,
  // חוק ההגדרה-היחידה). החלון (120 אימותים אחרונים) הוא לתצוגה בלבד.
  vitality?: MirrorVitalityCanon;
}
/** החיות כפי שחושבה מהספר המלא בזמן פרסום המראה — אותם שדות כמו VitalityDTO */
export interface MirrorVitalityCanon {
  atts24h: number;
  atts7d: number;
  signers24h: number;
  checkpoints24h: number;
  marketEvents24h: number;
  aliveDays: number;
  lastAttAgeMin: number;
  computedAtIso: string;
}
export interface Mirror {
  format: string;
  generatedAt: string;
  stats: MirrorStats;
  agents: MirrorAgent[];
  attestations: MirrorAttestation[];
  checkpoints: MirrorCheckpoint[];
  anchorLines: { steem?: unknown[]; zero?: unknown[]; [k: string]: unknown[] | undefined };
  market: Array<{ seq: number; kind: string; at: string; summary: string }>;
  brain: MirrorBrain[];
}

export function getMirror(): Promise<Mirror> {
  return fetchJsonCached<Mirror>("mirror", `${RAW_BASE}/mirror.json`, undefined, 60_000);
}

// ── עד השרשרת הציבורית (status.json — Steem public RPC) ─────────────

export interface ChainStatus {
  format: string;
  generatedAt: string;
  source: { kind: string; node: string; account: string; opId: string };
  freshness: { verdict: string; ageHours: number; thresholdHours: number; cadence: string };
  witness: {
    account: string;
    opId: string;
    txid: string;
    block: number;
    explorer: string;
    at: string;
    checkpoint: number;
    root: string;
    attFrom: number;
    attTo: number;
    attestations: number;
    headHash: string;
    commit: string;
  };
}

export function getChainStatus(): Promise<ChainStatus> {
  return fetchJsonCached<ChainStatus>("status", `${RAW_BASE}/status.json`, undefined, 60_000);
}

// ── רישום הסוכנים הציבורי (agents/registry.json) ────────────────────

export interface RegistryAgent {
  id: string;
  name: string;
  repo: string;
  visibility: string;
  schedule: string;
  layer: string;
  role: { en: string; he: string };
  input: { en: string; he: string };
  output: { en: string; he: string };
  state: string;
  stats?: {
    runs_sampled: number;
    success: number;
    failure: number;
    other: number;
    successRate: number;
    avgDurS: number;
  };
  lastRun?: { at: string; conclusion: string };
}
export interface AgentsRegistry {
  ok: boolean;
  generatedAt: string;
  source: string;
  reposTotal: number;
  reposWithAgents: string[];
  reposIdle: string[];
  agents: RegistryAgent[];
}

export function getAgentsRegistry(): Promise<AgentsRegistry> {
  return fetchJsonCached<AgentsRegistry>(
    "registry",
    `${RAW_BASE}/agents/registry.json`,
    undefined,
    120_000
  );
}

// ── מצב הסוכן הציבורי (agent/state.json) — הנחיות ופאזה ──────────────

export interface AgentStatePublic {
  format: string;
  phase: string;
  standingOrders: Array<{ id: string; en?: string; he?: string }>;
  [k: string]: unknown;
}

export function getAgentState(): Promise<AgentStatePublic> {
  return fetchJsonCached<AgentStatePublic>(
    "agent-state",
    `${RAW_BASE}/agent/state.json`,
    undefined,
    120_000
  );
}

// ── ספר הבקשות הציבורי (agent/requests.json) ─────────────────────────

export interface AgentRequestsPublic {
  requests: Array<{ id: string; status: string }>;
  [k: string]: unknown;
}

export function getAgentRequests(): Promise<AgentRequestsPublic> {
  return fetchJsonCached<AgentRequestsPublic>(
    "agent-requests",
    `${RAW_BASE}/agent/requests.json`,
    undefined,
    120_000
  );
}

// ── תוצאות האימות העצמאי (agent/verify/results.json) ─────────────────

export interface VerifyResultsPublic {
  summary: { total: number; passed: number; failed: number; verdict: string };
  [k: string]: unknown;
}

export function getVerifyResults(): Promise<VerifyResultsPublic> {
  return fetchJsonCached<VerifyResultsPublic>(
    "verify-results",
    `${RAW_BASE}/agent/verify/results.json`,
    undefined,
    120_000
  );
}

// ── ה-PAT — שרשרת-סמכות ריבונית, צד-שרת בלבד ────────────────────────
//
// r185 · D-OP-01 ("יש לך את כל הסיסמאות שלי תפעיל הכל מיד"): אף קריאת-
// GitHub-כתיבה לא נכשלת עוד מחוסר-סמכות מקומית. שרשרת המקורות:
//   1. .git/config (x-access-token — דפוס-העבר)
//   2. upload/pat.env (טוקן-המנוע, מחוץ-לגיט)
//   3. כספת הסוכנים ~/.sovereign/vault/secrets/WEAVE_OPS_PAT (0600)
// כל קריאה מהכספת נרשמת access.log (שם+זמן בלבד). הערך לעולם לא בלוג
// ולא בתשובה — צד-שרת בלבד.

let cachedToken: string | null | undefined;

export async function getGhToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    const cfg = await readFile(path.join(process.cwd(), ".git/config"), "utf8");
    const m = cfg.match(/x-access-token:([^@]+)@/);
    if (m) {
      cachedToken = m[1];
      return cachedToken;
    }
  } catch {
    /* המקור הבא בשרשרת */
  }
  try {
    const { engineToken } = await import("@/lib/dex-token");
    const t = engineToken();
    if (t) {
      cachedToken = t;
      return cachedToken;
    }
  } catch {
    /* המקור הבא בשרשרת */
  }
  try {
    const vaultPat = path.join(os.homedir(), ".sovereign", "vault", "secrets", "WEAVE_OPS_PAT");
    const t = (await readFile(vaultPat, "utf8")).trim();
    if (t.length > 20) {
      try {
        await appendFile(
          path.join(os.homedir(), ".sovereign", "vault", "access.log"),
          `${new Date().toISOString()} read WEAVE_OPS_PAT\n`,
          { mode: 0o600 },
        );
      } catch {
        /* כישלון-רישום אינו חוסם */
      }
      cachedToken = t;
      return cachedToken;
    }
  } catch {
    /* כנות: אין סמכות */
  }
  cachedToken = null;
  return cachedToken;
}

// ── GitHub API — פעילות ריפואים וריצות ─────────────────────────────

export interface RepoInfo {
  name: string;
  pushedAt: string;
  private: boolean;
  archived: boolean;
}

export async function getRepos(): Promise<RepoInfo[]> {
  const token = await getGhToken();
  const repos = await fetchJsonCached<Array<{ name: string; pushed_at: string; private: boolean; archived: boolean }>>(
    "repos",
    `${GH_API}/user/repos?per_page=100&sort=pushed&affiliation=owner`,
    token ? { headers: { Authorization: `token ${token}` } } : undefined,
    120_000
  );
  return repos.map((r) => ({
    name: r.name,
    pushedAt: r.pushed_at,
    private: r.private,
    archived: r.archived,
  }));
}

export interface WorkflowRunInfo {
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  event: string;
  htmlUrl: string;
}

export async function getRecentRuns(repo: string, perPage = 5): Promise<WorkflowRunInfo[]> {
  const token = await getGhToken();
  const data = await fetchJsonCached<{ workflow_runs?: Array<{
    name: string; status: string; conclusion: string | null; created_at: string; event: string; html_url: string;
  }> }>(
    `runs:${repo}`,
    `${GH_API}/repos/${OWNER}/${repo}/actions/runs?per_page=${perPage}`,
    token ? { headers: { Authorization: `token ${token}` } } : undefined,
    60_000
  );
  return (data.workflow_runs ?? []).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    event: r.event,
    htmlUrl: r.html_url,
  }));
}

// ── הפעלת סוכן ענן (workflow dispatch) — היד של המפעיל ───────────────

export const DISPATCHABLE: Array<{ repo: string; workflow: string; label: string; description: string }> = [
  { repo: "Zip", workflow: "weave-heart.yml", label: "פעימת לב", description: "אימות שרשרת + קומיט פעימה + הזנקת קווי העוגן" },
  { repo: "Zip", workflow: "weave-anchor-lines.yml", label: "קווי עוגן", description: "עיגון Steem/Hive/ZERO לצ'קפוינט האחרון" },
  { repo: "Zip", workflow: "weave-ecosystem.yml", label: "סריקת אקוסיסטם", description: "מדידת שכפול בכל 14 הריפואים" },
  { repo: "Zip", workflow: "web-publish.yml", label: "שידור רשת-אחסון", description: "העלאת צ׳אנקי תוכן מהדואר הנכנס אל שרשרת Steem — כל עוד תקציב ה-RC מאפשר" },
  { repo: "steem", workflow: "cloud-heart.yml", label: "לב הצי", description: "פעימת saosnet live מול RPC ציבורי" },
  { repo: "saos-dex", workflow: "dex-beat.yml", label: "פעימת בורסה", description: "חישוב שוק + פרסום נתוני DEX" },
  { repo: "saos-dex", workflow: "dex-grid.yml", label: "גריד חוץ", description: "ריצת הגריד החיצוני — ספר STEEM/SBD החי, ממיין מחדש ומפרסם לקונסולה" },
  { repo: "Console", workflow: "agents-watch.yml", label: "רענון רישום סוכנים", description: "עדכון registry מה-API של גיטהאב" },
  { repo: "Console", workflow: "dex-watch.yml", label: "סריקת הפקדות", description: "סריקת TRON/ETH/SOL/BTC אחר כסף נכנס" },
];

export async function dispatchWorkflow(repo: string, workflow: string): Promise<void> {
  const allowed = DISPATCHABLE.some((d) => d.repo === repo && d.workflow === workflow);
  if (!allowed) throw new Error("סוכן זה אינו ברשימת ההפעלה המאושרת");
  const token = await getGhToken();
  if (!token) throw new Error("אין אסמכתה צד-שרת לגיטהאב — לא ניתן להפעיל");
  const res = await fetch(
    `${GH_API}/repos/${OWNER}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "the-weave-live/1.0",
      },
      body: JSON.stringify({ ref: "main" }),
      // R112 — law of the bounded wait: no fetch without a deadline
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!res.ok && res.status !== 202) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`גיטהאב סירב (${res.status}): ${body}`);
  }
}

// ── חישוב חיות מהמראה (בלי DB מקומי) ────────────────────────────────

export interface MirrorVitalityView {
  atts24h: number;
  atts7d: number;
  signers24h: number | null;
  checkpoints24h: number;
  marketEvents24h: number | null;
  lastAttAgeMin: number;
  aliveDays: number;
  /** R119: false = מהספר המלא (קנון). true = חלון-מראה ישן בלבד — הספירות
   * החלוניות מתויגות, לא מוצגות כאילו היו אמת-ספר. */
  windowLimited: boolean;
  computedAtIso: string | null;
}

export function computeVitalityFromMirror(mirror: Mirror): MirrorVitalityView {
  // R119 · חוק המקור-היחיד: אם המראה פורסמה עם vitality מהספר המלא — היא האמת
  // (נחשבה בזמן הפרסום על-ידי mirror.ts בדיוק באותה הגדרה קנונית). החלון
  // (120 האימותים האחרונים) אינו מקור לחיים — הוא מציג את גודלו כאילו היה אמת.
  const canon = mirror.stats.vitality;
  if (canon) {
    return {
      atts24h: canon.atts24h,
      atts7d: canon.atts7d,
      signers24h: canon.signers24h,
      checkpoints24h: canon.checkpoints24h,
      marketEvents24h: canon.marketEvents24h,
      lastAttAgeMin: canon.lastAttAgeMin,
      aliveDays: canon.aliveDays,
      windowLimited: false,
      computedAtIso: canon.computedAtIso ?? null,
    };
  }
  // פאלבק כנה למראה ישנה (טרום-R119): מה שהחלון מסוגל למדוד באמת נמדד
  // (atts24h/signers24h — החלון מכסה לפחות 24 שעות), והשאר מתויג חלון.
  const now = Date.now();
  const at = (iso: string) => new Date(iso).getTime();
  const atts = mirror.attestations;
  const cps = mirror.checkpoints;
  const atts24hWindow = atts.filter((a) => now - at(a.at) < 86_400_000);
  const atts24h = atts24hWindow.length;
  const atts7d = atts.filter((a) => now - at(a.at) < 7 * 86_400_000).length;
  const checkpoints24h = cps.filter((c) => now - at(c.at) < 86_400_000).length;
  const lastAttAgeMin = atts.length
    ? Math.max(0, Math.round((now - at(atts[0].at)) / 60_000))
    : -1;
  const first = atts.length ? at(atts[atts.length - 1].at) : now;
  const aliveDays = Math.max(1, Math.round((now - first) / 86_400_000));
  const signers24h = new Set(atts24hWindow.map((a) => a.agentName)).size || null;
  return {
    atts24h,
    atts7d,
    signers24h,
    checkpoints24h,
    marketEvents24h: null,
    lastAttAgeMin,
    aliveDays,
    windowLimited: true,
    computedAtIso: null,
  };
}
