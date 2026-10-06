// scripts/charter-events-restore.ts — R92: שחזור יומן האירועים מהיסטוריית-הקנון.
//
// לקח איפוס-הסנדבוקס: אירועי הצ'רטרים חיו רק ב-DB הארעי — המרשם
// שרד (קנון), הסרט אבד. הסקריפט משחזר את מה שניתן לאימות מהקנון
// עצמו, בלי להמציא כלום:
//   · CHARTER  — מהמרשם (charterAt + הפניות האימות המקוריות)
//   · STATUS   — מהמרשם בכל קומיט-קנון (מופע ראשון של מצב חדש)
//   · ARTIFACT — מכותרות המסמכים שבקנון (חותמת-זמן מדויקת)
// מה שלא ניתן לאימות — מתועד כפער בכנות (לא משוחזר).
//
// שימוש: bun run scripts/charter-events-restore.ts
// אחריו: GET /api/charter/projects — הריפוי מייבא ומתקן הפניות (RESTORE).
import {
  CHARTER,
  readPat,
  readCanonRegistry,
  readCanonText,
  appendCanonEvents,
  canonEventId,
  type CanonEvent,
} from "../src/lib/charter";

const REPO = CHARTER.canonRepo;

function log(msg: string) {
  console.log(msg);
}

async function ghJson(path: string): Promise<unknown> {
  const pat = readPat();
  if (!pat) throw new Error("אין PAT בסנדבוקס — ארכיאולוגיית-קנון בלתי-אפשרית");
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

/** המרשם כפי שהיה בקומיט מסוים (ref = sha) — null אם לא היה אז. */
async function registryAt(ref: string): Promise<{
  publishedAt: string;
  projects: Array<{ slug: string; status: string; attSeq?: number; attEntryHash?: string }>;
} | null> {
  const pat = readPat();
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${CHARTER.registryPath}?ref=${ref}`,
      { headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30_000) },
    );
    if (!r.ok) return null;
    const wrapped = (await r.json()) as { content?: string; encoding?: string };
    if (typeof wrapped.content !== "string" || wrapped.encoding !== "base64") return null;
    return JSON.parse(Buffer.from(wrapped.content, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function main() {
  log("── R92: שחזור יומן אירועי הצ'רטרים מהיסטוריית-הקנון ──");

  // ── 1. המרשם הנוכחי — רשימת הפרויקטים של האמת ──
  const reg = (await readCanonRegistry()) as {
    publishedAt: string;
    projects: Array<{
      slug: string; name: string; status: string; charterAt: string;
      attSeq?: number; attEntryHash?: string; artifacts?: number; builderName?: string;
    }>;
  } | null;
  if (!reg?.projects?.length) {
    log("אין מרשם בקנון — אין מה לשחזר.");
    return;
  }
  log(`מרשם חי: ${reg.projects.length} פרויקטים (פורסם ${reg.publishedAt})`);

  // ── 2. כל הקומיטים שנגעו ב-charter/ — מהישן לחדש ──
  const commits: Array<{ sha: string; date: string; message: string }> = [];
  for (let page = 1; page <= 5; page++) {
    const batch = (await ghJson(
      `/repos/${REPO}/commits?path=charter&per_page=100&page=${page}`,
    )) as Array<{ sha: string; commit: { author: { date: string }; message: string } }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const c of batch) {
      commits.push({
        sha: c.sha,
        date: c.commit.author.date,
        message: c.commit.message,
      });
    }
    if (batch.length < 100) break;
  }
  commits.reverse(); // מהישן לחדש
  log(`היסטוריית-קנון: ${commits.length} קומיטים ל-charter/ (מ-${commits[0]?.date.slice(0, 16)} עד ${commits[commits.length - 1]?.date.slice(0, 16)})`);

  const events: CanonEvent[] = [];
  const discrepancies: string[] = [];

  // ── 3. ציר-הזמן: המרשם בכל קומיט — מופע ראשון של מצב חדש = אירוע ──
  const statusSeen: Record<string, string> = {};
  for (const c of commits) {
    const r = await registryAt(c.sha);
    if (!r?.projects) continue;
    for (const p of r.projects) {
      const prev = statusSeen[p.slug];
      if (prev === undefined) {
        // הופעה ראשונה — מצב ההתחלה, לא אירוע-מעבר
        statusSeen[p.slug] = p.status;
        continue;
      }
      if (prev !== p.status) {
        statusSeen[p.slug] = p.status;
        const at = r.publishedAt ?? c.date;
        const detailJson = `${prev}-${p.status}-${at}`;
        events.push({
          id: canonEventId(p.slug, "STATUS", at, detailJson),
          at,
          slug: p.slug,
          kind: "STATUS",
          detail: { from: prev, to: p.status, attSeq: p.attSeq ?? null },
          restored: true,
          restoredFrom: `registry@${c.sha.slice(0, 8)}`,
        });
        log(`  STATUS ${p.slug}: ${prev}→${p.status} @ ${at.slice(11, 19)}Z (מרשם בקומיט ${c.sha.slice(0, 8)})`);
      }
    }
  }

  // ── 4. CHARTER מהמרשם + ARTIFACT מכותרות המסמכים ──
  for (const p of reg.projects) {
    const charterDetail = {
      attSeq: p.attSeq ?? null,
      attEntryHash: p.attEntryHash ?? null,
      builder: p.builderName ?? null,
      note: "ההפניות המקוריות כפי שנרשמו במרשם בזמן אמת",
    };
    events.push({
      id: canonEventId(p.slug, "CHARTER", p.charterAt, JSON.stringify(charterDetail)),
      at: p.charterAt,
      slug: p.slug,
      kind: "CHARTER",
      detail: charterDetail,
      restored: true,
      restoredFrom: "registry",
    });
    log(`  CHARTER ${p.slug}: ${p.charterAt.slice(11, 19)}Z (charterAt מהמרשם)`);

    // המסמכים שקיימים בקנון עכשיו — כותרתם נושאת חותמת-זמן מדויקת
    const listing = (await ghJson(
      `/repos/${REPO}/contents/${CHARTER.projectDir}/${p.slug}?ref=main`,
    )) as Array<{ name: string; type: string; size?: number }>;
    let verifiable = 0;
    for (const f of listing ?? []) {
      if (f.type !== "file" || f.name === "README.md") continue;
      const text = await readCanonText(`${CHARTER.projectDir}/${p.slug}/${f.name}`);
      const m = text?.match(/<!-- artifact: ([^·]+) · by ([^·]+) · ([0-9TZ:.-]+) -->/);
      if (!m) {
        discrepancies.push(`${p.slug}/${f.name}: כותרת שבורה — לא שוחזר`);
        continue;
      }
      const at = m[3].trim();
      const detail = {
        filename: f.name,
        canonPath: `${CHARTER.projectDir}/${p.slug}/${f.name}`,
        by: m[2].trim(),
        ...(typeof f.size === "number" ? { bytes: f.size } : {}),
        restored: true,
      };
      events.push({
        id: canonEventId(p.slug, "ARTIFACT", at, detail.canonPath),
        at,
        slug: p.slug,
        kind: "ARTIFACT",
        detail,
        restored: true,
        restoredFrom: `canon:${detail.canonPath}`,
      });
      verifiable++;
      log(`  ARTIFACT ${p.slug}: ${f.name} @ ${at.slice(11, 19)}Z (כותרת הקובץ)`);
    }
    const counted = p.artifacts ?? 0;
    if (counted !== verifiable) {
      discrepancies.push(
        `${p.slug}: המרשם מנה ${counted} אירועי-פרסום; בקנון ניתנים לאימות ${verifiable} בלבד` +
          (counted > verifiable ? " — היתר פורסמו כשהקנון לא היה זמין ולא הותירו עקבות" : ""),
      );
    }
  }

  // ── 5. פרסום היומן המשוחזר לקנון ──
  log(`\nסה"כ אירועים לשחזור: ${events.length} (CHARTER ${events.filter((e) => e.kind === "CHARTER").length} · STATUS ${events.filter((e) => e.kind === "STATUS").length} · ARTIFACT ${events.filter((e) => e.kind === "ARTIFACT").length})`);
  if (discrepancies.length > 0) {
    log("\nפערים מתועדים בכנות (לא שוחזרו — אין ראיה):");
    for (const d of discrepancies) log(`  ⚠ ${d}`);
  }
  const res = await appendCanonEvents(events);
  if (res.ok) {
    log(`\nיומן האירועים פורסם לקנון: charter/events.jsonl ✓`);
    log(`הצעד הבא: GET /api/charter/projects — הריפוי מייבא ומתקן הפניות תלויות בעדות RESTORE חתומה.`);
  } else {
    log(`\nפרסום היומן נכשל: ${res.error}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String((e as Error)?.message ?? e));
  process.exitCode = 1;
});
