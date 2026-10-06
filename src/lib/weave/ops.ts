// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · ops - קורא פקודות המפעיל מהשרשרת הציבורית (שער הכניסה)
//
// השער (הקונסולה הציבורית /gate.html) משדר custom_json חתום מחשבון
// המפעיל - רשות POSTING בלבד: השרשרת עצמה אוסרת על המפתח הזה להזיז
// כסף, והיא גם זו שאימתה את החתימה בהכללה לבלוק. הלב קורא את
// ההיסטוריה הציבורית (חסר-מפתח) ומבצע פקודות שטרם בוצעו.
//
// דוקטרינה:
//   · ההיסטוריה של השרשרת היא הקבלה - אין מקור סמכות אחר.
//   · אידמפוטנטיות: כל פקודה נושאת id ייחודי; sovereign/ops-log.json
//     (בגיט) מתעד מה בוצע - ריצה חוזרת לעולם לא מבצעת פעמיים.
//   · חלון-זמן: רק פקודות מ-48 השעות האחרונות (היסטוריה ישנה היא
//     ארכיון, לא תור).
//   · תקרה: עד 5 פקודות לפעימה - שיטפון חתום הוא עדיין שיטפון.
//   · פקודת מפעיל מעירה את הרשת: גם במצב SANDBOX-ALIVE (הענן
//     הנסוג) - המפעיל דיבר, הרשת מגיבה בפעימה מלאה ודחיפה.
//   · פקודה לא מוכרת נרשמת כמתעלמת בכנות - לא נופלת, לא מתבצעת.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { rpcV4, STEEM_RPC_NODES, steemBroadcast, steemRcGate } from "@/lib/weave/graphene";
import { db } from "@/lib/db";
import { appendAttestation } from "@/lib/weave/ledger";
import { createCheckpointNow } from "@/lib/weave/beat";

export const OPS_OP_ID = "saos.weave.ops.v1";
export const OPERATOR_ACCOUNT = (process.env.WEAVE_OPERATOR_ACCOUNT || "headcorner").toLowerCase();
const WITNESS_ACCOUNT = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const SAOS_LIVE_OP_ID = "saos.weave.live.v1";
const OPS_LOG_PATH = path.join(process.cwd(), "sovereign", "ops-log.json");
// R57: שם שמור — saos-live.json הוא הספר הציבורי בלבד; מצב הדמון בשם משלו
const SAOS_STATE_PATH = path.join(process.cwd(), "sovereign", "saos-live-state.json");
const WINDOW_MS = 48 * 3600 * 1000; // חלון הפקודות
const MAX_PER_BEAT = 5; // תקרה לפעימה
const PAGE = 100; // עומק קריאה לעמוד
const MAX_PAGES = 12; // ~1200 פעולות אחרונות של החשבון

const OWNER = process.env.WEAVE_OWNER || "roshpinacare-sys";

export interface OperatorCommand {
  id: string;
  cmd: string;
  at: string;
  note?: string;
  txid: string;
  block: number | null;
  /** הוכחת גילוי (פקודת acid) - המתכון שהרשת משחזרת לפני שהיא מעידה */
  proof?: AcidProof;
  /** מטען SAOS חתום-להיות (פקודות saos.*) - הענן חותם במפתח האוצר */
  saos?: Record<string, unknown>;
}

/** חבילת ההוכחה שנחתמת לשרשרת - הגילוי כולו נגזר מחדש ממנה */
export interface AcidProof {
  ev: string; // גרסת המנוע - שחזור חוצה-גרסאות אסור
  t: string; // מזהה משימה
  s: number; // זרע
  g: number; // דורות
  p: number; // אוכלוסייה
  h: string; // hash התוכנית שנמצאה (16 hex)
}

export interface ExecutedCommand {
  id: string;
  cmd: string;
  at: string;
  txid: string;
  action: string;
  ok: boolean;
  detail?: string;
  executedAt: string;
}

export interface OperatorOpsResult {
  executed: ExecutedCommand[];
  attSeqs: number[];
  checkpoint: { index: number; root: string } | null;
  skippedOld: number;
  readFrom: string;
}

interface OpsLogFile {
  format: "weave-ops-log-v1";
  operator: string;
  executed: Record<string, ExecutedCommand>;
  updatedAt: string;
}

function loadOpsLog(): OpsLogFile {
  try {
    const raw = JSON.parse(fs.readFileSync(OPS_LOG_PATH, "utf8")) as OpsLogFile;
    if (raw.format === "weave-ops-log-v1" && raw.executed && typeof raw.executed === "object") return raw;
  } catch {
    /* אין עדיין - נולד עכשיו */
  }
  return { format: "weave-ops-log-v1", operator: OPERATOR_ACCOUNT, executed: {}, updatedAt: new Date(0).toISOString() };
}

function saveOpsLog(log: OpsLogFile): void {
  fs.mkdirSync(path.dirname(OPS_LOG_PATH), { recursive: true });
  log.updatedAt = new Date().toISOString();
  fs.writeFileSync(OPS_LOG_PATH, JSON.stringify(log, null, 2) + "\n");
}

/** קריאת היסטוריית הפקודות של המפעיל מהשרשרת הציבורית - חסרת-מפתח לחלוטין */
export async function readOperatorCommands(): Promise<{ commands: OperatorCommand[]; node: string; skippedOld: number }> {
  const cutoff = Date.now() - WINDOW_MS;
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      const found: OperatorCommand[] = [];
      let skippedOld = 0;
      let start = -1;
      let oldestSeen = Infinity;
      let deepest = 0;
      for (let p = 0; p < MAX_PAGES; p++) {
        const hist = await rpcV4<Array<[number, { trx_id: string; block: number; op?: [string, Record<string, unknown>] }]>>(
          node,
          "condenser_api.get_account_history",
          [OPERATOR_ACCOUNT, start, PAGE],
        );
        if (!Array.isArray(hist) || !hist.length) break;
        for (const [idx, entry] of hist) {
          if (typeof idx === "number") {
            oldestSeen = Math.min(oldestSeen, idx);
            deepest = Math.max(deepest, 1);
          }
          const op = entry && entry.op;
          if (!op || op[0] !== "custom_json") continue;
          const body = op[1] as { id?: string; json?: string; required_posting_auths?: string[] } | undefined;
          if (!body || body.id !== OPS_OP_ID) continue;
          // רק מהחשבון עצמו - לא פקודות מתחזות ב-required_posting_auths אחר
          if (!Array.isArray(body.required_posting_auths) || !body.required_posting_auths.includes(OPERATOR_ACCOUNT)) continue;
          let pl: Record<string, unknown>;
          try {
            pl = JSON.parse(String(body.json || "{}"));
          } catch {
            continue;
          }
          if (pl.v !== 1 || typeof pl.cmd !== "string" || typeof pl.id !== "string") continue;
          const atMs = Date.parse(String(pl.at || ""));
          if (!Number.isFinite(atMs)) continue;
          if (atMs < cutoff) {
            skippedOld++;
            continue;
          }
          // הוכחת גילוי (acid) - ולידציה קפדנית לפני שהיא נכנסת לתור
          let proof: AcidProof | undefined;
          if (pl.cmd === "acid" && pl.proof && typeof pl.proof === "object") {
            const pr = pl.proof as Record<string, unknown>;
            if (
              typeof pr.ev === "string" && pr.ev.length <= 32 &&
              typeof pr.t === "string" && pr.t.length <= 16 &&
              Number.isInteger(pr.s) && (pr.s as number) >= 0 && (pr.s as number) <= 2147483647 &&
              Number.isInteger(pr.g) && (pr.g as number) >= 1 && (pr.g as number) <= 5000 &&
              Number.isInteger(pr.p) && (pr.p as number) >= 8 && (pr.p as number) <= 500 &&
              typeof pr.h === "string" && /^[0-9a-f]{16}$/.test(pr.h)
            ) {
              proof = { ev: pr.ev, t: pr.t, s: pr.s as number, g: pr.g as number, p: pr.p as number, h: pr.h };
            }
          }
          // מטען SAOS (פקודות saos.*) - ולידציה קפדנית לפני שהענן חותם במפתח האוצר.
          // הפקודה מפרטת מה לעשות; החתימה על הפעולה עצמה נעשית בענן בלבד.
          let saos: Record<string, unknown> | undefined;
          if (typeof pl.cmd === "string" && pl.cmd.startsWith("saos.") && pl.saos && typeof pl.saos === "object") {
            const s = pl.saos as Record<string, unknown>;
            const ADDR = /^saos1[1-9A-HJ-NP-Za-km-z]{33,35}$/;
            const UNITS = /^\d{1,18}$/;
            const CUR = /^[A-Z]{2,10}$/;
            const PAIR = /^[A-Z]{2,10}\/[A-Z]{2,10}$/;
            const DEC = /^(0|[1-9]\d{0,11})(\.\d{1,8})?$/;
            const REF = /^[\w :.\-/+=]{6,90}$/;
            const IDREF = /^[0-9a-zA-Z._-]{6,40}$/;
            const optRef = (v: unknown) => v === undefined || (typeof v === "string" && REF.test(v));
            const optNote = (v: unknown) => v === undefined || (typeof v === "string" && v.length >= 1 && v.length <= 120);
            const dec = (v: unknown) => typeof v === "string" && DEC.test(v) && !/^0+(\.0+)?$/.test(v);
            let ok = false;
            if (pl.cmd === "saos.credit") {
              ok = typeof s.to === "string" && ADDR.test(s.to) &&
                typeof s.saos === "string" && UNITS.test(s.saos) && !/^0+$/.test(s.saos) &&
                typeof s.cur === "string" && CUR.test(s.cur) &&
                dec(s.amt) && optRef(s.ref) && optNote(s.note) &&
                (s.claimId === undefined || (typeof s.claimId === "string" && IDREF.test(s.claimId)));
            } else if (pl.cmd === "saos.addr") {
              ok = typeof s.cur === "string" && CUR.test(s.cur) &&
                typeof s.addr === "string" && s.addr.length >= 8 && s.addr.length <= 120 &&
                (s.memo === undefined || (typeof s.memo === "string" && s.memo.length <= 80));
            } else if (pl.cmd === "saos.rate") {
              ok = typeof s.pair === "string" && PAIR.test(s.pair) && dec(s.price);
            } else if (pl.cmd === "saos.fill") {
              ok = typeof s.offerId === "string" && IDREF.test(s.offerId) &&
                typeof s.to === "string" && ADDR.test(s.to) &&
                typeof s.units === "string" && UNITS.test(s.units) && !/^0+$/.test(s.units) &&
                optRef(s.ref) && (s.paid === undefined || dec(s.paid));
            } else if (pl.cmd === "saos.reward") {
              ok = typeof s.to === "string" && ADDR.test(s.to) &&
                typeof s.amount === "string" && UNITS.test(s.amount) && !/^0+$/.test(s.amount) &&
                optNote(s.note);
            }
            if (ok) {
              const clean: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(s)) if (v !== undefined) clean[k] = v;
              saos = clean;
            }
          }
          found.push({
            id: String(pl.id).slice(0, 40),
            cmd: String(pl.cmd).slice(0, 24),
            at: String(pl.at),
            note: typeof pl.note === "string" ? pl.note.slice(0, 180) : undefined,
            proof,
            saos,
            txid: String(entry.trx_id || ""),
            block: typeof entry.block === "number" ? entry.block : null,
          });
        }
        if (oldestSeen === Infinity || oldestSeen <= 1) break;
        start = Math.max(1, oldestSeen - 1);
      }
      return { commands: found, node: new URL(node).hostname, skippedOld };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`קריאת פקודות המפעיל נכשלה בכל הצמתים: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** שיגור workflow באמצעות ה-API - מותר רק בענן (יש טוקן) */
async function dispatchWorkflow(repo: string, workflow: string, token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
      // R112 — law of the bounded wait: no fetch without a deadline
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 204) return { ok: true, detail: "dispatched" };
    const txt = (await res.text()).slice(0, 120);
    return { ok: false, detail: `HTTP ${res.status} ${txt}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}

/**
 * עיבוד פקודות המפעיל - השלב שהלב מריץ בכל פעימה.
 * cloudAgentId: סוכן הענן מה-seal (חותם את אימוץ ה-OPERATOR).
 */
export async function processOperatorCommands(ctx: {
  runner: string;
  cloudAgentId: string;
  gitHead: string;
  repoSlug: string;
  runUrl?: string;
}): Promise<OperatorOpsResult> {
  const result: OperatorOpsResult = { executed: [], attSeqs: [], checkpoint: null, skippedOld: 0, readFrom: "" };
  const { commands, node, skippedOld } = await readOperatorCommands();
  result.readFrom = node;
  result.skippedOld = skippedOld;

  const log = loadOpsLog();
  const pending = commands
    .filter((c) => !log.executed[c.id])
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(0, MAX_PER_BEAT);

  if (pending.length === 0) return result;

  console.log(
    `[weave-ops] ${pending.length} פקודות מפעיל מהשרשרת (@${OPERATOR_ACCOUNT} · ${node} · חלון 48ש׳ · ${skippedOld} ישנות נספרו)`
  );

  const githubToken = process.env.GITHUB_TOKEN || "";
  const opsPat = process.env.WEAVE_OPS_PAT || "";

  for (const cmd of pending) {
    const executed: ExecutedCommand = {
      id: cmd.id,
      cmd: cmd.cmd,
      at: cmd.at,
      txid: cmd.txid,
      action: "",
      ok: false,
      executedAt: new Date().toISOString(),
    };
    try {
      if (cmd.cmd === "ping") {
        // נוכחות חתומה - נרשמת בספר כאימות OPERATOR ומכוסה checkpoint
        const claim =
          `פקודת מפעיל "ping" התקבלה מהשרשרת הציבורית מ-@${OPERATOR_ACCOUNT} - ` +
          `נוכחות חתומה של בעל הרשת, נאספה בפעימת הלב` +
          (cmd.note ? ` · דבר המפעיל: "${cmd.note}"` : "");
        const evidence = [
          `account=@${OPERATOR_ACCOUNT}`,
          `authority=posting (custom_json)`,
          `opId=${OPS_OP_ID}`,
          `txid=${cmd.txid}`,
          cmd.block ? `block=${cmd.block}` : null,
          `cmdId=${cmd.id}`,
          `cmdAt=${cmd.at}`,
          cmd.note ? `note=${cmd.note}` : null,
          `explorer=https://steemscan.com/transaction/${cmd.txid}`,
          `runner=${ctx.runner}`,
          `commit=${ctx.gitHead}`,
          ctx.runUrl ? `run=${ctx.runUrl}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const att = await appendAttestation({
          agentId: ctx.cloudAgentId,
          claim,
          claimType: "OPERATOR",
          evidence,
        });
        result.attSeqs.push(att.seq);
        executed.action = `OPERATOR attestation att${att.seq}`;
        executed.ok = true;
        executed.detail = att.entryHash.slice(0, 18);
        console.log(`[weave-ops] ping · אימות OPERATOR att${att.seq} · txid=${cmd.txid.slice(0, 12)}…`);
      } else if (cmd.cmd === "beat" || cmd.cmd === "anchor") {
        if (ctx.runner === "github-actions" && githubToken) {
          const wf = cmd.cmd === "beat" ? "weave-heart.yml" : "weave-anchor-lines.yml";
          const d = await dispatchWorkflow(ctx.repoSlug, wf, githubToken);
          executed.action = `dispatch ${wf}`;
          executed.ok = d.ok;
          executed.detail = d.detail;
          console.log(`[weave-ops] ${cmd.cmd} · dispatch ${wf}: ${d.ok ? "שוגר" : `נכשל - ${d.detail}`}`);
        } else {
          executed.action = `dispatch ${cmd.cmd} (local - skipped honestly)`;
          executed.ok = true;
          executed.detail = "local runner has no dispatch token";
          console.log(`[weave-ops] ${cmd.cmd} · דילוג-כנה (רץ מקומית, אין טוקן dispatch)`);
        }
      } else if (cmd.cmd === "acid") {
        // ── גילוי ריבוני - הרשת משחזרת לפני שהיא מעידה ──
        // המפעיל חתם מתכון (משימה, זרע, דורות, אוכלוסייה, hash).
        // הלב מריץ את אותו חיפוש דטרמיניסטי בענן ומשווה:
        //   · גרסת מנוע שונה · דילוג-כנה (לא מעידים על מה שלא נבדק)
        //   · לא נמצא / hash שונה · רישום כשל-שחזור בכנות - בלי אימות
        //   · נמצא וזהה · אימות 5-מבחנים בענן · אימות DISCOVERY + checkpoint
        const proof = cmd.proof;
        if (!proof) {
          executed.action = "acid-without-proof";
          executed.ok = true;
          executed.detail = "פקודת acid ללא הוכחה תקינה - נרשמה כמתעלמת בכנות";
          console.log(`[weave-ops] acid בלי הוכחה תקינה - התעלמות כנה`);
        } else {
          const acid = await import("../../../console/acid-engine.js");
          if (acid.ENGINE_VERSION !== proof.ev) {
            executed.action = "acid-engine-version-drift";
            executed.ok = true;
            executed.detail = `הוכחה מגרסה ${proof.ev}, הענן מריץ ${acid.ENGINE_VERSION} - שחזור חוצה-גרסאות אסור`;
            console.log(`[weave-ops] acid: אי-התאמת גרסאות מנוע (${proof.ev} ≠ ${acid.ENGINE_VERSION}) - דילוג-כנה`);
          } else {
            const t0 = Date.now();
            const rerun = acid.discoverSync({ taskId: proof.t, seed: proof.s, generations: proof.g, population: proof.p });
            const ms = Date.now() - t0;
            if (!rerun.found || !rerun.program || !rerun.hash) {
              executed.action = "acid-reproduction-failed";
              executed.ok = true;
              executed.detail = `הריצה מחדש לא מצאה את הגילוי (${proof.g} דורות, ${ms}ms) - לא הועד`;
              console.log(`[weave-ops] acid: השחזור לא מצא - לא הועד (אמת נשמרת)`);
            } else if (rerun.hash !== proof.h) {
              executed.action = "acid-hash-mismatch";
              executed.ok = true;
              executed.detail = `hash שונה בשחזור: ${rerun.hash} ≠ ${proof.h} - לא הועד`;
              console.log(`[weave-ops] acid: אי-התאמת hash - לא הועד`);
            } else {
              const verify = acid.verifyFull(rerun.program, proof.t, proof.s);
              if (!verify.verified) {
                executed.action = "acid-verification-failed";
                executed.ok = true;
                executed.detail = `השחזור עבר אך האימות נכשל (${verify.passedCount}/5) - לא הועד`;
                console.log(`[weave-ops] acid: אימות 5-מבחנים נכשל - לא הועד`);
              } else {
                const task = acid.TASKS[proof.t];
                const claim =
                  `גילוי ריבוני "${proof.t}" (${task ? task.en : "?"}) - תוכנית שנמצאה בחיפוש אבולוציוני ` +
                  `בדפדפן המפעיל, שוחזרה בענן מהמתכון החתום (hash זהה ${proof.h}) ואומתה ${verify.passedCount}/5 מבחנים` +
                  (cmd.note ? ` · דבר המגלה: "${cmd.note}"` : "");
                const testSummary = verify.tests.map((t) => `${t.id}:${t.pass ? "ok" : "FAIL"}`).join(" ");
                const evidence = [
                  `proof=${JSON.stringify(proof)}`,
                  `reproduced=cloud (deterministic, ${ms}ms)`,
                  `hash=${rerun.hash}`,
                  `verification=${testSummary} (${verify.passedCount}/5)`,
                  `programLen=${rerun.program.instructions.length}`,
                  `evals=${rerun.evals}`,
                  `authority=posting (custom_json)`,
                  `opId=${OPS_OP_ID}`,
                  `txid=${cmd.txid}`,
                  cmd.block ? `block=${cmd.block}` : null,
                  `cmdId=${cmd.id}`,
                  `explorer=https://steemscan.com/transaction/${cmd.txid}`,
                  `runner=${ctx.runner}`,
                  `commit=${ctx.gitHead}`,
                  ctx.runUrl ? `run=${ctx.runUrl}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const att = await appendAttestation({
                  agentId: ctx.cloudAgentId,
                  claim,
                  claimType: "DISCOVERY",
                  evidence,
                });
                result.attSeqs.push(att.seq);
                executed.action = `DISCOVERY attestation att${att.seq}`;
                executed.ok = true;
                executed.detail = `${proof.t} · ${proof.h} · ${verify.passedCount}/5`;
                console.log(`[weave-ops] acid -> DISCOVERY att${att.seq} · ${proof.t} · hash ${proof.h} · שוחזר בענן`);
              }
            }
          }
        }
      } else if (cmd.cmd === "console") {
        if (ctx.runner === "github-actions" && opsPat) {
          const d = await dispatchWorkflow(`${OWNER}/Console`, "console-publish.yml", opsPat);
          executed.action = "dispatch Console/console-publish";
          executed.ok = d.ok;
          executed.detail = d.detail;
          console.log(`[weave-ops] console -> dispatch משואה ציבורית: ${d.ok ? "שוגרה" : `נכשל - ${d.detail}`}`);
        } else {
          executed.action = "dispatch console (no PAT - skipped honestly)";
          executed.ok = true;
          executed.detail = "runner without WEAVE_OPS_PAT";
          console.log(`[weave-ops] console · דילוג-כנה (אין WEAVE_OPS_PAT בסביבה)`);
        }
      } else if (cmd.cmd.startsWith("saos.")) {
        // SAOS currency commands: the operator orders, the treasury signs.
        // The command (posting-signed by the operator) says what to do. The
        // cloud builds the SAOS op, signs it with the treasury key
        // (WEAVE_STEEM_WIF, the identity derived from the witness line
        // posting key) and broadcasts to saos.weave.live.v1. Every node
        // folds and verifies: the signature is the authority.
        const saos = cmd.saos;
        if (!saos) {
          executed.action = "saos-without-payload";
          executed.ok = true;
          executed.detail = "saos command without a valid payload, ignored honestly";
          console.log(`[weave-ops] ${cmd.cmd} without valid payload, honest ignore`);
        } else {
          // Genesis guard: without a registered treasury on chain the fold
          // would reject the op. The command stays pending and will run on
          // the beat after the treasury is born.
          let genesisDone = false;
          try {
            const st = JSON.parse(fs.readFileSync(SAOS_STATE_PATH, "utf8")) as { genesis?: { done?: boolean } };
            genesisDone = Boolean(st?.genesis?.done);
          } catch {
            /* no file means genesis is certainly not done */
          }
          const wif = (process.env.WEAVE_STEEM_WIF || "").trim();
          if (!genesisDone) {
            executed.action = "saos-waiting-genesis";
            executed.ok = true;
            executed.detail = "live ledger genesis not complete yet, command waits for the treasury";
            console.log(`[weave-ops] ${cmd.cmd} waits for genesis, will run again next beat`);
            continue; // not recorded: the command stays pending for the next beat
          }
          if (!wif) {
            executed.action = "saos-no-treasury-key";
            executed.ok = true;
            executed.detail = "no WEAVE_STEEM_WIF in this environment, only the cloud can sign as treasury";
            console.log(`[weave-ops] ${cmd.cmd} honest skip, no treasury key`);
          } else {
            const GateCrypto = await import("../../../console/gate-crypto.js");
            const SaosLive = await import("../../../console/saos-live.js");
            const priv = await GateCrypto.wifToPriv(wif);
            const pubSTM = await GateCrypto.pubToSTM(GateCrypto.privToPubBytes(priv));
            const treasury = await SaosLive.addressFromPubSTM(pubSTM);
            const kindByCmd: Record<string, string> = {
              "saos.credit": "deposit.credit",
              "saos.addr": "cfg.addr",
              "saos.rate": "cfg.rate",
              "saos.fill": "dex.fill",
              "saos.reward": "reward.pay",
            };
            const k = kindByCmd[cmd.cmd];
            const env = await SaosLive.buildOp(priv, pubSTM, { k, ...saos });
            const gate = await steemRcGate(WITNESS_ACCOUNT);
            if (!gate.ok) {
              executed.action = "saos-rc-gated";
              executed.ok = true;
              executed.detail = `RC low (${gate.reason ?? "gated"}), command will run again next beat`;
              console.log(`[weave-ops] ${cmd.cmd} honestly gated on RC, will run again`);
              continue; // not recorded: the command stays pending for the next beat
            }
            const txOps = [[
              "custom_json",
              {
                required_auths: [],
                required_posting_auths: [WITNESS_ACCOUNT],
                id: SAOS_LIVE_OP_ID,
                json: JSON.stringify(env),
              },
            ]] as unknown as import("steem").GrapheneOperation[];
            const res = await steemBroadcast(txOps, wif);
            executed.action = `saos ${k} treasury-signed`;
            executed.ok = Boolean(res.txid);
            executed.detail = res.txid
              ? `tx ${res.txid.slice(0, 14)}... treasury ${treasury.slice(0, 12)}... fold picks it up this or next beat`
              : `broadcast failed: ${res.note ?? "?"}`;
            console.log(`[weave-ops] ${cmd.cmd} -> ${k} treasury-signed and broadcast ${res.txid ? "ok (tx " + res.txid.slice(0, 12) + "...)" : "failed"}`);
            if (res.txid) {
              // short wait for block inclusion so the SAOS fold step in
              // this same beat can pick the op up
              await new Promise((r) => setTimeout(r, 8000));
            }
          }
        }
      } else {
        executed.action = "ignored-unknown-cmd";
        executed.ok = true;
        executed.detail = `cmd="${cmd.cmd}" אינה בסט הפקודות (ping/beat/anchor/console/acid/saos.*)`;
        console.log(`[weave-ops] פקודה לא מוכרת "${cmd.cmd}" - נרשמה כמתעלמת בכנות`);
      }
    } catch (e) {
      executed.ok = false;
      executed.detail = e instanceof Error ? e.message.slice(0, 160) : String(e);
      console.log(`[weave-ops] פקודה ${cmd.cmd} (${cmd.id}) נכשלה - ${executed.detail}`);
    }
    log.executed[cmd.id] = executed;
    result.executed.push(executed);
  }

  saveOpsLog(log);

  // אימותי OPERATOR שנכתבו - מכוסים מיידי ב-checkpoint (העוגנים יעידו)
  if (result.attSeqs.length > 0) {
    const cp = await createCheckpointNow();
    if (cp) {
      result.checkpoint = { index: cp.index, root: cp.root };
      console.log(`[weave-ops] checkpoint #${cp.index} מכסה את אימותי המפעיל (att ${cp.attFrom}..${cp.attTo})`);
    }
  }
  // ניקוי עדין: רשומות מעל 30 יום מתנקות מה-log (השרשרת + הגיט הם הארכיון)
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const ids = Object.keys(log.executed);
  let pruned = 0;
  for (const id of ids) {
    if (Date.parse(log.executed[id].executedAt) < monthAgo) {
      delete log.executed[id];
      pruned++;
    }
  }
  if (pruned > 0) {
    saveOpsLog(log);
    console.log(`[weave-ops] ${pruned} רשומות בנות-חודש+ נוקו מה-log (השרשרת היא הארכיון)`);
  }

  return result;
}
