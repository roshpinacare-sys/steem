#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-secret — מנהל הסודות של הבית הריבוני (G3)
//
// משמרת הייצור: הענן (GitHub Actions) קורא את סודותיו מ-Actions Secrets.
// הסוד מוצפן בצד הלקוח ב-sealed box (libsodium crypto_box_seal —
// הרפרנס הרשמי של גיטהאב) עם המפתח הציבורי של הריפו — רק גיטהאב יכול לפתוח.
//
// ה-PAT נלקח מ-remote URL (x-access-token) ולעולם לא נדפס במלואו.
//
// שימוש:
//   bun scripts/weave-secret.ts --list
//   bun scripts/weave-secret.ts --set NAME            # הערך מה-stdin (מומלץ)
//   bun scripts/weave-secret.ts --set NAME --value V  # זהירות: נשאר בהיסטוריית shell
//   bun scripts/weave-secret.ts --delete NAME
// ─────────────────────────────────────────────────────────────────────

import sodium from "libsodium-wrappers";
import { execSync } from "child_process";
import * as fs from "fs";
import * as readline from "readline";

const REPO = process.env.WEAVE_REPO || "roshpinacare-sys/Zip";

/** ה-PAT מה-remote — אף פעם לא מודפס, רק משמש ל-header */
function pat(): string {
  let url = "";
  try {
    url = execSync("git remote get-url origin", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("אין remote origin — הרץ מתוך clone של הבית הריבוני");
  }
  const m = url.match(/x-access-token:([^@]+)@/);
  if (!m) throw new Error("אין PAT ב-remote URL — שים x-access-token ב-remote או הגדר WEAVE_PAT");
  return m[1];
}

async function gh(method: string, apiPath: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* 204 בלי גוף — תקין */
  }
  return { status: res.status, json };
}

/** המפתח הציבורי של הריפו להצפנת סודות */
export async function getRepoPublicKey(): Promise<{ keyId: string; key: string }> {
  const r = await gh("GET", `/repos/${REPO}/actions/secrets/public-key`);
  if (r.status !== 200 || !r.json) {
    throw new Error(`public-key נכשל (${r.status}): ${JSON.stringify(r.json)}`);
  }
  return { keyId: String(r.json.key_id), key: String(r.json.key) };
}

/** הצבת/עדכון סוד — הצפנה מקומית ב-sealed box לפני השליחה */
export async function setSecret(name: string, value: string): Promise<number> {
  if (!value || value.length === 0) throw new Error("ערך ריק — לא הוצב סוד");
  await sodium.ready; // wasm אחת לתהליך
  const pk = await getRepoPublicKey();
  const binKey = sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), binKey);
  const encryptedValue = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
  const r = await gh("PUT", `/repos/${REPO}/actions/secrets/${encodeURIComponent(name)}`, {
    encrypted_value: encryptedValue,
    key_id: pk.keyId,
  });
  // 201 = נוצר · 204 = עודכן
  if (r.status !== 201 && r.status !== 204) {
    throw new Error(`הצבת הסוד ${name} נכשלה (${r.status}): ${JSON.stringify(r.json)}`);
  }
  return r.status;
}

export async function listSecrets(): Promise<Array<{ name: string; updatedAt: string }>> {
  const r = await gh("GET", `/repos/${REPO}/actions/secrets`);
  if (r.status !== 200 || !r.json) {
    throw new Error(`רשימת סודות נכשלה (${r.status}): ${JSON.stringify(r.json)}`);
  }
  const secrets = (r.json.secrets as Array<Record<string, unknown>>) ?? [];
  return secrets.map((s) => ({
    name: String(s.name),
    updatedAt: String(s.updated_at),
  }));
}

export async function deleteSecret(name: string): Promise<number> {
  const r = await gh("DELETE", `/repos/${REPO}/actions/secrets/${encodeURIComponent(name)}`);
  if (r.status !== 204) {
    throw new Error(`מחיקת הסוד ${name} נכשלה (${r.status}): ${JSON.stringify(r.json)}`);
  }
  return r.status;
}

/** קריאת ערך מה-stdin בלי שיישמר בהיסטוריית ה-shell */
async function readStdin(): Promise<string> {
  const stat = fs.fstatSync(0);
  if (stat.isFIFO() || !stat.isFile()) {
    const rl = readline.createInterface({ input: process.stdin });
    let value = "";
    for await (const line of rl) value += line;
    rl.close();
    return value.trim();
  }
  const data = fs.readFileSync(0, "utf8");
  return data.trim();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] ?? "--list";

  if (mode === "--list") {
    const secrets = await listSecrets();
    console.log(`סודות הריפו (${REPO}): ${secrets.length}`);
    for (const s of secrets) console.log(`  · ${s.name} — עודכן ${s.updatedAt}`);
    return;
  }

  if (mode === "--set") {
    const name = args[1];
    if (!name) throw new Error("שימוש: --set NAME [--value V] (ברירת מחדל: stdin)");
    const valueIdx = args.indexOf("--value");
    const value =
      valueIdx !== -1 && args[valueIdx + 1]
        ? args[valueIdx + 1]
        : await readStdin();
    const status = await setSecret(name, value);
    console.log(`הסוד ${name} ${status === 201 ? "נוצר" : "עודכן"} ב-${REPO} (sealed box, key_id מהריפו)`);
    return;
  }

  if (mode === "--delete") {
    const name = args[1];
    if (!name) throw new Error("שימוש: --delete NAME");
    await deleteSecret(name);
    console.log(`הסוד ${name} נמחק מ-${REPO}`);
    return;
  }

  throw new Error(`מצב לא מוכר: ${mode}`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("SECRET-ERROR:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
