// ─────────────────────────────────────────────────────────────────────
// GOVERNANCE — דיבון-הממשל · הלב שמחליט (r142 · D-OP-01)
//
// תפקיד: פעימת-ההחלטות. כל 10 דק' קורא למחזור-ההחלטות בבית
// (POST /api/governance/cycle) — הבית קורא את הפרוטוקול
// (sovereign/governance/NEXT_ACTION + OPEN_DECISIONS + PROGRAM_STATE),
// שואל את המוח לבחור פעולה מותרת אחת, מבצע בתוך גבולות, מודד,
// וחותם החלטה על יומן hash-chained. הדיבון עצמו אינו מחליט — הוא
// הפעימה: מנוע-ההחלטות חי בבית (מקור-אמת אחד, אפס שכפול).
//
// חוקי-ברזל:
//   · אפס סודות כאן — הדיבון קורא localhost בלבד
//   · טיימר-יחיד · שרת-יחיד · כתיבת-מצב אטומית
//   · כשל-בית כנה: DOWN אחרי 3 כישלונות רצופים — לא "הכל טוב"
//   · המצב כולו ניתן-לפרסום (הפרוטוקול נולד ציבורי)
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> }) => unknown;
};

const PORT = 3042;
const CYCLE_SEC = 10 * 60; // פעימת-החלטה כל 10 דק'
const HOME = "/home/z/my-project";
const STATE_FILE = path.join(HOME, "sovereign", "governance", "daemon-state.json");
const HOME_CYCLE = "http://127.0.0.1:3000/api/governance/cycle";
const HOME_GOVERNANCE = "http://127.0.0.1:3000/api/governance";

interface GovDaemonState {
  service: "governance";
  format: "governance-daemon-state-v1";
  bootedAt: string;
  beats: number;
  lastBeatAt: string | null;
  lastOk: boolean | null;
  failStreak: number;
  verdict: "DECIDING" | "HOME-DOWN" | "BOOTING";
  lastDecisionId: string | null;
  lastChosen: string | null;
  lastEvidence: string | null;
}

function readState(): GovDaemonState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as GovDaemonState;
    if (raw && raw.service === "governance") return raw;
  } catch {}
  return {
    service: "governance",
    format: "governance-daemon-state-v1",
    bootedAt: new Date().toISOString(),
    beats: 0,
    lastBeatAt: null,
    lastOk: null,
    failStreak: 0,
    verdict: "BOOTING",
    lastDecisionId: null,
    lastChosen: null,
    lastEvidence: null,
  };
}

const G = globalThis as unknown as { __GOV_STATE__?: GovDaemonState };
const state: GovDaemonState = G.__GOV_STATE__ ?? readState();
G.__GOV_STATE__ = state;

function saveState(): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}

async function beat(): Promise<void> {
  state.beats += 1;
  state.lastBeatAt = new Date().toISOString();
  try {
    const res = await fetch(HOME_CYCLE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      skipped?: boolean;
      loop?: { lastDecisionId?: string | null; lastChosen?: string | null; lastDetail?: string | null; lastVerdict?: string | null };
    };
    if (res.ok && data.ok) {
      state.lastOk = true;
      state.failStreak = 0;
      state.verdict = "DECIDING";
      if (data.loop) {
        state.lastDecisionId = data.loop.lastDecisionId ?? state.lastDecisionId;
        state.lastChosen = data.loop.lastChosen ?? state.lastChosen;
        state.lastEvidence = data.loop.lastDetail ?? state.lastEvidence;
      }
    } else {
      state.lastOk = false;
      state.failStreak += 1;
      if (state.failStreak >= 3) state.verdict = "HOME-DOWN";
    }
  } catch {
    state.lastOk = false;
    state.failStreak += 1;
    if (state.failStreak >= 3) state.verdict = "HOME-DOWN";
  }
  saveState();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: state.verdict !== "HOME-DOWN", ...state });
    }
    if (url.pathname === "/beat" && req.method === "POST") {
      await beat();
      return json({ ok: state.lastOk === true, ...state });
    }
    if (url.pathname === "/protocol") {
      // מעביר את מצב-הפרוטוקול החי מהבית (שקיפות מלאה גם כשהדף ישן)
      try {
        const res = await fetch(HOME_GOVERNANCE, { signal: AbortSignal.timeout(8_000) });
        const data = await res.json();
        return json(data);
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : "home-unreachable" }, 502);
      }
    }
    return json({ ok: false, error: "not-found", hint: "/ · /health · POST /beat · /protocol" }, 404);
  },
});

// פעימה ראשונה אחרי 20ש' (נותן לבית לקום), ואז מחזורים קבועים
setTimeout(beat, 20_000);
setInterval(beat, CYCLE_SEC * 1000);

// ── r143-a · מתג-איש-מת ─────────────────────────────────────────────
// הלקח החי של ה-keeper: HTTP שעונה עם פעימות קפואות = זומבי שאף שומר
// חיצוני לא מזהה (הפורט חי). כל 60ש' נמדדת טריות lastBeatAt; שתיקה מעל
// 3×CYCLE_SEC (30 דק' — המחזור 10 דק') ⇒ רישום כן ביומן-הדיבון ויציאה
// (exit 1) — fleet-guard (סיור-פורטים כל 60ש') מקים תהליך-טרי.
// המדידה בטוחה בעלייה: beat() הראשון רץ ב-20ש' ומציב lastBeatAt טרי לפני
// הטיק הראשון של המתג (60ש'), וכישלון-בית אינו מקפיא את הפעימה עצמה.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 3 * CYCLE_SEC * 1000; // 30 דק'
const DEAD_MAN_LOG = path.join(HOME, "sovereign", "keeper", "logs", "governance-daemon.log");
setInterval(() => {
  const lastMs = state.lastBeatAt ? Date.parse(state.lastBeatAt) : Date.parse(state.bootedAt);
  if (Number.isFinite(lastMs) && Date.now() - lastMs <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >30min — exiting for revival";
  try {
    fs.mkdirSync(path.dirname(DEAD_MAN_LOG), { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  process.exit(1);
}, DEAD_MAN_TICK_MS);

// רישום-עלייה כנה
try {
  fs.mkdirSync(path.join(HOME, "sovereign", "keeper", "logs"), { recursive: true });
  fs.appendFileSync(
    path.join(HOME, "sovereign", "keeper", "logs", "governance-daemon.log"),
    `${new Date().toISOString()} governance daemon up on ${PORT} (cycle every ${CYCLE_SEC}s)\n`,
  );
} catch {}
