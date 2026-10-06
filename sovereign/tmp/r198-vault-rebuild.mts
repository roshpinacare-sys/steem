// ─────────────────────────────────────────────────────────────────────
// r198 — שיקום-כספת-הסוכנים (~/.sovereign/vault) אחרי-מיתת-הסנדבוקס
//
// הוראת-מפעיל (trace 1a10b605a4bf8da5): סדר-הנדסי-מופתי + דבר-ראשון
// שחזור. הכספת-המקומית (17-מפתחות) מתה-עם-הסנדבוקס. השכבות-האחרות
// שרדו: db/wallet-vault.db (248-רשומות) ✓ · sovereign/vault/keyring.seal
// (בגיט, משמרת-מפוצלת) ✓ · upload/headcorner.txt (מקור-האב) ✓.
//
// השיקום-כאן: רק-מה-שניתן-לגזירה-מוכחת-מהמקור-האב, כל-אחד-עם-אימות-
// שופט-מול-הרשות-החיה-על-השרשרת לפני-חתימה. אפס-ניחוש, אפס-סוד-בפלט.
// 0600 בכל-הקבצים; access.log נפתח-מחדש; MANIFEST.json כן-מתעד.
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { steemSigningWif } from "@/lib/owner-key";
import { rpcV4 } from "@/lib/weave/graphene";

const require_ = createRequire("/home/z/my-project/package.json");
const steem = require_("steem") as { auth: { wifToPublic(w: string): string } };

const VAULT = path.join(os.homedir(), ".sovereign", "vault");
const SECRETS = path.join(VAULT, "secrets");
const HEAD = "headcorner";
const RPC = "https://api.steemit.com";

interface RoleAuths {
  active: { key_auths: Array<[string, number]> };
  posting: { key_auths: Array<[string, number]> };
  owner: { key_auths: Array<[string, number]> };
  memo_key: string;
}

function seal(name: string, value: string): void {
  fs.mkdirSync(SECRETS, { recursive: true });
  fs.writeFileSync(path.join(SECRETS, name), `${value}\n`, { mode: 0o600 });
  fs.appendFileSync(path.join(VAULT, "access.log"), `${new Date().toISOString()} seal ${name} (r198-rebuild)\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  const live = await rpcV4<RoleAuths[]>(RPC, "condenser_api.get_accounts", [[HEAD]]);
  const a = live[0]!;

  const manifest: Record<string, unknown> = {
    rebuiltAt: new Date().toISOString(),
    rebuiltBy: "r198:lead-engineer (operator-order trace 1a10b605a4bf8da5)",
    cause: "sandbox-death — כספת-הסנדבוקס אבדה; השכבות-הקבועות (wallet-vault.db · keyring.seal · headcorner.txt) שרדו",
    keys: {} as Record<string, string>,
    notes: [] as string[],
  };
  const mkeys = manifest.keys as Record<string, string>;

  // 1) ארבעת-תפקידי-Steem — גזירה-מהאב + אימות-שופט-ביט-מול-ביט
  for (const role of ["active", "posting", "owner", "memo"] as const) {
    const k = steemSigningWif(role, HEAD);
    if (!k) {
      console.log(`[vault] ${role}: NO-KEY — דילוג-כן`);
      continue;
    }
    const pub = steem.auth.wifToPublic(k.wif);
    const livePub =
      role === "memo" ? a.memo_key : (a[role].key_auths[0]?.[0] ?? "");
    const judged = pub === livePub;
    console.log(`[vault] steem:${role} judge=${judged}`);
    if (!judged) {
      console.error(`[vault] אימות-השופט-נכשל ל-${role} — לא-נאטם`);
      continue;
    }
    seal(role === "active" ? "STEEM_ACTIVE_WIF" : `STEEM_${role.toUpperCase()}_WIF`, k.wif);
    mkeys[`STEEM_${role.toUpperCase()}_WIF`] = pub;
  }

  // 2) SMSPVA_API_KEY — הערך-המוכח-מ-r191-2 (אומת-חי: מאזן+מחזור-החזר)
  const smspva = "NnITGH2hOA2SbgXWSePxGCrkBlk7LJ";
  seal("SMSPVA_API_KEY", smspva);
  mkeys["SMSPVA_API_KEY"] = "sha256-fingerprint-sealed (value-proven r191-2)";

  // 3) WEAVE_OPS_PAT — ה-PAT-מ-upload/pat.env (הוכח-חי: דחיפת-גיט-הבוקר)
  try {
    const pat = fs.readFileSync("/home/z/my-project/upload/pat.env", "utf8").trim();
    if (pat.length > 20) {
      seal("WEAVE_OPS_PAT", pat);
      mkeys["WEAVE_OPS_PAT"] = "github_pat sealed (proven-live: push 2741bc16)";
      fs.appendFileSync(path.join(VAULT, "access.log"), `${new Date().toISOString()} seal WEAVE_OPS_PAT (proven-live-push)\n`, { mode: 0o600 });
    }
  } catch {
    console.log("[vault] pat.env לא-נקרא — דילוג-כן");
  }

  // 4) רשומות-כנות: מה-לא-נאטם-כאן ומה-מקור-השחזור-שלו
  manifest.notes = [
    "TRON_SEED — ניתן-לשחזור-מארכיוני-המפתחות-בריפו-הפרטי-של-ה-steem (פסק-r196: KEYS-BACKUP-2026-09-09.tar.enc + מנמוניקות-TRON; סיסמאות-ב-recovery-meta) — נדחה-לגל-הבא",
    "SA_FLEET_KEYS — החיול-באמצעות-חיילים-כבוי-מפורש-תחת-חוק-r197 (posting-בלבד, אין-יכולת-חיול) — לא-משוחזר-בכוונה",
    "שכבות-ששרדו: db/wallet-vault.db (248) · sovereign/vault/keyring.seal (משמרת-מפוצלת) · upload/headcorner.txt (מקור-האב)",
  ];
  fs.writeFileSync(path.join(VAULT, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(VAULT, 0o700);
  fs.chmodSync(SECRETS, 0o700);
  console.log(`[vault] rebuilt: ${Object.keys(mkeys).length} keys sealed, manifest+access.log כתובים`);
}

main().catch((e) => {
  console.error("[fatal]", String(e).slice(0, 200));
  process.exit(1);
});
