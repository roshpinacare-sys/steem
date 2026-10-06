#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · web-probe2 — מדידת מחירי-אמת לפי גודל ולפי שרשרת.
//
// הממצא מ-probe1: comment בסיסי ב-Steem = 976M RC (מת), אבל custom_json
// קטן הצליח ב-66M בלבד. השאלה: איך המחיר סקלתי בגודל ה-json?
// טריק המדידה: כישלון-RC מחזיר את "needs X RC" — מחיר מדויק בחינם.
// הנתונים: הצ׳אנקים האמיתיים של חבילת המשחקים (שום דבר מזויף).
//
// מבחנים:
//   S1/S2/S4 — custom_json ב-Steem עם 1/2/4KB מהתוכן האמיתי
//   HV1/HV4 — custom_json ב-Hive עם 1/4KB
//   HC — comment מינימלי ב-Hive (מחיר הבסיס שם)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { steemBroadcast, hiveBroadcast } from "@/lib/weave/graphene";
// GrapheneOperation מיובא מהחבילה עצמה — graphene.ts מגדיר אותו מקומית ולא מייצא
import type { GrapheneOperation } from "steem";

const ROOT = path.resolve(__dirname, "..");
const WIF = (process.env.WEAVE_STEEM_WIF || "").trim();
const ACCOUNT = "cashmachine";
const HASH = "8a9bff7a7e83346e8e05d47d23010d6b86225d29abb5e547ef361bebece52273";

// Fail-soft honest skip (E3 doctrine: a desk must never break CI when its oracle is
// unreachable). The probe is hard-wired to one archived package; when the package has
// been consumed or is absent from the checkout, the honest verdict is "nothing to
// probe" — NOT a red crash (Task 25: this lane went red daily on ENOENT at :27).
const PKG_PATH = path.join(ROOT, "sovereign", "web", "inbox", HASH, "package.b64");
if (!fs.existsSync(PKG_PATH)) {
  console.log(`[data] package.b64 missing for ${HASH.slice(0, 12)}… — honest skip (nothing to probe, oracle unreachable)`);
  process.exit(0);
}
const b64 = fs.readFileSync(PKG_PATH, "utf8").trim();
console.log(`[data] b64 len=${b64.length}`);

async function attempt(label: string, ops: GrapheneOperation[], chain: "steem" | "hive"): Promise<void> {
  if (!WIF) {
    console.log(`[${label}] DRY`);
    return;
  }
  const r = chain === "steem" ? await steemBroadcast(ops, WIF) : await hiveBroadcast(ops, WIF);
  console.log(`[${label}] ${r.txid || (r as { accepted?: boolean }).accepted ? "SUCCESS" : "FAIL"} ${r.txid ? `txid=${r.txid.slice(0, 12)}` : (r.note ?? "").slice(0, 160)}`);
}

function chunkOp(id: string, data: string): GrapheneOperation {
  return ["custom_json", {
    required_auths: [],
    required_posting_auths: [ACCOUNT],
    id,
    json: JSON.stringify({ v: 1, h: HASH, i: 0, d: data, probe: true }),
  }];
}

// Steem — גדלים עולים מהתוכן האמיתי (העטיפה [op] חובה: מערך-פעולות!)
await attempt("S1", [chunkOp("saos.web.probe2.v1", b64.slice(0, 1000))], "steem");
await attempt("S2", [chunkOp("saos.web.probe2.v1", b64.slice(0, 2000))], "steem");
await attempt("S4", [chunkOp("saos.web.probe2.v1", b64.slice(0, 4000))], "steem");

// Hive — אותם גדלים + comment בסיסי
await attempt("HV1", [chunkOp("saos.web.probe2.v1", b64.slice(0, 1000))], "hive");
await attempt("HV4", [chunkOp("saos.web.probe2.v1", b64.slice(0, 4000))], "hive");
await attempt(
  "HC",
  [["comment", {
    parent_author: "",
    parent_permlink: "saosweb",
    author: ACCOUNT,
    permlink: `saosweb-probe2-${Date.now().toString(36)}`,
    title: "SAOS WEB probe2",
    body: "probe",
    json_metadata: JSON.stringify({ app: "saos-web/1", tags: ["saosweb"] }),
  }]],
  "hive"
);

console.log("[probe2] הסתיים");
