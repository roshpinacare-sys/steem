// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Charter Anchor — העוגן החיצוני לצ'רטרים (R91)
//
// הבטחת R89 השלמה: פרויקטים של סוכנים חיצוניים לא חיים רק בסנדבוקס
// ובקנון — הם מעוגנים על שרשרת ציבורית אמיתית (Steem), כך שאף
// אחד — גם לא אנחנו — יכול לשכתב את ההיסטוריה בשקט.
//
// סולם ההוכחות (הדפוס המוכח של הרשת):
//   1. מדידה — שורש Merkle (keccak256) על מצב הצ'רטרים החי (DB).
//   2. שידור — custom_json בסמכות posting בלבד (אפס סיכון הון),
//      המפתח נגזר בזיכרון-ההרצה ומאומת ביט-מול-ביט מול הרשות החיה.
//   3. ההיסטוריה שופטת — ה-tx נחשב מאושר רק כשנקרא חזרה מהשרשרת
//      (לקח R87: callback שמתעכב אינו כישלון; שידור שנעלם אינו הצלחה).
//   4. עדות — ANCHOR חתום EIP-191 בספר hash-chained + checkpoint מכסה.
//   5. קנון — יומן העוגנים מתפרסם אחרי שער-הסודות (charter/anchors.json).
//
// חוקי-ברזל:
//   · דה-דופליקציה לפי שורש — אותו root = דילוג-כנה בלי שידור.
//   · מפתח posting בלבד; לעולם לא active; לעולם לא בלוג, לעולם לא בתשובה.
//   · אין מפתח-אב בסנדבוקס ⇒ סירוב-כנה (409) — לא "נניח שהצלחנו".
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from "module";
import path from "path";
// r137 · D-026: קריאת-קבצים עברה לספריית owner-key — fs הוסר מכאן
import { keccak256, toUtf8Bytes } from "ethers";
import { db } from "@/lib/db";
import { merkleRoot } from "./merkle";
import { ensureDaemonAgent } from "./daemons";
import { appendAttestation } from "./ledger";
import { rpcV4, STEEM_RPC_NODES } from "./graphene";
import { readOwnerSource, steemSigningWif } from "@/lib/owner-key"; // r137 · D-026: מקור-מפתח דו-מצבי

// ── קבועים ───────────────────────────────────────────────────────────

export const CHARTER_ANCHOR_OP_ID = "saos.weave.charter.v1";
export const CHARTER_ANCHOR_ACCOUNT = "headcorner";
const HOME = "/home/z/my-project";
// r137 · D-026: קריאת המפתח עברה לספריית owner-key המשותפת (OWNER_FILE שם)
const WITNESS_NAME = "weave-charter-anchor";

/** תקציבים — נאכפים בקוד, לא בתקווה */
export const ANCHOR_POLICY = {
  minIntervalMs: 15 * 60 * 1000, // 15 דק' בין שידורים
  maxPerDay: 8,
  // היסטוריה: דפדוף בעמודי 100 (מגבלת API) — ראה scanHistory
} as const;

// ── 1. המדידה — שורש המצב ────────────────────────────────────────────

export interface CharterStateRoot {
  root: string;
  projects: number;
  events: number;
  leaves: Array<{ slug: string; leaf: string; events: number }>;
}

/**
 * שורש Merkle על מצב הצ'רטרים החי — דטרמיניסטי לחלוטין:
 * אותו DB ⇒ אותו שורש, בכל מכונה, בכל שעה.
 * (שדות קנוניים בלבד — מה ששורד איפוס-סנדבוקס דרך הריפוי מהמרשם.)
 */
export async function charterStateRoot(): Promise<CharterStateRoot> {
  const projects = await db.charterProject.findMany({
    orderBy: { slug: "asc" },
    include: {
      builder: { select: { ethAddress: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  const leaves = projects.map((p) => {
    const eventHashes = p.events.map((e) =>
      keccak256(
        toUtf8Bytes(
          JSON.stringify({
            kind: e.kind,
            detail: e.detail,
            createdAt: e.createdAt.getTime(),
          }),
        ),
      ),
    );
    const leaf = keccak256(
      toUtf8Bytes(
        JSON.stringify({
          slug: p.slug,
          name: p.name,
          status: p.status,
          builder: p.builder.ethAddress,
          attSeq: p.attSeq,
          attEntryHash: p.attEntryHash,
          artifactsCount: p.artifactsCount,
          createdAt: p.createdAt.getTime(),
          events: eventHashes,
        }),
      ),
    );
    return { slug: p.slug, leaf, events: p.events.length };
  });
  if (leaves.length === 0) {
    throw new CharterAnchorError("אין פרויקטים במרשם — אין מה לעגן (fail-closed כנה)", 409);
  }
  return {
    root: merkleRoot(leaves.map((l) => l.leaf)),
    projects: projects.length,
    events: leaves.reduce((s, l) => s + l.events, 0),
    leaves,
  };
}

// ── 2. השידור — posting בלבד, מאומת מול הרשות החיה ─────────────────────

export class CharterAnchorError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function readOwnerKey(): { account: string; password: string; wif?: string } | null {
  // r137 · D-026: מקור-המפתח הדו-מצבי — מצב-אב או מצב-wif (הדלת).
  const src = readOwnerSource();
  if (!src) return null;
  if (src.mode === "master" && src.master) return { account: src.account, password: src.master };
  if (src.mode === "wif" && src.activeWif) return { account: src.account, password: "", wif: src.activeWif };
  return null;
}

interface ChainAnchor {
  txid: string;
  block: number | null;
  root: string;
  at: string;
}

/** סריקת ההיסטוריה — האמת היחידה על מה שבאמת נחת על השרשרת.
 *  לקח חי (R91, נמדד): api.steemit.com מגביל get_account_history
 *  ל-100 פעולות בקריאה — מגבלה גבוהה מחזירה שגיאה בכל צומת.
 *  לכן: דפדוף אחורה בעמודי 100 (הדפוס המוכח של saoslite). */
const HISTORY_PAGE = 100;
const HISTORY_PAGES = 5; // 500 פעולות אחרונות — מכסה שעות של פעילות צי

async function scanHistory(root?: string, nonce?: string): Promise<ChainAnchor | null> {
  for (const node of STEEM_RPC_NODES) {
    try {
      let found: ChainAnchor | null = null;
      let start = -1;
      for (let page = 0; page < HISTORY_PAGES; page++) {
        const hist = await rpcV4<
          Array<[number, { trx_id: string; block: number; timestamp?: string; op?: [string, Record<string, unknown>] }]>
        >(node, "condenser_api.get_account_history", [CHARTER_ANCHOR_ACCOUNT, start, HISTORY_PAGE]);
        if (!Array.isArray(hist) || hist.length === 0) break;
        let oldest = Infinity;
        for (const [idx, entry] of hist) {
          if (typeof idx === "number") oldest = Math.min(oldest, idx);
          const op = entry?.op;
          if (!op || op[0] !== "custom_json") continue;
          const body = op[1] as { id?: string; json?: string; required_posting_auths?: string[] } | undefined;
          if (!body || body.id !== CHARTER_ANCHOR_OP_ID) continue;
          if (!Array.isArray(body.required_posting_auths) || !body.required_posting_auths.includes(CHARTER_ANCHOR_ACCOUNT)) continue;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(String(body.json || "{}"));
          } catch {
            continue;
          }
          const cRoot = String(payload.root ?? "");
          if (!cRoot) continue;
          // R91 (לקח אבחון-חי): רק העד הקנוני נחשב לעוגן-הרשומה —
          // פעולות אבחון/זרות (witness אחר) נשארות על השרשרת אך לא
          // מזייפות "אומת מהשרשרת" ולא חוסמות אותו.
          if (!nonce && String(payload.witness ?? "") !== WITNESS_NAME) continue;
          // מיקוד: root+nonce (אימות שידור ספציפי) או העוגן האחרון בכללי
          if (nonce && String(payload.nonce ?? "") !== nonce) continue;
          if (!nonce && root && cRoot !== root) continue;
          found = {
            txid: String(entry.trx_id || ""),
            block: typeof entry.block === "number" ? entry.block : null,
            root: cRoot,
            at: String(entry.timestamp ? entry.timestamp + "Z" : payload.at ?? ""),
          };
        }
        if (found) break;
        if (oldest === Infinity || oldest <= 1) break;
        start = Math.max(1, oldest - 1);
      }
      if (found) return found;
      return null; // צומת תקין ענה — לא נפוצץ לצומת הבא על "לא נמצא"
    } catch {
      /* הצומת הבא */
    }
  }
  return null;
}

/** קריאה ציבורית ל-GET: העוגן האחרון שנחת באמת על השרשרת */
export async function lastOnChainAnchor(): Promise<ChainAnchor | null> {
  return scanHistory();
}

// ── 3. המנוע המלא — מדידה ⇒ שידור ⇒ אימות ⇒ עדות ⇒ קנון ───────────────

export type AnchorStatus = "ATTESTED" | "SKIPPED" | "REFUSED";

export interface AnchorResult {
  status: AnchorStatus;
  reason: string;
  root: string;
  projects: number;
  events: number;
  attSeq: number | null;
  txid: string | null;
  block: number | null;
  confirmedBy: string | null;
}

/** העד — DAEMON נגזר ממפתח הרשת (אותה כתובת בכל סביבה, self-heal) */
export async function ensureCharterWitness(): Promise<{ id: string; name: string; ethAddress: string }> {
  return ensureDaemonAgent(WITNESS_NAME, "DAEMON");
}

/** פער מאז העיגון האחרון — כמה חדש נבנה ולא כוסה */
export async function charterDrift(): Promise<{ newProjects: number; newEvents: number; anchoredAt: Date | null }> {
  const witness = await db.agent.findUnique({ where: { name: WITNESS_NAME } });
  let anchoredAt: Date | null = null;
  if (witness) {
    const last = await db.attestation.findFirst({
      where: { claimType: "ANCHOR", agentId: witness.id, evidence: { contains: `op=${CHARTER_ANCHOR_OP_ID}` } },
      orderBy: { seq: "desc" },
    });
    anchoredAt = last?.createdAt ?? null;
  }
  const scope = anchoredAt ? { createdAt: { gt: anchoredAt } } : {};
  const [newProjects, newEvents] = await Promise.all([
    db.charterProject.count({ where: scope }),
    db.charterEvent.count({ where: scope }),
  ]);
  return { newProjects, newEvents, anchoredAt };
}

export async function anchorCharterOnSteem(opts?: { dryRun?: boolean }): Promise<AnchorResult> {
  // ── המדידה קודם לכול ──
  const state = await charterStateRoot();
  const witness = await ensureCharterWitness();

  // ── דה-דופליקציה לפי שורש — אותו מצב = אותה עדות, בלי שידור ──
  const needle = `root=${state.root}`;
  const lastAnchor = await db.attestation.findFirst({
    where: { claimType: "ANCHOR", agentId: witness.id, evidence: { contains: `op=${CHARTER_ANCHOR_OP_ID}` } },
    orderBy: { seq: "desc" },
  });
  if (lastAnchor && lastAnchor.evidence.includes(needle)) {
    return {
      status: "SKIPPED",
      reason: `שורש זה כבר מעוגן (att ${lastAnchor.seq}) — המצב לא השתנה מאז; דילוג כנה בלי שידור`,
      root: state.root,
      projects: state.projects,
      events: state.events,
      attSeq: lastAnchor.seq,
      txid: null,
      block: null,
      confirmedBy: null,
    };
  }

  // ── צינון + תקציב יומי (נספרים מהספר — האמת במדידה) ──
  if (lastAnchor) {
    const ageMs = Date.now() - lastAnchor.createdAt.getTime();
    if (ageMs < ANCHOR_POLICY.minIntervalMs) {
      const leftMin = Math.ceil((ANCHOR_POLICY.minIntervalMs - ageMs) / 60_000);
      throw new CharterAnchorError(
        `צינון — העיגון האחרון היה לפני ${Math.floor(ageMs / 60_000)} דק׳; הבא בעוד ~${leftMin} דק׳`,
        429,
      );
    }
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayCount = await db.attestation.count({
    where: {
      claimType: "ANCHOR",
      agentId: witness.id,
      createdAt: { gte: dayStart },
      evidence: { contains: `op=${CHARTER_ANCHOR_OP_ID}` },
    },
  });
  if (todayCount >= ANCHOR_POLICY.maxPerDay) {
    throw new CharterAnchorError(
      `תקציב יומי מוצה — ${todayCount}/${ANCHOR_POLICY.maxPerDay} עיגונים היום-UTC`,
      429,
    );
  }

  if (opts?.dryRun) {
    return {
      status: "REFUSED",
      reason: `dry-run — היה משודר: שורש …${state.root.slice(-8)} על ${state.projects} פרויקטים · ${state.events} אירועים`,
      root: state.root,
      projects: state.projects,
      events: state.events,
      attSeq: null,
      txid: null,
      block: null,
      confirmedBy: null,
    };
  }

  // ── המפתח: בזיכרון-ההרצה בלבד ──
  const ownerKey = readOwnerKey();
  if (!ownerKey || ownerKey.account !== CHARTER_ANCHOR_ACCOUNT) {
    throw new CharterAnchorError(
      "מפתח-האב אינו בסנדבוקס — העיגון חסום בכנות. העלה את הסיסמה (upload) או הפעל מהענן.",
      409,
    );
  }

  // steem-js מנתיב אבסולוטי — הדפוס המוכח (publish/money)
  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  const steem: any = nodeRequire("steem");
  steem.api.setOptions({ url: "https://api.steemit.com" });

  // דוקטרינת R75: המפתח מכריז את החותם — אימות ביט-מול-ביט לפני שידור
  // r137 · D-026: מצב-אב גוזר posting ישירות; מצב-wif פותח את רשומת-
  // ה-posting מהכספת תחת WIF-השליטה. אין-פתיחה = חסימה כנה.
  let wif: string;
  if (ownerKey.wif) {
    const viaVault = steemSigningWif("posting", ownerKey.account);
    if (!viaVault) {
      throw new CharterAnchorError("מצב-wif: אין רשומת-posting נפתחה מהכספת — העיגון נדחה בכנות.", 409);
    }
    wif = viaVault.wif;
  } else {
    wif = steem.auth.toWif(ownerKey.account, ownerKey.password, "posting");
  }
  const accounts: any[] = await new Promise<any[]>((resolve, reject) =>
    steem.api.getAccounts([ownerKey.account], (err: Error | null, res: any[]) =>
      err || !res?.length ? reject(err ?? new Error("empty")) : resolve(res),
    ),
  );
  const livePosting = accounts?.[0]?.posting?.key_auths?.[0]?.[0];
  if (!livePosting || steem.auth.wifToPublic(wif) !== livePosting) {
    throw new CharterAnchorError(
      "המפתח שנגזר אינו תואם את רשות-ה-posting החיה — שום דבר לא שודר. סירוב-כנה.",
      409,
    );
  }

  // ── דה-דופ מול השרשרת עצמה: אם השורש הנוכחי כבר נחת — לא משדרים שוב.
  //    (נולד מתקרית חיה R91: אימות שפג חלון השהיה הותיר עיגון-יתום על
  //    השרשרת; הריצה הבאה מזהה אותו ומעידה עליו בלי שידור נוסף.)
  let onChain = await scanHistory(state.root);
  if (onChain) {
    const att = await appendCharterAnchorAttestation(witness, state, onChain, "chain-read (existing)");
    return {
      status: "ATTESTED",
      reason: `השורש כבר היה על השרשרת (txid ${onChain.txid.slice(0, 12)}…) — הוגשה עדות עליו בלי שידור נוסף`,
      root: state.root,
      projects: state.projects,
      events: state.events,
      attSeq: att,
      txid: onChain.txid,
      block: onChain.block,
      confirmedBy: "chain-read (existing)",
    };
  }

  // ── השידור — custom_json בסמכות posting, nonce לזיהוי בהיסטוריה ──
  const nonce = keccak256(toUtf8Bytes(`${state.root}:${Date.now()}`)).slice(2, 18);
  const payload = {
    v: 1,
    root: state.root,
    projects: state.projects,
    events: state.events,
    witness: WITNESS_NAME,
    nonce,
    at: new Date().toISOString(),
  };

  let broadcastErr: string | null = null;
  try {
    // לקח R98 (הוכח במעבדה + 80 מדידות ב-dev.log): מצב-ה-callback של steem-js
    // מחזיר undefined ובדחיית-הכנה ה-callback אף לא מופעל. הדפוס המוכח של
    // קו-העוגן (graphene.ts, חי on-chain): sendAsync — ההבטחה היא מקור-האמת.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      steem.broadcast.sendAsync(
        {
          extensions: [],
          operations: [[
            "custom_json",
            {
              required_auths: [],
              required_posting_auths: [CHARTER_ANCHOR_ACCOUNT],
              id: CHARTER_ANCHOR_OP_ID,
              json: JSON.stringify(payload),
            },
          ]],
        },
        [wif],
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("broadcast-timeout-45s")), 45_000);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  } catch (e) {
    // לקח R87: callback מתעכב ≠ כישלון — ההיסטוריה היא השופטת
    broadcastErr = String((e as Error)?.message ?? e).slice(0, 160);
  }

  // ── האימות — קריאה חזרה מהשרשרת ──
  //    לקח חי (R91, נמדד): אינדקס ההיסטוריה מפגר אחרי הבלוקים בעשרות
  //    שניות — לכן 8 ניסיונות × 10ש' (חלון של 80 שניות).
  onChain = null;
  for (let i = 0; i < 8 && !onChain; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 10_000));
    onChain = await scanHistory(state.root, nonce);
  }
  if (!onChain) {
    throw new CharterAnchorError(
      `השידור לא אומת מהשרשרת (ההיסטוריה לא מצאה את ה-nonce בחלון 80 השניות) — לא נכתבת עדות על עיגון בלתי-מאומת${broadcastErr ? ` · שגיאת-שידור: ${broadcastErr}` : ""}`,
      502,
    );
  }

  // ── העדות — חתומה בספר hash-chained ──
  const attSeq = await appendCharterAnchorAttestation(witness, state, onChain, "chain-read");

  return {
    status: "ATTESTED",
    reason: "העיגון נחת על Steem, אומת מההיסטוריה, נחתם בספר — וה-checkpoint יכסה מיד",
    root: state.root,
    projects: state.projects,
    events: state.events,
    attSeq,
    txid: onChain.txid,
    block: onChain.block,
    confirmedBy: "chain-read",
  };
}

/** כתיבת עדות העיגון — טענה + ראיה קנונית, משותפת לשני הנתיבים */
async function appendCharterAnchorAttestation(
  witness: { id: string },
  state: CharterStateRoot,
  onChain: ChainAnchor,
  confirmedBy: string,
): Promise<number> {
  const claim =
    `עוגן-חוץ למספנת הצ'רטרים: מצב ${state.projects} הפרויקטים ו-${state.events} האירועים ` +
    `נמדד לשורש …${state.root.slice(-8)} והועגן על Steem כ-custom_json בסמכות posting — ` +
    `כל שכתוב-שקט של המרשם ייחשף בחישוב-מחדש.`;
  const evidence = [
    `op=${CHARTER_ANCHOR_OP_ID}`,
    `chain=steem`,
    `account=${CHARTER_ANCHOR_ACCOUNT}`,
    `root=${state.root}`,
    `txid=${onChain.txid}`,
    `block=${onChain.block ?? "null"}`,
    `projects=${state.projects}`,
    `events=${state.events}`,
    `confirmedBy=${confirmedBy}`,
    `leaves=${state.leaves.map((l) => `${l.slug}:…${l.leaf.slice(-6)}`).join(",")}`,
    `measuredBy=charter-anchor (live DB → keccak256 merkle)`,
    `at=${new Date().toISOString()}`,
  ].join(" · ");

  const att = await appendAttestation({
    agentId: witness.id,
    claim,
    claimType: "ANCHOR",
    evidence,
  });
  return att.seq;
}

// ── 4. מצב לתצוגה — הכל נמדד, שום דבר לא מונח ─────────────────────────

export interface AnchorStatusView {
  root: string;
  projects: number;
  events: number;
  drift: { newProjects: number; newEvents: number; anchoredAt: string | null };
  lastAnchor: {
    attSeq: number;
    root: string;
    txid: string | null;
    block: number | null;
    at: string;
    claim: string;
  } | null;
  onChain: { txid: string; block: number | null; root: string; at: string } | null;
  verified: boolean | null; // true=שורש אחרון בספר נמצא על השרשרת · false=לא נמצא · null=אין עוגן בכלל
  keyPresent: boolean;
}

export async function anchorStatusView(): Promise<AnchorStatusView> {
  const state = await charterStateRoot();
  const [drift, onChain] = await Promise.all([charterDrift(), lastOnChainAnchor()]);

  const witness = await db.agent.findUnique({ where: { name: WITNESS_NAME } });
  let lastAnchor: AnchorStatusView["lastAnchor"] = null;
  if (witness) {
    const last = await db.attestation.findFirst({
      where: { claimType: "ANCHOR", agentId: witness.id, evidence: { contains: `op=${CHARTER_ANCHOR_OP_ID}` } },
      orderBy: { seq: "desc" },
    });
    if (last) {
      const field = (key: string): string | null => {
        const m = last.evidence.match(new RegExp(`(?:^| · )${key}=([^ ·]+)`));
        return m ? m[1] : null;
      };
      lastAnchor = {
        attSeq: last.seq,
        root: field("root") ?? "—",
        txid: field("txid"),
        block: field("block") != null ? Number(field("block")) : null,
        at: last.createdAt.toISOString(),
        claim: last.claim,
      };
    }
  }

  const verified =
    lastAnchor && onChain
      ? onChain.root === lastAnchor.root
      : lastAnchor
        ? false
        : null;

  return {
    root: state.root,
    projects: state.projects,
    events: state.events,
    drift: {
      newProjects: drift.newProjects,
      newEvents: drift.newEvents,
      anchoredAt: drift.anchoredAt?.toISOString() ?? null,
    },
    lastAnchor,
    onChain,
    verified,
    keyPresent: readOwnerKey() !== null,
  };
}
