import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { readFileSync, statSync } from "fs";
import path from "path";
import { createRequire } from "module";
import { createHash } from "crypto";
import { replayWeave, bookBlocks } from "@/lib/weave";
/* 107 — ספירת-הספר-המלא (מקור-אחד-למושג — גם ה-truthpath קורא-משם) */
import { countBookTxsCached } from "@/lib/book-count";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovexplorer — Task 71: EXPLORER — advanced explorer of SAOS-NET.
 *
 * "תיעוד של הרשת על הרשת": האקספלורר קורא את אוגר-הבלוקים הריבוני ומריץ
 * אימות-שלמות חי **דרך המנוע עצמו** — replay מלא: genesis → כל-בלוק
 * נבנה-מחדש עם K.buildBlock (hash + results + gas), שורשי-הצ'קפוינטים
 * משוחזרים-מתמטית, וה-root הסופי מושווה למצב-הצומת. זהה = השרשרת שלמה.
 *
 * מציג: בלוקים (מלאים), חשבונות, ספר, עגונים+הצהרות, תיעוד-ציבורי
 * (publications — custom_json על השרשרת-המארחת), פיניקס וספירות-מראה.
 * ה-API לעולם לא 500 — מצב-לא-מאומת הוא מצב, לא שגיאה.
 */

const SOV = path.join(process.cwd(), "sovereign");
const AGENT = path.join(process.cwd(), "agent");
const HEAD = "headcorner";

/* קרנל — אותו קוד, אותה מתמטיקה (האימות חייב לרוץ על המנוע עצמו).
 * תגלית-72: הקרנל-השמור-במטמון-נטען-פעם-אחת — שדרוג-קרנל (למשל op produce)
 * השאיר-את-ה-replay-על-גרסה-ישנה → אי-התאמות-פיקטיביות. טעינה-מחדש-לפי-mtime,
 * עם-fallback-שקט לטעינה-רגילה אם סילוק-המטמון לא נתמך בסנדבוקס. */
let K: Record<string, any> | null = null;
let Kmtime = 0;
let Kerror: string | null = null;
function kernel(): Record<string, any> | null {
  try {
    const p = path.join(SOV, "core", "kernel.cjs");
    let m = 0;
    try {
      m = statSync(p).mtimeMs;
    } catch {
      return K;
    }
    if (K && m === Kmtime) return K;
    const req = createRequire(path.join(process.cwd(), "package.json"));
    try {
      const resolved = req.resolve(p) as string;
      delete (req.cache as Record<string, unknown>)[resolved];
      K = req(resolved) as Record<string, any>;
    } catch {
      K = req(p) as Record<string, any>; // fallback — בלי-סילוק-מטמון
    }
    Kmtime = m;
    Kerror = null;
    return K;
  } catch (e) {
    Kerror = String((e as Error)?.message ?? e).slice(0, 120);
    return null;
  }
}

async function readJson(p: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as Record<string, any>;
  } catch {
    return null;
  }
}

/* ── 107 — אימוץ-הסוכן-השני (W18 שלו, שפספסנו): ספירת-הספר-המלא עברה-ל-lib/book-count.ts ── */

interface BlockRec {
  height: number;
  time: string;
  hash: string;
  prevHash?: string | null;
  txs: Record<string, any>[];
  results: { ok: boolean; err?: string | null; gas: number; type: string; filled?: number; out?: number; shares?: number; orderId?: number }[];
  gasUsed: number;
}

/* ── 73: חקירת-חשבון — כל-התפקידים של-חשבון בטרנזאקציה אחת ──
 * מפה-כנה: החשבון-הנבדק מופיע-כ… (from/to/owner/taker/maker/pool/wrap/yield/validator/producer)
 * אפס-ניחושים — כל-תפקיד נגזר-מהטרנזאקציה עצמה (maker דרך-ההזמנה-על-הספר). ── */
function rolesFor(t: Record<string, any>, name: string, orderOwner: string | null): string[] {
  const roles: string[] = [];
  const hit = (v: unknown, role: string) => {
    if (String(v ?? "").toLowerCase() === name) roles.push(role);
  };
  switch (t.type) {
    case "transfer":
    case "pay":
    case "steemPay":
      hit(t.from, "from");
      hit(t.to, "to");
      break;
    case "order":
    case "cancel":
    case "pool_add":
      hit(t.owner, "owner");
      break;
    case "fill":
      hit(t.taker, "taker");
      if (orderOwner != null) hit(orderOwner, "maker");
      break;
    case "pool_swap":
      hit(t.taker, "taker");
      break;
    case "wrap_mint":
      hit(t.issuer, "issuer");
      hit(t.to, "to");
      hit(t.from, "from");
      break;
    case "wrap_burn":
      hit(t.issuer, "issuer");
      hit(t.from, "from");
      hit(t.to, "to");
      break;
    case "yield":
      if (Array.isArray(t.payments)) for (const p of t.payments) hit(p.account, "yield");
      hit(t.from, "issuer");
      break;
    case "attest":
      hit(t.validator, "validator");
      break;
    case "produce":
      hit(t.producer, "producer");
      break;
  }
  return roles;
}

/** tx מלא לתצוגה — שדות קריאים לפי סוג */
function txView(t: Record<string, any>): Record<string, unknown> {
  const base: Record<string, unknown> = { type: t.type, ref: t.ref ?? null, mirror: t.mirror ?? null };
  switch (t.type) {
    case "transfer":
    case "pay":
    case "steemPay":
      return { ...base, from: t.from ?? null, to: t.to ?? null, amount: t.amount ?? null };
    case "order":
      return { ...base, owner: t.owner ?? null, side: t.side ?? null, amount: t.amount ?? null, price: t.price ?? null };
    case "cancel":
      return { ...base, owner: t.owner ?? null, orderId: t.orderId ?? null };
    case "fill":
      return { ...base, taker: t.taker ?? null, orderId: t.orderId ?? null, amount: t.amount ?? null };
    case "pool_add":
      return { ...base, owner: t.owner ?? null, amountSaos: t.amountSaos ?? 0, amountSteem: t.amountSteem ?? 0 };
    case "pool_swap":
      return { ...base, taker: t.taker ?? null, side: t.side ?? null, inAmt: t.inAmt ?? null };
    case "wrap_mint":
    case "wrap_burn":
      return { ...base, symbol: t.symbol ?? null, issuer: t.issuer ?? null, to: t.to ?? t.from ?? null, amount: t.amount ?? null };
    case "yield":
      return { ...base, from: t.from ?? null, day: t.day ?? null, payments: t.payments ?? [] };
    case "attest":
      return { ...base, validator: t.validator ?? null, checkpointHash: t.checkpointHash ?? null };
    case "produce":
      return { ...base, producer: t.producer ?? null, round: t.round ?? null };
    case "heartbeat":
      return { ...base, note: t.note ?? null };
    default:
      return { ...base, raw: t };
  }
}

function shapeBlock(b: BlockRec, full: boolean, rebuilt?: { hashOk: boolean; resultsOk: boolean }) {
  const okN = (b.results ?? []).filter((r) => r.ok).length;
  return {
    height: b.height,
    time: b.time,
    hash: b.hash,
    prevHash: b.prevHash ?? null,
    gasUsed: b.gasUsed,
    txs: (b.txs ?? []).length,
    okTxs: okN,
    failTxs: (b.results ?? []).length - okN,
    hashVerified: rebuilt ? rebuilt.hashOk : null,
    resultsVerified: rebuilt ? rebuilt.resultsOk : null,
    txView: full
      ? (b.txs ?? []).map((t, i) => ({ ...txView(t), ok: b.results?.[i]?.ok ?? null, err: b.results?.[i]?.err ?? null, gas: b.results?.[i]?.gas ?? 0 }))
      : undefined,
    results: full ? b.results?.map((r) => ({ ok: r.ok, err: r.err ?? null, type: r.type, gas: r.gas })) : undefined,
  };
}

export async function GET(req: NextRequest) {
  const k = kernel();
  const sp = req.nextUrl.searchParams;
  const hParam = sp.get("h");
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "25", 10) || 25, 1), 60);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  const [genesis, nodeSt, chain, phoenix] = await Promise.all([
    readJson(path.join(SOV, "genesis", "genesis.json")),
    readJson(path.join(SOV, "node", "state.json")),
    readJson(path.join(SOV, "node", "chain.json")),
    readJson(path.join(AGENT, "phoenix_state.json")),
  ]);

  const blocks: BlockRec[] = (chain?.blocks ?? []) as BlockRec[];
  if (!blocks.length || !genesis || !k) {
    return NextResponse.json(
      { ok: true, ready: false, at: new Date().toISOString(), net: "saos-net/0", kernelError: Kerror },
      { status: 200 }
    );
  }

  /* ── 105 — אימות-שלמות מאוחד (מקביל-ל-weave/status · מקור-אחד-למושג):
   *    ה-verifier = replayWeave() — replay מלא מהג'נזיס עם applyTx + מטא-מוקלט
   *    (הצומת-חתום-על-הליניאגה-שלו-עצמו), מטומן-לפי-mtime. הוכחה-חיה-שנמדדה:
   *    finalRoot ≡ stateRoot-חי · cps 64/64.
   *    ה-rebuild-שהיה-כאן (K.buildBlock-פר-בלוק, hash+results) היה:
   *    (א) מאמת-שקרי — ארכיון-נפתח-ב-h2 → כל-hash-סוטה מהבלוק-הראשון (heightBroken/linkBroken/false ×25,345)
   *    (ב) מכונת-OOM — rebuild-מלא בכל-בקשה (הדף דוגם-כל-20ש')
   *    (ג) מקור-ה-accounts/orders של-המסך — הציג יתרות-כוזבות ל-9/12 חשבונות.
   *    ה-lineage-rebuild הועבר-למושג-נפרד-ומוצהר-בכנות כ-bלתי-ניתן-לשיפוט
   *    כשהארכיון-לא-נפתח-ב-h1. ── */
  const rw = replayWeave();
  /* 105 — ארכיון-ללא-שורת-כותרת: השורה-הראשונה היא בלוק-h1 עצמו (הקוד-הישן חשב-אותה
   * ככותרת, בלע-את-h1, והתחיל-מ-h2 — שורש-מפלת-השקרים). נגזר-מהספר-הממוזג-המטומן. */
  const bb = bookBlocks();
  /* 107 — ספירת-הספר-המלא (מטומנת-mtime) — המספר-האמיתי שהמפעיל שאל עליו */
  const bookTxs = countBookTxsCached();
  const archiveSpan = {
    from: bb.length ? Number(bb[0].height) : null,
    to: bb.length ? Number(bb[bb.length - 1].height) : null,
  };
  const lineageJudgeable = false; // 105 — ה-rebuild-הביטי אינו עוד סמכות; stateRepro היא ההוכחה
  const stateRepro = {
    checked: rw?.cps?.checked ?? 0,
    matched: rw?.cps?.matched ?? 0,
    firstBadHeight: rw?.cps?.firstBadHeight ?? null,
  };
  /* 105 — השוואה-כנה מול-ספר-בתנועה: אם-הצומת-הקדים-את-הספר-במטמון (פעימה-נחתה-בין-ה-replay
   * לקריאה) — השיפוט-מושהה (null), לא שקר-שלילי. שוויון-גבהים = שיפוט-תקף. */
  const rwHeight = Number((rw as any)?.height ?? 0);
  const nodeHeight = Number(nodeSt?.height ?? 0);
  const finalRootMatch: boolean | null =
    rwHeight > 0 && nodeHeight > 0 && rwHeight !== nodeHeight
      ? null
      : !!(rw?.ok && rw.finalRoot && nodeSt?.stateRoot && rw.finalRoot === nodeSt.stateRoot);
  const reproducedByHeight = new Map<number, boolean>(((rw?.cpsDetail ?? []) as any[]).map((d) => [Number(d.height), !!d.matched]));

  const cps = ((nodeSt?.checkpoints ?? []) as Record<string, any>[]).map((c) => {
    /* 105 — reproduced ממפת-ה-stateRepro המאוחד (שיטת-הסמכות) — לא מה-rebuild-הסוטה;
     * צ'קפוינטים-מתחת-לחלון-הפרטים (40-אחרונים) מוצהרים-כלא-נשפטים (null) בכנות. */
    const reproduced = reproducedByHeight.has(Number(c.height)) ? reproducedByHeight.get(Number(c.height))! : null;
    return {
      height: c.height ?? null,
      stateRoot: c.stateRoot ?? null,
      checkpointHash: c.checkpointHash ?? null,
      anchors: c.anchors ?? {},
      attests: c.attests ?? [],
      at: c.at ?? null,
      reproduced,
    };
  });
  /* 105 — allCpReproduced אינו עוד שער: הכריע stateRepro.matched===checked + finalRootMatch */

  /* ── חיפוש-בלוק-בודד ── */
  if (hParam != null) {
    const h = parseInt(hParam, 10);
    const idx = blocks.findIndex((x) => x.height === h);
    const b = idx >= 0 ? blocks[idx] : null;
    return NextResponse.json(
      {
        ok: true,
        ready: true,
        at: new Date().toISOString(),
        net: "saos-net/0",
        block: b ? shapeBlock(b, true) : null,
        chainHeight: blocks.length,
      },
      { status: 200 }
    );
  }

  /* ── 105 — מקור-התצוגה = הסמכות: snapshot-המצב-החי שהצומת-כותב-בכל-פעימה
   *    (hash-חסום-לספר ע"י שרשרת-העוגן של weave/status) · fallback-כנה ל-replay-המאומת.
   *    היה-כאן: st = replayState (ה-rebuild-הסוטה) — הציג יתרות-כוזבות ל-9/12 חשבונות. ── */
  const st = (() => {
    try {
      const snap = JSON.parse(readFileSync(path.join(SOV, "node", "state-snapshot.json"), "utf8"));
      if (snap && snap.st && snap.st.accounts && Number.isFinite(Number(snap.height))) return snap.st as Record<string, any>;
    } catch { /* אין-snapshot — fallback בכנות */ }
    return (rw?.st ?? {}) as Record<string, any>;
  })();
  const stateSource = (() => {
    try {
      const snap = JSON.parse(readFileSync(path.join(SOV, "node", "state-snapshot.json"), "utf8"));
      if (snap && snap.st && snap.st.accounts) return "live-snapshot" as const;
    } catch { /* אין-snapshot */ }
    return "faithful-replay" as const;
  })();
  const meta = (st.meta ?? {}) as Record<string, any>;
  const accounts = (st.accounts ?? {}) as Record<string, Record<string, any>>;
  const orders = (st.orders ?? []) as Record<string, any>[];
  const live = orders.filter((o) => o.live);
  const txsTotal = blocks.reduce((s, b) => s + (b.txs ?? []).length, 0);
  const gasTotal = blocks.reduce((s, b) => s + (b.gasUsed ?? 0), 0);
  const opsByType: Record<string, number> = {};
  for (const b of blocks) for (const t of b.txs ?? []) opsByType[t.type] = (opsByType[t.type] ?? 0) + 1;

  /* ── TASK-88 עימות-השלמת-עסקאות (measured, לא-מובטח):
   *    כל-tx בכל-בלוק נבדק מול ה-results הקרנליים → שיעור-השלמה-כולל
   *    + שיעור-חי (50 בלוקים-אחרונים) + פירוק-סיבות-כישלון לפי err ── */
  const RECENT_WIN = 50;
  const recentStart = Math.max(blocks.length - RECENT_WIN, 0);
  let txOk = 0;
  let txFail = 0;
  let recentOk = 0;
  let recentFail = 0;
  const failByErr: Record<string, number> = {};
  const failByType: Record<string, number> = {};
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    (b.results ?? []).forEach((r: Record<string, unknown>, j: number) => {
      const isRecent = i >= recentStart;
      if (r?.ok) {
        txOk++;
        if (isRecent) recentOk++;
      } else {
        txFail++;
        if (isRecent) recentFail++;
        const err = String(r?.err ?? "unknown");
        const type = String((b.txs ?? [])[j]?.type ?? "unknown");
        failByErr[err] = (failByErr[err] ?? 0) + 1;
        failByType[type] = (failByType[type] ?? 0) + 1;
      }
    });
  }
  const txCompletion = {
    total: txOk + txFail,
    ok: txOk,
    fail: txFail,
    ratePct: txOk + txFail > 0 ? Math.round((100 * txOk) / (txOk + txFail)) : 100,
    recent: {
      window: RECENT_WIN,
      ok: recentOk,
      fail: recentFail,
      ratePct: recentOk + recentFail > 0 ? Math.round((100 * recentOk) / (recentOk + recentFail)) : 100,
    },
    failByErr,
    failByType,
    at: new Date().toISOString(),
  };

  const accountRows = Object.entries(accounts)
    .map(([name, a]) => ({
      name,
      saos: (a.saos ?? 0) / 1000,
      steem: (a.steem ?? 0) / 1000,
      lockedSaos: (a.lockedSaos ?? 0) / 1000,
      lockedSteem: (a.lockedSteem ?? 0) / 1000,
      lp: (a.lp ?? 0) / 1e6,
      wrapped: Object.fromEntries(Object.entries(a.wrapped ?? {}).map(([sym, v]) => [sym, (v as number) / 1000])),
      credits: (a.credits ?? 0) / 1000,
      boundary: name === "host",
    }))
    .sort((x, y) => Number(y.boundary) - Number(x.boundary) || y.saos + y.steem - (x.saos + x.steem));

  const fillRows: Record<string, unknown>[] = [];
  for (const b of blocks) {
    (b.txs ?? []).forEach((t, i) => {
      if (t.type !== "fill") return;
      const r = b.results?.[i];
      const ord = orders.find((o) => o.id === Number(t.orderId));
      fillRows.push({
        height: b.height,
        time: b.time,
        taker: t.taker,
        orderId: t.orderId,
        maker: ord?.owner ?? null,
        amount: t.amount,
        price: ord ? (ord.price ?? 0) / 1e6 : null,
        ok: r?.ok ?? false,
        filled: r?.filled ?? null,
        ref: t.ref ?? null,
        mirror: t.mirror ?? null,
      });
    });
  }

  const publications = ((nodeSt?.explorer?.publishes ?? []) as Record<string, any>[])
    .slice(-24)
    .map((p) => ({ ...p }));

  /* ── STAGE-3 ROTATION (72): ראשים-מתחלפים — החוק + רשם-הסבבים ──
   * החוק: producer(round) = roster[round mod |roster|], round=floor(h/12).
   * הרוסטר נלקח-מהפרסום-המאומת (nodeSt.rot), והחוק נבדק-מול-כל-produce
   * שעל-השרשרת — סטייה-מהחוק מסומנת lawOk:false (לעולם לא מוסתרת). ── */
  const rot = (nodeSt?.rot ?? {}) as Record<string, any>;
  const roster: string[] = rot.roster ?? [];
  const produceRounds = blocks.flatMap((b, bi) =>
    (b.txs ?? []).map((t, ti) => ({ t, b, ti, bi })).filter((x) => x.t.type === "produce")
  ).map(({ t, b, ti }) => {
    const r = Number(t.round);
    const rec = (rot.rounds ?? {})[String(r)] ?? (rot.rounds ?? {})[r] ?? null;
    return {
      round: r,
      height: b.height,
      producer: String(t.producer ?? ""),
      ref: t.ref ?? null,
      ok: b.results?.[ti]?.ok ?? null,
      lawOk: roster.length > 0 ? String(t.producer ?? "") === roster[r % roster.length] : null,
      hostTxid: rec?.hostTxid ?? null,
      verified: rec?.verified ?? false,
    };
  });
  const curHeight = blocks.length;
  const curRound = Math.floor(curHeight / 12);
  const rotation = {
    law: "producer(round) = roster[floor(height/12) mod |roster|]",
    roster,
    rosterDigest: rot.rosterDigest ?? null,
    rosterPubs: (rot.rosterPubs ?? []).slice(-4),
    current: {
      round: curRound,
      mandated: roster.length ? roster[curRound % roster.length] : null,
      produced: !!produceRounds.find((p) => p.round === curRound && p.ok),
    },
    next: {
      round: curRound + 1,
      mandated: roster.length ? roster[(curRound + 1) % roster.length] : null,
    },
    rounds: produceRounds.slice(-16).reverse(),
    misses: rot.misses ?? 0,
  };

  /* ── 73: חבילת-אימות לצד-שלישי (?export=verify) — כל-מה-צריך-ל-replay-עצמאי ──
   * הרשת-מספקת-את-הראיות-עצמן: ג'נזיס + שרשרת-מלאה + צ'קפוינטים + stateRoot
   * + הרוסטר-החוקי, עם digest=sha256(canon(core)) על הקרנל-עצמו. ── */
  if (sp.get("export") === "verify") {
    const core = {
      genesisHash: genesis.genesisHash ?? null,
      blocks,
      checkpoints: nodeSt?.checkpoints ?? [],
      stateRoot: nodeSt?.stateRoot ?? null,
    };
    const digest = createHash("sha256").update(k.canon(core)).digest("hex");
    const pack = {
      at: new Date().toISOString(),
      net: "saos-net/0",
      protocol: "saos:net/v1",
      what: "verify-pack — everything needed to replay SAOS-NET independently",
      digest,
      digestOf: "sha256(canonicalJSON({genesisHash, blocks, checkpoints, stateRoot})) via kernel.canon",
      genesis,
      chain,
      checkpoints: nodeSt?.checkpoints ?? [],
      stateRoot: nodeSt?.stateRoot ?? null,
      rotation: {
        law: "producer(round) = roster[floor(height/12) mod |roster|]",
        roster,
        rosterDigest: rot.rosterDigest ?? null,
      },
      integrity: {
        stateRepro,
        finalRootMatch,
        anchor: rw?.anchor ?? null,
        lineage: {
          from: archiveSpan.from,
          to: archiveSpan.to,
          judgeable: lineageJudgeable,
          reason: `bit-level rebuild is not the verifier — stateRepro (applyTx + recorded meta) is the proof; archive span h${archiveSpan.from ?? "?"}→h${archiveSpan.to ?? "?"} · rebuild removed 105 (false-alarm machine + OOM per request)`,
        },
        checkpoints: cps.length,
        checkpointsReproduced: stateRepro.matched,
        stateSource,
        ok: stateRepro.checked > 0 && stateRepro.matched === stateRepro.checked && finalRootMatch !== false,
        at: new Date().toISOString(),
      },
      howToVerify: [
        "1. load genesis.json → state = kernel.initFromGenesis(genesis)",
        "2. for each archived block in order: apply every tx with kernel.applyTx; sync meta.height/lastBlockHash/lastTime from the recorded block",
        "3. assert stateRoot at every checkpoint height === recorded checkpoint stateRoot (stateRepro)",
        "4. assert final kernel.stateRoot(state) === stateRoot field above === digest core",
        "6. rotation: producer(round) must equal roster[round mod |roster|] (rosterDigest above)",
      ],
    };
    return new NextResponse(JSON.stringify(pack), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="saos-net-verify-pack-h${blocks.length}.json"`,
        "x-saos-digest": digest,
      },
    });
  }

  /* ── 73: חקירת-חשבון (?a=name) — כל-ההיסטוריה-של-חשבון מכל-השרשרת ── */
  const aParam = sp.get("a");
  if (aParam != null) {
    const name = aParam.trim().toLowerCase().replace(/^@/, "");
    const activity: Record<string, unknown>[] = [];
    const stats: Record<string, number> = {};
    let yieldReceived = 0;
    let gasPaid = 0;
    for (const b of blocks) {
      (b.txs ?? []).forEach((t, ti) => {
        const ord = t.type === "fill" ? orders.find((o) => o.id === Number(t.orderId)) : null;
        const roles = rolesFor(t, name, ord?.owner ?? null);
        if (!roles.length) return;
        const r = b.results?.[ti];
        const ok = r?.ok ?? null;
        if (ok === true) {
          stats[t.type] = (stats[t.type] ?? 0) + 1;
          gasPaid += r?.gas ?? 0;
        }
        if (t.type === "yield" && ok === true && Array.isArray(t.payments)) {
          for (const p of t.payments) {
            if (String(p.account ?? "").toLowerCase() === name) yieldReceived += Number(p.amount) || 0;
          }
        }
        activity.push({
          height: b.height,
          time: b.time,
          type: t.type,
          roles,
          ok,
          err: r?.err ?? null,
          gas: r?.gas ?? 0,
          view: txView(t),
        });
      });
    }
    const balances = accountRows.find((a) => a.name === name) ?? null;
    const myOrders = orders
      .filter((o) => String(o.owner ?? "").toLowerCase() === name)
      .reverse()
      .slice(0, 40)
      .map((o) => ({ id: o.id, side: o.side, amount: o.amount / 1000, price: (o.price ?? 0) / 1e6, live: !!o.live, at: o.at ?? null }));
    const myFills = fillRows
      .filter((f) => f.taker === name || f.maker === name)
      .slice(-60)
      .reverse();
    const myProduces = produceRounds.filter((p) => p.producer === name).slice(-12).reverse();
    const myAttests = cps.flatMap((c) => (c.attests ?? []).filter((a) => String(a.by ?? "").toLowerCase() === name).map((a) => ({ height: c.height, verified: a.verified, txid: a.txid ?? null })));
    return NextResponse.json(
      {
        ok: true,
        ready: true,
        at: new Date().toISOString(),
        net: "saos-net/0",
        chainHeight: blocks.length,
        account: {
          name,
          known: balances != null,
          boundary: balances?.boundary ?? false,
          balances,
          ops: activity.length,
          stats,
          yieldReceived,
          gasPaid,
          produceRounds: myProduces.length,
          attests: myAttests.length,
        },
        activity: activity.slice(-120).reverse(),
        orders: myOrders,
        fills: myFills,
        produces: myProduces,
        attests: myAttests.slice(-8).reverse(),
      },
      { status: 200 }
    );
  }

  const summary = {
    height: blocks.length,
    stateRoot: nodeSt?.stateRoot ?? null,
    genesisHash: genesis.genesisHash ?? null,
    lastBlockHash: blocks[blocks.length - 1]?.hash ?? null,
    beats: nodeSt?.beats ?? 0,
    supply: (meta.supply ?? 0) / 1000,
    /* 107 — אמת-במספרים (אימוץ-W18 של-הסוכן-השני): txsTotal = ספירת-החלון-החם בלבד
     * (chain.json · 512 בלוקים) — מוצהר-בשדה txsScope · bookTxTotal = ספירת-הספר-המלא
     * מהארכיון (מדויק, מטמון-mtime). אסור שמספר-חלון יוצג כאילו-הוא כל-הספר. */
    txsTotal,
    txsScope: { from: blocks[0]?.height ?? null, to: blocks[blocks.length - 1]?.height ?? null, blocksKept: blocks.length },
    bookTxTotal: bookTxs.total,
    bookBlocks: bookTxs.blocks,
    txCompletion,
    gasTotal,
    opsByType,
    trades: meta.trades ?? 0,
    swaps: meta.swaps ?? 0,
    pays: meta.pays ?? 0,
    steemPays: meta.steemPays ?? 0,
    yieldTotal: (meta.yieldTotal ?? 0) / 1000,
    yieldDay: meta.yieldDay ?? null,
    fees: {
      total: (st.fees?.total ?? 0) / 1000,
      toLp: (st.fees?.toLp ?? 0) / 1000,
      toTreasury: (st.fees?.toTreasury ?? 0) / 1000,
      feeBps: st.pool?.feeBps ?? 30,
    },
    boundarySteem: (accounts.host?.steem ?? 0) / 1000,
    accountsCount: accountRows.length,
    liveOrders: live.length,
    asks: live.filter((o) => o.side === "sell").length,
    bids: live.filter((o) => o.side === "buy").length,
    lastPrice: meta.lastPrice ? meta.lastPrice / 1e6 : null,
    pool: {
      saos: (st.pool?.saos ?? 0) / 1000,
      steem: (st.pool?.steem ?? 0) / 1000,
      lpSupply: (st.pool?.lpSupply ?? 0) / 1e6,
    },
    attestRoots: Object.keys(st.attests ?? {}).length,
    head: meta.lastProducer ?? null,
    headRound: meta.lastProduceRound ?? null,
    /* 105 — אימות-מאוחד: stateRepro (שיטת-הסמכות) + anchor + lineage-מוצהר-בכנות */
    integrity: {
      stateRepro,
      finalRootMatch,
      anchor: rw?.anchor ?? null,
      lineage: {
        from: archiveSpan.from,
        to: archiveSpan.to,
        judgeable: lineageJudgeable,
        reason: `bit-level rebuild is not the verifier — stateRepro (applyTx + recorded meta) is the proof; archive span h${archiveSpan.from ?? "?"}→h${archiveSpan.to ?? "?"} · rebuild removed 105 (false-alarm machine + OOM per request)`,
      },
      checkpoints: cps.length,
      checkpointsReproduced: stateRepro.matched,
      stateSource,
      ok: stateRepro.checked > 0 && stateRepro.matched === stateRepro.checked && finalRootMatch !== false,
      at: new Date().toISOString(),
    },
  };

  const start = Math.max(blocks.length - offset - limit, 0);
  const end = blocks.length - offset;
  const slice = blocks.slice(start, end).reverse(); // חדש→ישן

  return NextResponse.json(
    {
      ok: true,
      ready: true,
      at: new Date().toISOString(),
      net: "saos-net/0",
      summary,
      blocks: slice.map((b) => shapeBlock(b, false)),
      blocksStart: start + 1,
      blocksEnd: end,
      accounts: accountRows,
      orders: orders
        .slice()
        .reverse()
        .slice(0, 64)
        .map((o) => ({ id: o.id, side: o.side, owner: o.owner, amount: o.amount / 1000, price: (o.price ?? 0) / 1e6, live: !!o.live, at: o.at ?? null })),
      fills: fillRows.slice(-40).reverse(),
      checkpoints: cps.slice(-12).reverse(),
      publications,
      rotation,
      spark: {
        gas: blocks.slice(-64).map((b) => ({ h: b.height, gas: b.gasUsed, txs: (b.txs ?? []).length })),
        price: fillRows.filter((f) => f.ok && f.price != null).slice(-64).map((f) => ({ h: f.height, p: f.price as number })),
      },
      verifyPack: { ready: true, how: "/api/ops/sovexplorer?export=verify" },
      explorer: nodeSt?.explorer ?? null,
      mirror: nodeSt?.mirror ?? null,
      sov: nodeSt?.sov ?? null,
      phoenix: phoenix
        ? { at: phoenix.at ?? null, verdict: phoenix.verdict ?? null, checks: (phoenix.checks ?? []).length }
        : null,
      genesis: genesis
        ? {
            genesisHash: genesis.genesisHash ?? null,
            time: genesis.time ?? null,
            sources: Object.keys(genesis.sources ?? {}),
          }
        : null,
    },
    { status: 200 }
  );
}
