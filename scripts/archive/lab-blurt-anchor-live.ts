// ─────────────────────────────────────────────────────────────────────
// r184 — הוכחה-חיה: מסילת-Blurt עם החותמת הרשמית (blurtjs).
//
// שאלת-האמת: האם custom_json בסמכות-active של headcorner נכנס ל-Blurt
// כשהוא נחתם בבייטי-הסכמה הרשמיים (op-id 12) במקום בייטי-steem-js (18)?
//
// המטען: עדות-עיגון אמיתית (checkpoint חי מהספר — לא זבל-מבחן).
// השופטת: condenser_api.get_account_history — txid מהשרשרת עצמה.
// אפס-דליפה: ה-WIF נפתח מכספת-הארנק בזיכרון בלבד ולעולם לא נדפס.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { db } from "@/lib/db";
import { blurtSignTx, BLURT_RPC } from "@/lib/dex/blurt-wire";
import { rpcV4 } from "@/lib/weave/graphene";
import { openVaultKey } from "@/lib/dex/wallet-vault";

const ACCOUNT = "headcorner";
const OP_ID = "saos.weave.core.v1";
const ROOT = path.resolve(__dirname, "..");
const RECEIPT = path.join(ROOT, "sovereign", "vault", "blurt-rail-proof.json");

function gitHead(): string {
  try {
    return execSync("git rev-parse --short=12 HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const at = new Date().toISOString();

  // 1. המפתח — מהכספת הריבונית (דפוס-הענן: env ← vault-read; בזיכרון בלבד),
  //    ובנפילה: כספת-הארנק (נתיב-האב, עובד תחת node — node:sqlite)
  let wif = (process.env.BLURT_ACTIVE_WIF || "").trim();
  let via = "env (BLURT_ACTIVE_WIF ← vault-read)";
  if (!wif) {
    const v = openVaultKey("blurt", ACCOUNT, "active");
    if (v.ok && v.wif) {
      wif = v.wif;
      via = "wallet-vault (master path)";
    } else {
      console.log(`[blurt-proof] אין מפתח בסביבה והכספת לא נפתחה (${v.detail ?? "?"}) — אין שידור (כנות)`);
      process.exit(2);
    }
  }
  console.log(`[blurt-proof] מפתח נטען מ-${via} (ה-WIF לא הודפס)`);

  // 2. המטען — checkpoint חי מהספר (אותו פורמט-קנון של weave-anchor)
  const cp = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
  if (!cp) {
    console.log("[blurt-proof] אין checkpoint בספר — כניסה-כנה, אין עדות לא-אמיתית");
    process.exit(2);
  }
  const attestations = await db.attestation.count();
  const headRow = await db.attestation.findFirst({ orderBy: { seq: "desc" } });
  const payload = {
    protocol: "saos-weave-core/v1",
    action: "checkpoint",
    at,
    net: "weave-core",
    repo: "roshpinacare-sys/Zip",
    checkpoint: cp.index,
    root: cp.root,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    attestations,
    headHash: headRow?.entryHash ?? "0x" + "0".repeat(64),
    commit: gitHead(),
    runner: "r184-blurt-serializer-fix",
  };
  console.log(`[blurt-proof] מעגן cp#${cp.index} · root=${cp.root.slice(0, 16)}…`);

  // 3. ה-op — custom_json בסמכות-active (ה-active של headcorner חותם)
  const op: [string, Record<string, unknown>] = [
    "custom_json",
    {
      required_auths: [ACCOUNT],
      required_posting_auths: [],
      id: OP_ID,
      json: JSON.stringify(payload),
    },
  ];

  // 4. חתימה — blurtSignTx (הסכמה הרשמית: op-id 12, לא 18)
  const signed = await blurtSignTx([op], wif);
  const sigCount = Array.isArray(signed.signatures) ? signed.signatures.length : 0;
  console.log(`[blurt-proof] חתום בסכמת-blurtjs · signatures=${sigCount}`);

  // 5. שידור
  await rpcV4(BLURT_RPC, "condenser_api.broadcast_transaction", [signed]);
  console.log("[blurt-proof] broadcast-accepted — ממתין להיסטוריה השופטת");

  // 6. הקבלה — ההיסטוריה השופטת היחידה
  let txid: string | null = null;
  for (let i = 0; i < 6 && !txid; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const hist = await rpcV4<Array<[number, { op?: [string, { id?: string; json?: string }]; trx_id?: string }]>>(
      BLURT_RPC,
      "condenser_api.get_account_history",
      [ACCOUNT, -1, 50],
    ).catch(() => null);
    if (!hist) continue;
    for (const [, e] of hist) {
      const o = e.op;
      if (!o || o[0] !== "custom_json" || o[1]?.id !== OP_ID) continue;
      try {
        const pl = JSON.parse(String(o[1]?.json || "{}")) as { at?: string };
        if (pl.at === at) {
          txid = e.trx_id ?? null;
          break;
        }
      } catch {
        /* skip */
      }
    }
    if (!txid) console.log(`[blurt-proof] ניסיון ${i + 1}/6 — עוד לא בהיסטוריה`);
  }

  // 7. קבלה-ציבורית
  const receipt = {
    at,
    verdict: txid ? "PROVED" : "BROADCAST-ACCEPTED (history window pending)",
    txid,
    rpc: BLURT_RPC,
    account: ACCOUNT,
    authority: "active",
    opId: OP_ID,
    checkpoint: cp.index,
    root: cp.root,
    attestations,
    commit: payload.commit,
    runner: payload.runner,
    fix: {
      law: "blurtjs-schema (op-id 12) replaces steem-js-schema (op-id 18) for the Blurt rail",
      lab: "scripts/lab-blurt-serialize-diff.cjs — byte 11: 0x0c vs 0x12",
    },
  };
  fs.mkdirSync(path.dirname(RECEIPT), { recursive: true });
  fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    txid
      ? `[blurt-proof] PROVED — txid=${txid} · קבלה: ${path.relative(ROOT, RECEIPT)}`
      : `[blurt-proof] השידור התקבל בצומת אך ההיסטוריה טרם שיקפה — הקבלה בהמשך`,
  );
  if (!txid) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`[blurt-proof] נכשל — ${String((e as Error).message ?? e).slice(0, 200)}`);
    process.exit(1);
  });
