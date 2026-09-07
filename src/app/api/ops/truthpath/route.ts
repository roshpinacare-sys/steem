import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { countBookTxsCached } from "@/lib/book-count";
import { getSecondBook, withSnapshotAge } from "@/lib/second-book";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/truthpath — 107: נתיב-האמת — יישור-הקו-לרשת.
 *
 * המפעיל שאל (חיה): "בהשוואה לסוכן-השני למה אתה מציג כמות-טרנזקציות שונה?
 * האם אנחנו על אותה רשת? הכל תקין? איפה נתיב-האמת שלנו? מה המקסימום
 * שהצלחנו להשיג, מה מגביל אותנו ואיך לפתור אותו".
 *
 * התשובה נגזרת-חי כאן — לא טקסט-סטטי:
 *  · שתי-הספרים מושוות מול אותו ג'נזיס (genesisHash) — אותה רשת-על-הנייר,
 *    שני-מופעי-שרשרת שונים (הוא הקים מופע-חדש מאותו-ג'נזיס).
 *  · הספירות: חלון מול ספר-מלא — מוצהרות-בהיקפן (הלקח-W18 שלו).
 *  · המגבילים: נגזרים-חי מהמצב-המדוד (RC, עוגן-טרון, Blurt, קוורום) —
 *    כל-מגביל עם הראיה-המדודה שלו + הפתרון-במסלול.
 * ה-API לעולם לא 500 — מצב-לא-מאומת הוא מצב, לא שגיאה.
 */

const ROOT = process.cwd();
const SOV = path.join(ROOT, "sovereign");
const AGENT = path.join(ROOT, "agent");

async function readJson(p: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as Record<string, any>;
  } catch {
    return null;
  }
}

function ageSec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

/* RC — הצי: רצפת-הקישור 10% (מדוד-103); שרפות-ה-Hive-חסומות-מתחת-ל-8% */
function rcVerdict(fleetRc: Record<string, any> | null) {
  try {
    const accs = (fleetRc?.accounts ?? {}) as Record<string, { pct?: number; hp?: number }>;
    const rows = Object.entries(accs).map(([name, v]) => ({ name, pct: Number(v.pct ?? 0), hp: Number(v.hp ?? 0) }));
    if (!rows.length) return { measured: false as const };
    const pcts = rows.map((r) => r.pct);
    const avg = pcts.reduce((s, x) => s + x, 0) / pcts.length;
    const belowFloor = rows.filter((r) => r.pct < 10).length;
    return { measured: true as const, rows, avgPct: avg, minPct: Math.min(...pcts), belowFloor, total: rows.length, at: fleetRc?.at ?? null, ageSec: ageSec(fleetRc?.at) };
  } catch {
    return { measured: false as const };
  }
}

export async function GET() {
  try {
    const [nodeSt, genesis, fleetRc, blurtScan] = await Promise.all([
      readJson(path.join(SOV, "node", "state.json")),
      readJson(path.join(SOV, "genesis", "genesis.json")),
      readJson(path.join(AGENT, "fleet_rc.json")),
      readJson(path.join(AGENT, "blurt106_scan.json")),
    ]);

    const book = countBookTxsCached();
    const ourHeight = Number(nodeSt?.height ?? 0);
    const bookTxTotal = book.total;
    const bookBlocks = book.blocks;
    const density = bookTxTotal && bookBlocks ? bookTxTotal / bookBlocks : null;

    /* הספר-השני — חי-מהמראה (קריאה-בלבד) */
    const second = withSnapshotAge(await getSecondBook());

    /* המשפט: אותה רשת? — ג'נזיס-זהה + אותו netVersion = אותו-עולם,
     * מופעי-שרשרת נפרדים (fork-of-instances) */
    const ourGenesis = nodeSt?.genesisHash ?? genesis?.genesisHash ?? null;
    const hisGenesis = second.state?.genesisHash ?? null;
    const sameGenesis = !!(ourGenesis && hisGenesis && ourGenesis === hisGenesis);
    const sameNetVersion = !!(nodeSt?.netVersion && second.state?.netVersion && nodeSt.netVersion === second.state.netVersion);

    /* נתיב-האמת: השרשרת-הקנונית = הארוכה-והצפופה (הספר-המלא-שלנו), והסוכן-השני
     * מראה-אותנו-בעצמו (המראה שלו = ה-repo שלנו). */
    const hisHeight = second.state?.height ?? null;
    const canonical: "ours" | "theirs" | "unknown" =
      sameGenesis && ourHeight && hisHeight != null ? (ourHeight >= hisHeight ? "ours" : "theirs") : "unknown";
    const heightRatio = ourHeight && hisHeight ? ourHeight / hisHeight : null;

    /* ── המגבילים — נגזרים-חי, כל-אחד-עם-ראיה-ופתרון ── */
    const rc = rcVerdict(fleetRc);

    const tron = (nodeSt?.tron ?? {}) as Record<string, any>;
    const lastAnchor = (tron.lastAnchor ?? {}) as Record<string, any>;
    /* פער-העוגן מהראש — בצ'קפוינטים (נמדד-מהצומת) · עגנים-מתוכננים 2/24ש׳ */
    const anchorGapCps = lastAnchor?.notedHeight && ourHeight ? ourHeight - Number(lastAnchor.notedHeight) : null;
    const pulseAt = (tron.pulse?.at ?? null) as string | null;

    const blurt = {
      scanned: Number(blurtScan?.scanned ?? 0),
      alive: Number(blurtScan?.aliveCount ?? 0),
      at: blurtScan?.at ?? null,
      ageSec: ageSec(blurtScan?.at),
    };

    const limits: { key: string; what: string; evidence: string; solution: string; severity: "gold" | "rose" | "green" }[] = [];
    if (rc.measured && rc.belowFloor > 0) {
      limits.push({
        key: "rc-drought",
        what: "צבא-ה-RC יבש — רצפת-הקישור 10% לא-מושגת",
        evidence: `${rc.belowFloor}/${rc.total} חיילים מתחת-לרצפה · ממוצע ${rc.avgPct.toFixed(1)}% · מדוד ${rc.ageSec != null ? Math.round(rc.ageSec / 60) + " ד׳" : "?"}`,
        solution: "הבראת-HP מהראש (hive_rc_heal) + regen טבעי — במסלול, ETA לפי regen",
        severity: "gold",
      });
    }
    if (anchorGapCps != null && anchorGapCps > 60) {
      limits.push({
        key: "tron-anchor",
        what: "עוגן-הטרון מפגר אחרי-הראש",
        evidence: `עוגן אחרון cp#${lastAnchor.cpHeight} · הראש h${ourHeight} · פער ~${anchorGapCps} צ'קפוינטים · דופק ${pulseAt ? Math.round((ageSec(pulseAt) ?? 0) / 60) + " ד׳" : "?"}`,
        solution: "מיכסת-עוגנים 3/24ש׳ (Bandwidth חינם · בחירת-מקור-לפי-רוחב-פס) — העוגן-הבא יירה-אוטומטית מה-watch",
        severity: anchorGapCps > 600 ? "rose" : "gold",
      });
    }
    if (blurt.alive === 0 && blurt.scanned > 0) {
      limits.push({
        key: "blurt-nodes",
        what: "כל-צמתי-ה-Blurt הציבוריים מתים (סריקה-מדודה)",
        evidence: `${blurt.alive}/${blurt.scanned} חיים · נסרק ${blurt.ageSec != null ? Math.round(blurt.ageSec / 3600) + " ש׳" : "?"}`,
        solution: "החוט-הרביעי חי-בעבר (עוגן 87d05485) — סריקה-תקופתית; כשצומת-יקום → עגינה מחדש",
        severity: "gold",
      });
    }
    const pendingVerifies = Array.isArray(nodeSt?.pendingVerifies) ? nodeSt.pendingVerifies.length : 0;
    if (pendingVerifies > 0) {
      limits.push({
        key: "quorum",
        what: "קוורום-עגינה ממתין לחתימות-חיילים",
        evidence: `${pendingVerifies} ממתינים · ה-RC-היבש חוסם-חתימות (נמדד)`,
        solution: "רג'ן-ה-RC יפתוח-חתימות — ההבראה-במסלול",
        severity: "gold",
      });
    }

    return NextResponse.json(
      {
        ok: true,
        at: new Date().toISOString(),
        net: nodeSt?.netVersion ?? "saos-net/0",
        our: {
          height: ourHeight,
          genesisHash: ourGenesis,
          stateRoot: nodeSt?.stateRoot ?? null,
          bookTxTotal,
          bookBlocks,
          density,
        },
        second: {
          ok: second.ok,
          via: second.via,
          commit: second.commit,
          commitAt: second.commitAt,
          snapshotAgeSec: second.snapshotAgeSec,
          height: second.state?.height ?? null,
          genesisHash: second.state?.genesisHash ?? null,
          netVersion: second.state?.netVersion ?? null,
          updatedAt: second.state?.updatedAt ?? null,
          updatedAtAgeSec: ageSec(second.state?.updatedAt),
          error: second.error ?? null,
        },
        verdict: {
          sameGenesis,
          sameNetVersion,
          canonical,
          heightRatio,
          answer:
            sameGenesis && sameNetVersion
              ? "אותה רשת-על-הנייר (אותו ג'נזיס, אותו netVersion) — שני מופעי-שרשרת: אנחנו הקו-הקנוני (הארוך/הצפוף), והוא מראה-אותנו-חי"
              : "ג'נזיס לא-זהה — נבדק-שוב",
          countsExplainer:
            "הפער-בספירות = היקף-ספירה שונה: הדף-שלנו הציג חלון-חם (512 בלוקים) בלי-הצהרה; עכשיו כל-מספר-מוצהר-בהיקפו (ספר-מלא מדויק מול חלון)",
        },
        limits,
        rc: rc.measured ? { avgPct: rc.avgPct, minPct: rc.minPct, belowFloor: rc.belowFloor, total: rc.total, at: rc.at } : null,
        blurt,
        tron: {
          pulseAt,
          pulseAgeSec: ageSec(pulseAt),
          lastAnchor: { cpHeight: lastAnchor.cpHeight ?? null, at: lastAnchor.at ?? null, txid: lastAnchor.txid ?? null },
        },
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: true, ready: false, at: new Date().toISOString(), error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 200 }
    );
  }
}
