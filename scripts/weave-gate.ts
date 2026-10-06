// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-gate — שער הסודות הקנוני (מקור אחד לכל הדוחפים)
//
// לקח מכשלון 2026-09-15 06:13: הרשימה הלבנה חיה בשלושה עותקים —
// הלב עודכן ב-payloadHash (Task 22) אבל שני קווי העיגון לא — וכל
// סליקת שוק חסמה את הדחיפה שלהם במשך שעות. מעתה: הגדרה אחת,
// מיובאת ע"י weave-beat · weave-anchor · weave-anchor-zero.
//
// דוקטרינה בלתי-מתפשרת: לא דוחפים לעולם מפתח-פרטי/WIF/PAT.
// חריגה מבוקרת: שדות hash ציבוריים (0x+64hex תחת שם שדה קנוני)
// מוסרים מה-diff לפני השער — הם אינם סוד וכל צד שלישי מאמת אותם
// מחדש מהשרשרות הציבוריות. כל שורה אחרת שמכילה 64hex — כולל
// devKeyHex אמיתי או ערך חשוד בטקסט — נשארת ונתפסת ע"י השער.
// ─────────────────────────────────────────────────────────────────────

import { execSync } from "child_process";

export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "steem/hive WIF", re: /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: "blurt WIF", re: /\bB[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: "EVM private key (64hex)", re: /\b0x[0-9a-fA-F]{64}\b/ },
  { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "github_pat token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "x-access-token url", re: new RegExp("x-access-token:[A-Za-z0-9_\\-]+@") },
];

// שדות hash ציבוריים קנוניים — שרשרת/Merkle/שוק/קווי-עוגן. איחוד של
// כל הרשימות שחיו עד כה + payloadHash שחסר לקווי העיגון (שורש הכשל).
// + שדות כספת-המוח (Task 25): encKey/keyIv/keyTag הם צופן GCM תחת
// גזירת מפתח-הרשת — חסרי-ערך בלי ה-seal, בדיוק כמו calldata/sig.
// בלי הרשימה הזו hex ארוך של encKey עלול להיתפס חיובי-שקר כ-WIF
// (5 + 50 תווים ללא אפס — הסתברות נמוכה אך מדידה).
const KNOWN_HASH_FIELDS =
  /"(entryHash|root|prevRoot|prevHash|headHash|digest|recomputedHead|evidenceHash|leaf|sha256|id|payloadHash|txid|anchorTx|stateRoot|genesisHash|lastBlockHash|dataHex|payload|zeroTxid|recoveredTxid|sig|calldata|explorer|inputHex|encKey|keyIv|keyTag|evidence)"\s*:/i;
const KNOWN_HASH_KV =
  /(headHash|recomputedHead|root|entryHash|digest|prevHash|payloadHash|txid|anchorTx|stateRoot|genesisHash|lastBlockHash|dataHex|zeroTxid|recoveredTxid|explorer|encKey|keyIv|keyTag)=/i;
// + r121 · שדה הראיה (evidence): מכולה-ציבורית חתומה — ה-evidenceHash של
//   הספר מכסה אותה במלואה (hashText(evidence) חייב להתאים); חקירת
//   charter-restore נתפסה כ-64hex חשוד רק בגלל ציטוט-המילוט של ה-JSON
//   הפנימי. אותה מחלקת-אמון כמו sig/calldata: תוכן נמדד, לא סוד.
// קישור סייר ציבורי — ה-txid בתוכו היא בדיוק הראיה הפומבית (zscan לקו
// ה-ZERO, etherscan לעוגן ה-Ethereum ההיסטורי של הצי — אותה דוקטרינה)
const KNOWN_EXPLORER_URL = /(zscan\.live\/tx\/|etherscan\.io\/tx\/)0x[0-9a-fA-F]{64}/i;

// שדות כספת-המוח (Task 25) — מוסרים מה-diff לפני השער גם בלי 0x64hex
// בשורה: encKey הוא hex טהור (בלי 0x), ומחרוזת hex ארוכה עלולה
// להיתפס חיובי-שקר כ-WIF (5 + 50 תווים ללא אפס). הצופן חסר-ערך
// בלי מפתח-הרשת שב-seal — אותה מחלקה של calldata/sig, בלי הקידומת.
const KNOWN_VAULT_FIELDS = /"(encKey|keyIv|keyTag|fingerprint)"\s*:/;

export function filterKnownHashes(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => {
      if (KNOWN_VAULT_FIELDS.test(line)) return false;
      if (!/0x[0-9a-fA-F]{64}/.test(line)) return true; // אין 64hex — נשארת
      if (KNOWN_EXPLORER_URL.test(line)) return false;
      if (KNOWN_HASH_FIELDS.test(line) || KNOWN_HASH_KV.test(line)) return false;
      return true; // 64hex לא מוכר — נשארת ותיבדק בשער
    })
    .join("\n");
}

export function secretGate(stagedDiff: string): string | null {
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(stagedDiff)) return p.name;
  }
  return null;
}

// ── דחיפה עמידה למרוצים — הלקח ממחזור השעה (Task 24) ─────────────────
// במחזור שעתי שני קווים עשויים לדחוף באותו רגע; דחיפה שנדחית
// (fetch first) אינה כישלון — היא מירוץ. מיישרים rebase ומנסים שוב.
// ליבול כלום בשקט: אחרי 3 ניסיונות הריצה מאדימה בכנות (העוגן
// עצמו כבר on-chain; המחזור הבא או --recover יתבעו אותו).
export function gitPushRetry(root: string, branch: string): string {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // git push כותב הכל ל-stderr — מיזוג 2>&1 כדי שהפלט יהיה כנה ונראה
      const out = execSync(`git push origin ${branch} 2>&1`, {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
      return out.trim() || "up-to-date";
    } catch (e) {
      lastErr = String((e as { stderr?: Buffer })?.stderr ?? e).slice(0, 300);
      // מרוץ דחיפות — מיישר מול ה-remote ומנסה שוב; שגיאת rebase תיתפס
      // בניסיון הבא ותיזרק בכנות בסוף
      try {
        execSync(`git pull --rebase origin ${branch} --no-edit`, {
          cwd: root,
          encoding: "utf8",
          timeout: 60_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        /* הניסיון הבא יחשוף */
      }
    }
  }
  throw new Error(
    `הדחיפה נכשלה לאחר 3 ניסיונות (מרוץ דחיפות במחזור השעתי — שום דבר לא אבד: העוגן on-chain, המחזור הבא/--recover יתבע): ${lastErr}`
  );
}
