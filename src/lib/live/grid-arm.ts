// ─────────────────────────────────────────────────────────────────────
// grid-arm — אטימת סוד-ריפו מוצפן (GitHub Actions Secrets).
//
// השימוש היחיד: חימום הגריד החוץ. המפתח שהמפעיל מזין (לאחר שאומת
// מול הרשות החיה של השרשרת) נאטם ב-crypto_box_seal (libsodium) אל
// הכספת המוצפנת של הריפו — ולא נשמר בשום מקום אחר: לא דיסק, לא לוג,
// לא תשובה. האטימה מפתח-הציבור של הריפו עצמו — רק ה-Actions של
// הריפו יכולים לפתוח.
// ─────────────────────────────────────────────────────────────────────

import sodium from "libsodium-wrappers";
import { getGhToken } from "@/lib/live/cloud";

const GH_API = "https://api.github.com";

export interface RepoSecretMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** רשימת שמות-הסודות בריפו (לעולם לא הערכים — ה-API לא מחזיר אותם כלל). */
export async function listRepoSecrets(repo: string): Promise<RepoSecretMeta[]> {
  const token = await getGhToken();
  if (!token) throw new Error("no-server-credential");
  const res = await fetch(`${GH_API}/repos/roshpinacare-sys/${repo}/actions/secrets?per_page=100`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
    // R112 — law of the bounded wait: no fetch without a deadline
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`secrets-list-${res.status}`);
  const j = (await res.json()) as { secrets?: Array<{ name: string; created_at: string; updated_at: string }> };
  return (j.secrets ?? []).map((s) => ({ name: s.name, createdAt: s.created_at, updatedAt: s.updated_at }));
}

/** אטימת הערך בכספת הריפו: sealed-box מפתח-הציבור של הריפו. */
export async function putRepoSecret(repo: string, name: string, value: string): Promise<void> {
  const token = await getGhToken();
  if (!token) throw new Error("no-server-credential");
  await sodium.ready;

  const pkRes = await fetch(`${GH_API}/repos/roshpinacare-sys/${repo}/actions/secrets/public-key`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!pkRes.ok) throw new Error(`public-key-${pkRes.status}`);
  const pk = (await pkRes.json()) as { key_id: string; key: string };

  const binPub = sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL);
  const binVal = sodium.from_string(value);
  const sealed = sodium.crypto_box_seal(binVal, binPub);
  const encrypted_value = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

  const put = await fetch(`${GH_API}/repos/roshpinacare-sys/${repo}/actions/secrets/${name}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!put.ok && put.status !== 201 && put.status !== 204) {
    throw new Error(`secret-put-${put.status}`);
  }
}

/** המצב החי של הגריד מהקונסולה הציבורית — קריאה חסרת-מפתח. */
export interface GridState {
  publishedAt: string;
  armed: boolean;
  verdict: string;
  blocker?: string[];
  fuel?: {
    powerdownActive: boolean;
    weeklySp?: number;
    weeklyUsd?: number;
    nextPayout?: string;
    remainingSp?: number;
  };
  inventory?: { steem?: number; sbd?: number };
  marks?: { steemUsd?: number; sbdUsd?: number; paritySbdPerSteem?: number };
}

export async function getGridState(): Promise<GridState | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    const r = await fetch("https://roshpinacare-sys.github.io/Console/dex/grid.json", {
      signal: ac.signal,
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as GridState;
    return j;
  } catch {
    return null;
  }
}
