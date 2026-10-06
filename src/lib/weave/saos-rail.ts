// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · SAOS-LIVE Withdrawal Rail (R104)
//
// הוראת המפעיל (R103 lastHandoff): "רייל SAOS-LIVE חוצה-שרשרת — שלב
// מתועד". זה הרייל: משיכת SAOS מהזירה הריבונית אל כתובת רשומה על
// שרשרת SAOS-LIVE החיה.
//
// החוקה:
//   · הזירה שורפת את התביעה הפנימית (adjust SAOS -amount) ואז
//     משדרת token.transfer חתום מהאוצר על SAOS-LIVE — הגיבוי עוזב
//     את הכיסוי הפנימי ונהיה נכס שרשרת של המושך.
//   · המפתח נגזר בזיכרון-הרצה בלבד מהכספת הריבונית
//     (סיסמת-אב → active חי → חותמת → מפתח-אב → AES-256-GCM) —
//     אותו נתיב שהוכח ב-R99; אפס מפתח בדיסק, אפס בקשה למפעיל.
//   · השרשרת היא השופט: לפני שידור מקופל המצב החי — הכתובת
//     חייבת להיות רשומה (wallet.create) ומאזן האוצר חייב לכסות.
//     ה-relayer (cashmachine) הוא תעבורה בלבד: אין לו יכולת
//     לזייף, כל צומת מאמת כל חתימה.
//   · שער-RC לפני שידור (אותה משמעת כמו קווי העוגן) ושער-$100
//     מכסה את הפעולה בקריאה החיצונית (sovereign-exchange.withdraw).
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import path from "node:path";
import { readLiveEnvelopes } from "./saoslite";
import { openVaultKey } from "@/lib/dex/wallet-vault";
import { steemBroadcast, steemRcGate } from "./graphene";

const HOME = "/home/z/my-project";
const nodeRequire = createRequire(path.join(HOME, "package.json"));
const WITNESS = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const OPERATOR = (process.env.WEAVE_OPERATOR_ACCOUNT || "headcorner").toLowerCase();
const SAOS_LIVE_OP_ID = "saos.weave.live.v1";

type GateCryptoModule = typeof import("../../../console/gate-crypto.js");
type SaosLiveModule = typeof import("../../../console/saos-live.js");

async function libs(): Promise<{ C: GateCryptoModule; S: SaosLiveModule }> {
  const C = (await import("../../../console/gate-crypto.js")) as unknown as GateCryptoModule;
  const S = (await import("../../../console/saos-live.js")) as unknown as SaosLiveModule;
  return { C, S };
}

/** זהות-אוצר SAOS-LIVE — נגזרת ממפתח ה-posting של קו העדות בכספת.
 *  אימות מובנה: הפומבי הנגזר חייב להיות הפומבי הרשום בכספת (חוק
 *  השרשרת-השופט) והכתובת חייבת להיות האוצר מהג'נזיס שעל השרשרת. */
export async function treasuryIdentity(): Promise<
  | { ok: true; treasuryAddr: string; pubSTM: string; priv: Uint8Array; wif: string }
  | { ok: false; detail: string }
> {
  const v = openVaultKey("steem", WITNESS, "posting");
  if (!v.ok || !v.wif) return { ok: false, detail: `NO-KEY: ${v.detail}` };
  try {
    const { C, S } = await libs();
    const priv = await C.wifToPriv(v.wif);
    const pubSTM = await C.pubToSTM(C.privToPubBytes(priv));
    if (v.pub && v.pub !== pubSTM) {
      return { ok: false, detail: `KEY-MISMATCH: הנגזר ${pubSTM.slice(0, 12)}… ≠ הרשום ${String(v.pub).slice(0, 12)}… — לא נוגעים במפתח חשוד` };
    }
    const treasuryAddr = await S.addressFromPubSTM(pubSTM);
    return { ok: true, treasuryAddr, pubSTM, priv, wif: v.wif };
  } catch (e) {
    return { ok: false, detail: `IDENTITY-ERROR: ${String((e as Error).message ?? e).slice(0, 120)}` };
  }
}

/** קיפול השרשרת החיה — חסר-מפתח לחלוטין. הצומת הוא השופט.
 *  האוצר נמסר מפורש (נגזר מזהות-המפתח) — לא נורשים מסדר-רישום. */
export async function foldLiveState(expectedTreasury?: string): Promise<{
  ok: boolean;
  node: string;
  envelopes: number;
  stateRoot: string;
  wallets: Record<string, unknown>;
  treasuryAddr: string | null;
  treasuryBalSaos: number;
  invalidCount: number;
  detail?: string;
}> {
  try {
    const { S } = await libs();
    const { envelopes, node } = await readLiveEnvelopes();
    const r = await S.fold(envelopes.map((e) => e.env));
    const treasuryAddr = expectedTreasury ?? null;
    const treasuryBal = treasuryAddr ? Number(r.state.bal[treasuryAddr]?.SAOS ?? BigInt(0)) / 1000 : 0;
    return {
      ok: r.ok,
      node,
      envelopes: envelopes.length,
      stateRoot: r.stateRoot,
      wallets: r.state.wallets,
      treasuryAddr,
      treasuryBalSaos: treasuryBal,
      invalidCount: r.invalid?.length ?? 0,
    };
  } catch (e) {
    return {
      ok: false, node: "?", envelopes: 0, stateRoot: "?", wallets: {}, treasuryAddr: expectedTreasury ?? null,
      treasuryBalSaos: 0, invalidCount: 0, detail: `FOLD-ERROR: ${String((e as Error).message ?? e).slice(0, 120)}`,
    };
  }
}

/** הרשמת ארנק-שרשרת לחשבון STEEM שבכספת (ברירת-מחדל: המפעיל).
 *  הכתובת self-certifying: מי שמחזיק במפתח ה-posting — שלו הארנק.
 *  אידמפוטנטי: אם הכתובת כבר רשומה — דילוג-כנה. */
export async function saosLiveRegisterWallet(opts?: {
  account?: string;
  nick?: string;
}): Promise<{ ok: boolean; addr?: string; txid?: string; note: string }> {
  const account = (opts?.account ?? OPERATOR).toLowerCase();
  const nick = opts?.nick ?? account;
  const v = openVaultKey("steem", account, "posting");
  if (!v.ok || !v.wif) return { ok: false, note: `NO-KEY: ${v.detail}` };
  try {
    const { C, S } = await libs();
    // הכספת מחזיקה גם עותק-עבר — מאמתים שהנגזר הוא החי (השופט: השרשרת עצמה, בפועל — הרשום-verified)
    if (v.pub && v.pub !== (await C.pubToSTM(C.privToPubBytes(await C.wifToPriv(v.wif))))) {
      return { ok: false, note: "KEY-MISMATCH: הנגזר אינו הרשום — לא נוגעים" };
    }
    const priv = await C.wifToPriv(v.wif);
    const pubSTM = await C.pubToSTM(C.privToPubBytes(priv));
    const addr = await S.addressFromPubSTM(pubSTM);

    // השרשרת היא השופט: רשום כבר? דילוג כנה
    const live = await foldLiveState(addr);
    if (!live.ok) return { ok: false, addr, note: `FOLD-FAIL: ${live.detail ?? "?"}` };
    if (live.wallets[addr]) return { ok: true, addr, note: "כבר רשום על השרשרת — אין מה לעשות" };

    const env = await S.buildOp(priv, pubSTM, { k: "wallet.create", nick });
    const gate = await steemRcGate(account);
    if (!gate.ok) return { ok: false, addr, note: `RC-GATED: ${gate.reason ?? "?"} — ננסה שוב בהמשך` };
    const txOps = [[
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [account],
        id: SAOS_LIVE_OP_ID,
        json: JSON.stringify(env),
      },
    ]] as unknown as [string, Record<string, unknown>][];
    const res = await steemBroadcast(txOps as never, v.wif);
    if (!res.txid) return { ok: false, addr, note: `BROADCAST-FAIL: ${res.note ?? "?"}` };
    return { ok: true, addr, txid: res.txid, note: `wallet.create שודר — הקיפול יזקוף בבלוק הבא` };
  } catch (e) {
    return { ok: false, note: `REGISTER-ERROR: ${String((e as Error).message ?? e).slice(0, 120)}` };
  }
}

/** משיכת SAOS מהזירה החיצונית — השרשרת היא השופט:
 *  1) הכתובת חייבת להיות רשומה על SAOS-LIVE (אחרת האופ יידחה בקיפול)
 *  2) מאזן האוצר על השרשרת חייב לכסות (הקיפול ידחה אם לא)
 *  3) שער-RC לפני השידור
 *  הקריאה שורפת את התביעה הפנימית רק אחרי קבלה — ומחזירה אותה בכנות אם
 *  השידור נפל (אותו חוק כמו ריילי HIVE/BLURT בזירה). */
export async function saosLiveTransferOut(params: {
  toAddress: string;
  amount: number;
}): Promise<{ ok: boolean; txid?: string; note: string; treasuryAddr?: string; envelopeId?: string }> {
  const { toAddress, amount } = params;
  if (!(amount > 0)) return { ok: false, note: "BAD-AMOUNT" };
  if (!/^saos1[1-9A-HJ-NP-Za-km-z]{33,35}$/.test(toAddress)) {
    return { ok: false, note: "BAD-ADDRESS: כתובת SAOS שגויה (צורה saos1…)" };
  }
  const units = Math.round(amount * 1000); // SAOS — 3 ספרות
  if (units <= 0) return { ok: false, note: "BAD-AMOUNT: מתחת לרזולוציית השרשרת (0.001)" };

  const id = await treasuryIdentity();
  if (!id.ok) return { ok: false, note: id.detail };
  const live = await foldLiveState(id.treasuryAddr);
  if (!live.ok) return { ok: false, note: `FOLD-FAIL: ${live.detail ?? "?"}` };
  if (live.wallets[id.treasuryAddr] == null) {
    return { ok: false, note: `NO-TREASURY-WALLET: האוצר ${id.treasuryAddr.slice(0, 16)}… אינו רשום על השרשרת — אין קנון לשידור ממנו`, treasuryAddr: id.treasuryAddr };
  }
  if (!live.wallets[toAddress]) {
    return { ok: false, note: `NO-RECIPIENT: הכתובת ${toAddress.slice(0, 16)}… אינה רשומה על SAOS-LIVE — הרשמה (wallet.create) היא חלק מהריבונות של המושך` };
  }
  if (live.treasuryBalSaos + 1e-9 < amount) {
    return { ok: false, note: `INSUFFICIENT: לאוצר ${live.treasuryBalSaos} SAOS על השרשרת — אין שידור` };
  }

  try {
    const { S } = await libs();
    const env = await S.buildOp(id.priv, id.pubSTM, {
      k: "token.transfer",
      symbol: "SAOS",
      to: toAddress,
      amount: String(units),
    });
    const envelopeId = String((env as Record<string, unknown>).id ?? "");
    const gate = await steemRcGate(WITNESS);
    if (!gate.ok) return { ok: false, note: `RC-GATED: ${gate.reason ?? "?"} — ננסה שוב בהמשך`, treasuryAddr: id.treasuryAddr };
    const txOps = [[
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [WITNESS],
        id: SAOS_LIVE_OP_ID,
        json: JSON.stringify(env),
      },
    ]] as unknown as [string, Record<string, unknown>][];
    const res = await steemBroadcast(txOps as never, id.wif);
    if (!res.txid) {
      return { ok: false, note: `BROADCAST-FAIL: ${res.note ?? "?"} — התביעה הפנימית הוחזרה`, treasuryAddr: id.treasuryAddr };
    }
    return {
      ok: true,
      txid: res.txid,
      note: `token.transfer שודר מהאוצר — הקיפול יזקוף בבלוק הבא`,
      treasuryAddr: id.treasuryAddr,
      envelopeId,
    };
  } catch (e) {
    return { ok: false, note: `RAIL-ERROR: ${String((e as Error).message ?? e).slice(0, 120)}`, treasuryAddr: id.treasuryAddr };
  }
}

/** כתובת SAOS של חשבון STEEM מהכספת — לתצוגה ולהזמנות (נטולת-שידור). */
export async function saosAddressOf(account: string): Promise<{ ok: boolean; addr?: string; detail?: string }> {
  const v = openVaultKey("steem", account.toLowerCase(), "posting");
  if (!v.ok || !v.wif) return { ok: false, detail: v.detail };
  try {
    const { C, S } = await libs();
    const priv = await C.wifToPriv(v.wif);
    const pubSTM = await C.pubToSTM(C.privToPubBytes(priv));
    if (v.pub && v.pub !== pubSTM) return { ok: false, detail: "KEY-MISMATCH — כספת מחזיקה עותק-עבר" };
    const addr = await S.addressFromPubSTM(pubSTM);
    return { ok: true, addr };
  } catch (e) {
    return { ok: false, detail: String((e as Error).message ?? e).slice(0, 120) };
  }
}
