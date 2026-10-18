import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* [agent-9/I1] כספת-הביטוח · קריאה-ציבורית — אפס-סודות, קריאה-בלבד.
 * מקורות-אמת (כולם-ציבוריים, ללא-token):
 *  (א) עותק-המקור agents/agent-9 ב-Autonomy (repo ציבורי) — קומיט-אחרון + גודל-ה-worklog.
 *  (ב) מנוע-הסנכרון agent-9-vault-sync (v3) — ריצה-אחרונה ציבורית: פסק-דין VAULT_SYNCED_OK_V3
 *      או פעימה-שקטה = העדות-הציבורית-היחידה לטריות-הכספת-הפרטית ב-saos-runtime.
 * חוק-G4 (משוכפל מ-agent-zai/G8): micro-cache 5 דק + single-flight + ניקוי-inflight בסיום —
 * מטמון לעולם לא הופך לקבר-תמידי. GitHub-ציבורי = 60 בקשות/שעה — ה-TTL מחזיק אותנו בטוח.
 * התדרדרות-כנה: מקור-שנכשל → null + סיבה; אין-מדידה ≠ הצלחה. */

type Box<T> = { at: number; value: T | null; inflight?: Promise<T | null> };

const g = globalThis as unknown as {
  __insSourceBox?: Box<SourceState>;
  __insSyncBox?: Box<SyncState>;
};

const TTL_MS = 300_000;
const ORG = "roshpinacare-sys";
const REPO = "Autonomy";
const DIR = "agents/agent-9";
const WF = "agent-9-vault-sync.yml";

type SourceState = {
  sha: string | null;
  at: string | null;
  worklogBytes: number | null;
  reason?: string;
};

type SyncState = {
  runNumber: number | null;
  conclusion: string | null;
  at: string | null;
  reason?: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return (await r.json()) as T;
}

/** (א) עותק-המקור: קומיט-אחרון על agents/agent-9 + גודל-ה-worklog (raw HEAD). */
async function readSource(): Promise<SourceState> {
  try {
    const commits = await fetchJson<Array<{ sha: string; commit: { committer?: { date?: string } } }>>(
      `https://api.github.com/repos/${ORG}/${REPO}/commits?path=${DIR}&per_page=1`,
    );
    const c = commits?.[0];
    let worklogBytes: number | null = null;
    try {
      // מדידה-מדויקת: ה-API-contents מחזיר size אמיתי (HEAD-raw משקר ב-content-length — נמדד)
      const meta = await fetchJson<{ size?: number }>(
        `https://api.github.com/repos/${ORG}/${REPO}/contents/${DIR}/worklog.md`,
      );
      if (typeof meta?.size === "number") worklogBytes = meta.size;
    } catch {
      /* גודל לא נמדד — כנה */
    }
    return {
      sha: c?.sha?.slice(0, 12) ?? null,
      at: c?.commit?.committer?.date ?? null,
      worklogBytes,
    };
  } catch (e) {
    return { sha: null, at: null, worklogBytes: null, reason: String((e as Error)?.message || e).slice(0, 120) };
  }
}

/** (ב) מנוע-הסנכרון: הריצה-האחרונה של agent-9-vault-sync (ציבורי ב-Autonomy). */
async function readSync(): Promise<SyncState> {
  try {
    const d = await fetchJson<{ workflow_runs?: Array<{ run_number: number; conclusion: string | null; created_at: string }> }>(
      `https://api.github.com/repos/${ORG}/${REPO}/actions/workflows/${WF}/runs?per_page=1`,
    );
    const r = d?.workflow_runs?.[0];
    return {
      runNumber: r?.run_number ?? null,
      conclusion: r?.conclusion ?? null,
      at: r?.created_at ?? null,
    };
  } catch (e) {
    return { runNumber: null, conclusion: null, at: null, reason: String((e as Error)?.message || e).slice(0, 120) };
  }
}

function getBox<T>(key: "__insSourceBox" | "__insSyncBox"): Box<T> {
  return (g[key] ??= { at: 0, value: null }) as Box<T>;
}

async function cachedRead<T>(box: Box<T | null>, fn: () => Promise<T>): Promise<T | null> {
  const now = Date.now();
  if (box.value && now - box.at < TTL_MS) return box.value;
  if (box.inflight) return box.inflight;
  box.inflight = (async () => {
    try {
      const v = await fn();
      box.value = v;
      box.at = Date.now();
      return v;
    } catch {
      box.value = null;
      box.at = Date.now();
      return null;
    }
  })();
  const p = box.inflight;
  try {
    return await p;
  } finally {
    if (box.inflight === p) box.inflight = undefined;
  }
}

const STALE_MS = 26 * 60 * 60 * 1000; // cron יומי 03:31/03:47 + חסד

export async function GET() {
  const [source, sync] = await Promise.all([
    cachedRead(getBox<SourceState | null>("__insSourceBox"), readSource),
    cachedRead(getBox<SyncState | null>("__insSyncBox"), readSync),
  ]);

  const anyMeasured = Boolean(source?.at || sync?.at);
  if (!anyMeasured) {
    return NextResponse.json(
      { ok: false, reason: "no-signal from any public source (GitHub unreachable or rate-limited)", source, sync, measuredAt: new Date().toISOString() },
      { status: 404 },
    );
  }

  // סיווג-טריות: רק-מדידות. פסק-דין על-בסיס-הריצה-הציבורית-המוצלחת-האחרונה.
  const syncOk = sync?.conclusion === "success" && sync?.at ? Date.now() - Date.parse(sync.at) < STALE_MS : false;
  const sourceAge = source?.at ? Date.now() - Date.parse(source.at) : null;
  const verdict = syncOk ? "FRESH" : sourceAge != null && sourceAge < STALE_MS ? "SOURCE-FRESH-SYNC-UNKNOWN" : "STALE";

  return NextResponse.json({
    ok: true,
    verdict,
    source,
    sync,
    law: "4-copy insurance: Autonomy(public) · saos-runtime vault(private, synced daily) · steem archive tag · sandbox cache",
    measuredAt: new Date().toISOString(),
  });
}
