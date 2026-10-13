/**
 * publish.mjs — T-26 · THE PUBLISHER (הקול-לרשת) — closes the T-22 loop.
 *
 * MEASURED-LIVE GAP KILLED HERE: content.mjs queues sanitized drafts in
 * state/content-ops.json, the recruiter credits "content-strategist" for
 * them — and NOTHING in the codebase ever broadcast one. The pipeline ended
 * at "drafted" for hours while the operator's order said "לדון בזה גם
 * ברשת". This module is the missing half: one sanitized draft per UTC day
 * reaches the chain as a real post from the doctrine account.
 *
 * LAWS (vector-locked in lib.publishPlan):
 *  - 1 content post/day (the promo transparency report is a separate, older rail)
 *  - dedup on the CHAIN (get_content), never on state — state can lie, the chain can't
 *  - posting-key authority only (comment op can never move funds)
 *  - post-broadcast chain verification: the post exists on-chain with our tx
 *  - drafts keep their exposure law (enforced at sanitize time in content.mjs)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount } from "./signer.mjs";
import { publishPlan, countPostsFromHistory, opTypeName } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const CONTENT_FILE = path.join(STATE, "content-ops.json");
const FILE = path.join(STATE, "publish.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

const dayOf = (iso) => String(iso ?? new Date().toISOString()).slice(0, 10);

export function publishState() { return readJson(FILE, null); }

/** the recruiter's evidence: a real published post within the last 26h */
export function publishEvidence(nowMs = Date.now()) {
  const p = readJson(FILE, null);
  if (!p || !p.lastPublishedAt) return null;
  const age = nowMs - Date.parse(p.lastPublishedAt);
  if (!Number.isFinite(age) || age > 26 * 3600_000) return null;
  return `state/publish.json: "${(p.lastTitle ?? "").slice(0, 60)}" LIVE on-chain (permlink ${p.lastPermlink ?? "?"}, txid ${(p.lastTxid ?? "").slice(0, 12)}…) — the voice is real, 1/day doctrine-capped`;
}

export async function runPublish({ now = new Date().toISOString(), credOk = true, paused = false, force = false } = {}) {
  const master = masterAccount();
  const prev = readJson(FILE, { day: null, publishedToday: 0 });
  const day = dayOf(now);
  const sameDay = prev.day === day;
  const publishedToday = sameDay ? (Number(prev.publishedToday) || 0) : 0;

  const content = readJson(CONTENT_FILE, null);
  const queue = Array.isArray(content?.queue) ? content.queue : [];

  /* T-29 · ACCOUNT-LEVEL PUBLISH TRUTH (measured live: the state law said
   * "1/day" while the CHAIN held 9 posts today — multiple lanes, each lawful
   * alone; the network saw SAOS spam and paid 0.004 SBD for all of it). Our
   * publisher measures the ACCOUNT, not itself: ≥ 4 posts today from any
   * lane ⇒ we stand down. One body, one voice, counted on-chain. */
  let chainPostsToday = null;
  try {
    /* window law (measured): hyper churns ~400 ops in ~2h — a 400-op read
     * misses this morning's posts by noon. 2000 ops ≈ most of a day at the
     * measured churn; the gate runs at most 1/day, the weight is honest. */
    let r = await rpcCall("account_history_api.get_account_history", { account: master, start: -1, limit: 2000, select_ops: ["comment"] }).catch(() => ({ ok: false }));
    if (r.ok) {
      const rows = (r.result?.history ?? []).filter(([, e]) => opTypeName(e?.op) === "comment");
      chainPostsToday = countPostsFromHistory(rows, day);
    } else {
      r = await rpcCall("condenser_api.get_account_history", [master, -1, 1000]).catch(() => ({ ok: false }));
      if (r.ok) chainPostsToday = countPostsFromHistory(r.result ?? [], day);
    }
  } catch { chainPostsToday = null; } /* read failed → the state cap below still owns */
  const ACCOUNT_POST_CAP = 4;
  if (Number.isFinite(chainPostsToday) && chainPostsToday >= ACCOUNT_POST_CAP) {
    const doc = {
      day, at: now, verdict: "ACCOUNT-CAP", reason: `לחשבון כבר ${chainPostsToday} פוסטים היום (אמת-שרשרת, כל-הפסים) — מכסת-החשבון (${ACCOUNT_POST_CAP}) מלאה; המפרסם שלנו נסוג`,
      publishedToday, cap: 1, chainPostsToday, accountCap: ACCOUNT_POST_CAP,
      queueDepthDrafted: queue.filter((d) => d?.status === "drafted").length,
      queueDepthPublished: queue.filter((d) => d?.status === "published").length,
      lastPermlink: prev.lastPermlink ?? null, lastTxid: prev.lastTxid ?? null, lastTitle: prev.lastTitle ?? null, lastPublishedAt: prev.lastPublishedAt ?? null,
      laws: [
        "מכסה-חשבון ברמת-השרשרת: ≥4 פוסטים/יום מכל-הפסים ⇒ המפרסם-שלנו נסוג (נמדד חי: 9 פוסטים ביום אחד)",
        "1 פרסום-תוכן/יום — לצד דוח-השקיפות היומי, לא במקומו",
        "dedup על-השרשרת: get_content הוא מקור-האמת, לא ה-state",
        "מפתח-פרסום בלבד — comment op לעולם לא מזיז כספים",
        "post-verify: הפוסט חייב להימצא על-השרשרת אחרי-השידור",
        "טוהר-החשיפה נאכף ב-sanitize לפני-התור (content.mjs)",
      ],
    };
    writeJson(FILE, doc);
    return doc;
  }

  const plan = publishPlan({ queue, publishedToday, maxPerDay: 1, credOk, paused });

  /* verdicts that end before any chain IO */
  if (plan.verdict !== "PUBLISH-READY") {
    const doc = {
      day, at: now, verdict: plan.verdict, reason: plan.reason,
      publishedToday, cap: 1,
      queueDepthDrafted: queue.filter((d) => d?.status === "drafted").length,
      queueDepthPublished: queue.filter((d) => d?.status === "published").length,
      lastPermlink: prev.lastPermlink ?? null,
      lastTxid: prev.lastTxid ?? null,
      lastTitle: prev.lastTitle ?? null,
      lastPublishedAt: prev.lastPublishedAt ?? null,
      laws: [
        "1 פרסום-תוכן/יום — לצד דוח-השקיפות היומי, לא במקומו",
        "dedup על-השרשרת: get_content הוא מקור-האמת, לא ה-state",
        "מפתח-פרסום בלבד — comment op לעולם לא מזיז כספים",
        "post-verify: הפוסט חייב להימצא על-השרשרת אחרי-השידור",
        "טוהר-החשיפה נאכף ב-sanitize לפני-התור (content.mjs)",
      ],
    };
    writeJson(FILE, doc);
    return { ...doc, txid: null };
  }

  const draft = plan.draft;
  const permlink = plan.permlink;

  /* on-chain dedup — the chain is the truth, not our state */
  const exists = await rpcCall("condenser_api.get_content", [master, permlink]);
  if (exists.ok && exists.result && exists.result.author) {
    /* already live (e.g. a retry after a lost response): mark the draft
     * published without re-broadcasting — the chain already holds the post */
    markDraftPublished(CONTENT_FILE, draft.id, now, { permlink, txid: prev.lastTxid ?? null, verified: true });
    const doc = {
      day, at: now, verdict: "ALREADY-PUBLISHED", reason: "הפוסט כבר חי על-השרשרת (dedup על-השרשרת) — אין שידור-כפול",
      publishedToday: publishedToday || 1, cap: 1, permlink,
      lastPermlink: permlink, lastTxid: prev.lastTxid ?? null, lastTitle: draft.title, lastPublishedAt: now,
      queueDepthDrafted: queue.filter((d) => d?.status === "drafted").length - 1,
      queueDepthPublished: queue.filter((d) => d?.status === "published").length + 1,
    };
    writeJson(FILE, doc);
    return { ...doc, txid: doc.lastTxid };
  }

  const ops = plan.ops.map(([name, v]) => [name, { ...v, author: master }]);
  const res = await executeAs(master, ops, { tag: "publish-daily", role: "posting" });

  let postVerify = null;
  if (res.ok) {
    const check = await rpcCall("condenser_api.get_content", [master, permlink]);
    postVerify = check.ok && check.result && check.result.author === master
      ? { verified: true, created: check.result.created ?? null, url: check.result.url ?? null }
      : { verified: false };
  }
  const url = postVerify?.verified ? `https://steemit.com${postVerify.url ?? `/@${master}/${permlink}`}` : null;

  if (res.ok) {
    markDraftPublished(CONTENT_FILE, draft.id, now, { permlink, txid: res.txid, verified: !!postVerify?.verified });
  }

  const doc = {
    day, at: now,
    verdict: res.ok ? (postVerify?.verified ? "PUBLISHED" : "BROADCAST-UNVERIFIED") : `PUBLISH-FAIL`,
    reason: res.ok
      ? (postVerify?.verified ? "הפוסט חי על-השרשרת — נמצא ב-post-verify" : "השידור עבר אך ה-post-verify עדיין לא מצא את הפוסט (חלון-אינדוקס) — ה-txid הוא האמת")
      : `שידור-הפרסום נכשל: ${res.error ?? res.verdict ?? "?"}`,
    publishedToday: res.ok ? publishedToday + 1 : publishedToday,
    cap: 1,
    chainPostsToday,
    accountCap: ACCOUNT_POST_CAP,
    permlink: res.ok ? permlink : (prev.lastPermlink ?? null),
    lastPermlink: res.ok ? permlink : (prev.lastPermlink ?? null),
    lastTxid: res.ok ? res.txid : (prev.lastTxid ?? null),
    lastTitle: res.ok ? draft.title : (prev.lastTitle ?? null),
    lastPublishedAt: res.ok ? now : (prev.lastPublishedAt ?? null),
    lastUrl: res.ok ? url : (prev.lastUrl ?? null),
    postVerify,
    txid: res.ok ? res.txid : null,
    queueDepthDrafted: queue.filter((d) => d?.status === "drafted").length - (res.ok ? 1 : 0),
    queueDepthPublished: queue.filter((d) => d?.status === "published").length + (res.ok ? 1 : 0),
    laws: [
      "1 פרסום-תוכן/יום — לצד דוח-השקיפות היומי, לא במקומו",
      "dedup על-השרשרת: get_content הוא מקור-האמת, לא ה-state",
      "מפתח-פרסום בלבד — comment op לעולם לא מזיז כספים",
      "post-verify: הפוסט חייב להימצא על-השרשרת אחרי-השידור",
      "טוהר-החשיפה נאכף ב-sanitize לפני-התור (content.mjs)",
    ],
  };
  writeJson(FILE, doc);
  return doc;
}

/** flip one draft's status inside content-ops.json (atomic, no rewrite of others) */
function markDraftPublished(file, id, at, { permlink, txid, verified }) {
  const c = readJson(file, null);
  if (!c || !Array.isArray(c.queue)) return;
  const d = c.queue.find((x) => x && x.id === id);
  if (!d) return;
  d.status = "published";
  d.publishedAt = at;
  d.permlink = permlink ?? null;
  d.txid = txid ?? null;
  d.chainVerified = verified === true;
  writeJson(file, c);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPublish({ force: true }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("PUBLISH-FAIL", e); process.exit(1); });
}
