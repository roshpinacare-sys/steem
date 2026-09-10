import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";

export const dynamic = "force-dynamic";

/**
 * 117p8-R13 — THE-GATE · קליטת-מפתחות-חיילים לפי-שם → הכספת
 *
 * המנדט (מהמפעיל): "תסדר לי מקום לטעות מפתחות חיילים לפי שם ושיהיה בכספת".
 *
 * עקרונות (זהים-לשער-הראש — קשיחים):
 *  · מפתחות-פרטיים: נקלטים-בPOST, הפומבית-הנגזרת-נבדקת-מול-השרשרת-החיה של-אותו-חייל,
 *    נשמרים-כספת-first (agent/keys/vault.json — git-ignored · 0600) — ולעולם לא
 *    חוזרים-בתשובה, בלוג או בגיט.
 *  · כלל-הזהב: לא-שומרים-מת — נשמר רק-מה-שאימת-חי מול-לפחות-שרשרת-אחת של-החייל.
 *    מיזוג-חכם: מפתחות-חיים-קודמים-בכספת-אינם-נמחקים — רק-תפקידים-שאומתו-עתה-נכנסים.
 *  · איטום-מיידי: אחרי-כתיבה מופעל fleet_vault --seal (והגרדיאן ממשיך-לאטום-אוטומטית).
 *  · מה-שנשמר-מזין-ישירות את soldier_repair.cjs (מפתחות-שליטה-נשלפים-מהכספת-בלי-הדבקה-חוזרת).
 */
const ROOT = process.cwd();
const AGENT = path.join(ROOT, "agent");
const VAULT = path.join(AGENT, "keys", "vault.json");
const AUDIT = path.join(AGENT, "soldier_auth_audit.json");
const ACCOUNT = (process.env.AGENT_ACCOUNT || "headcorner").toLowerCase();
const ROLES = ["owner", "active", "posting", "memo"] as const;
const CHAINS = ["steem", "hive"] as const;

type ChainPubs = Record<string, string>;

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return fallback;
  }
}

/* steem-js מתוך agent/node_modules */
function steemLib() {
  const req = createRequire(path.join(AGENT, "no-op.js"));
  return req(path.join(AGENT, "node_modules", "steem")) as {
    auth: { wifToPublic: (w: string) => string };
  };
}

/* פומביות-חיות של-חייל-משתי-השרשראות */
async function chainPubsOf(name: string): Promise<{ steem: ChainPubs | null; hive: ChainPubs | null }> {
  const one = async (url: string): Promise<ChainPubs | null> => {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[name]], id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      const j = (await r.json()) as { result?: Array<{ owner: { key_auths: string[][] }; active: { key_auths: string[][] }; posting: { key_auths: string[][] }; memo_key: string }> };
      const a = j.result?.[0];
      if (!a) return null;
      return { owner: a.owner.key_auths[0][0], active: a.active.key_auths[0][0], posting: a.posting.key_auths[0][0], memo: a.memo_key };
    } catch (_) {
      return null;
    }
  };
  const [steem, hive] = await Promise.all([one("https://api.steemit.com"), one("https://api.hive.blog")]);
  return { steem, hive };
}

/* אותו-פורמט-גיליון-שהוכיח-את-עצמו בשער-הראש */
function parseSheet(paste: string): { steem: Record<string, string>; hive: Record<string, string> } {
  const out = { steem: {} as Record<string, string>, hive: {} as Record<string, string> };
  let cur: "steem" | "hive" = "steem";
  for (const line of paste.split(/\r?\n/)) {
    const t = line.trim();
    if (/^HIVE$/i.test(t)) { cur = "hive"; continue; }
    if (/^STEEM$/i.test(t)) { cur = "steem"; continue; }
    const m = t.match(/^([A-Za-z_]+)\s*[=:]\s*([5JKL][1-9A-HJ-NP-Za-km-z]{50,51})\s*$/);
    if (m) out[cur][m[1].toLowerCase()] = m[2];
  }
  return out;
}

type VaultKey = { wif?: string; pub?: string };
type VaultAccount = {
  username?: string;
  tier?: string;
  mode?: string;
  chains?: string[] | Record<string, string[]>;
  keys?: Record<string, Record<string, VaultKey>>;
  addedAt?: string;
  syncedAt?: string;
  soldierIntakeAt?: string;
  note?: string;
};

/* הכספת-מכילה-שני-פורמטים-היסטוריים:
 *  · שטוח (רוב-החיילים — דור-KEYS-BACKUP): keys.owner/active/posting/memo — אוניברסלי-לשתי-השרשראות
 *  · מקונן (הראש · קליטות-חדשות): keys.steem.owner / keys.hive.owner
 * שתי-הפונקציות-למטה מנרמלות-קריאה-בלבד — לעולם לא כותבות לכספת */
function rolesOf(a: VaultAccount, c: string): Record<string, VaultKey> {
  const k = a.keys || {};
  const nested = k[c] && typeof k[c] === "object" ? (k[c] as Record<string, VaultKey>) : null;
  const flat = ("owner" in k) || ("posting" in k) ? (k as unknown as Record<string, VaultKey>) : null;
  return nested && Object.keys(nested).length ? nested : flat || {};
}
function chainsHas(a: VaultAccount, c: string): boolean {
  const ch = a.chains;
  if (Array.isArray(ch)) return ch.includes(c);
  if (ch && typeof ch === "object") return Object.keys(ch).some((k) => k === c && (Array.isArray(ch[k]) ? (ch[k] as string[]).length > 0 : true));
  return false;
}

function resealAsync(): void {
  try {
    spawn(process.execPath, [path.join(AGENT, "fleet_vault.cjs"), "--seal"], {
      cwd: AGENT,
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch (_) {
    /* הגרדיאן-יאטום-בטיק-הבא בכל-מקרה (auto-RESEAL keys-newer) */
  }
}

export async function GET() {
  try {
    const vault = readJson<{ accounts?: VaultAccount[] }>(VAULT, { accounts: [] });
    const roster = (vault.accounts || [])
      .filter((a) => String(a.username || "").toLowerCase() !== ACCOUNT)
      .map((a) => {
        const chains: Record<string, Record<string, boolean>> = {};
        for (const c of CHAINS) {
          const roles = rolesOf(a, c);
          const row: Record<string, boolean> = {};
          for (const r of ROLES) row[r] = !!roles[r]?.wif;
          row._any = ROLES.some((r) => row[r]);
          if (row._any || chainsHas(a, c)) chains[c] = row;
        }
        return {
          name: String(a.username || ""),
          tier: String(a.tier || "soldier"),
          chains,
          intakeAt: a.soldierIntakeAt || a.syncedAt || a.addedAt || null,
          rolesTotal: CHAINS.reduce((n, c) => n + ROLES.filter((r) => rolesOf(a, c)[r]?.wif).length, 0),
        };
      });

    /* שמות-הצי-מהביקורת-האחרונה — להשלמה-אוטומטית ב-UI (אפס-סודות) */
    let fleetNames: string[] = [];
    try {
      const rows = JSON.parse(fs.readFileSync(AUDIT, "utf8")) as Array<{ name?: string }>;
      fleetNames = rows.map((r) => String(r.name || "")).filter((n) => n && n.toLowerCase() !== ACCOUNT);
    } catch (_) { /* אין-ביקורת — רשימה-ריקה */ }

    return NextResponse.json({
      ok: true,
      roster,
      fleetNames: [...new Set(fleetNames)],
      seal: { enc: fs.existsSync(path.join(AGENT, "fleet_keys.enc")), meta: fs.existsSync(path.join(AGENT, "fleet_keys.meta.json")) },
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { name?: string; paste?: string };
    const name = String(body.name || "").trim().toLowerCase();
    const paste = String(body.paste || "");
    if (!/^[a-z0-9\-\.]{3,16}$/.test(name)) {
      return NextResponse.json({ ok: false, error: "שם-חשבון-לא-תקין (3-16 תווים: a-z 0-9 - .)" }, { status: 400 });
    }
    if (name === ACCOUNT) {
      return NextResponse.json({ ok: false, error: "זה-חשבון-הבית — השתמש בפאנל-ההתחברות של-הראש" }, { status: 400 });
    }
    if (!paste.trim() || paste.length > 8000) {
      return NextResponse.json({ ok: false, error: "הדבקה-ריקה או חורגת-מ-8KB" }, { status: 400 });
    }
    const sheet = parseSheet(paste);
    const pastedCount = CHAINS.reduce((n, c) => n + ROLES.filter((r) => sheet[c][r]).length, 0);
    if (pastedCount === 0) {
      return NextResponse.json({ ok: false, error: "לא-זוהו-מפתחות — פורמט: OWNER = 5H… (שורה-לכל-תפקיד · מקטע HIVE אופציונלי)" }, { status: 400 });
    }

    const chain = await chainPubsOf(name);
    if (!chain.steem && !chain.hive) {
      return NextResponse.json({ ok: false, error: "השרשראות-לא-נענו-עבור @" + name + " — לא-נשמר-דבר (נסה-שוב)" }, { status: 502 });
    }

    const lib = steemLib();
    const verify: { steem: Record<string, boolean>; hive: Record<string, boolean> } = { steem: {}, hive: {} };
    const pubs: { steem: Record<string, string>; hive: Record<string, string> } = { steem: {}, hive: {} };
    let liveMatches = 0;
    for (const c of CHAINS) {
      for (const r of ROLES) {
        const wif = sheet[c][r];
        if (!wif) continue;
        let pub = "";
        try { pub = lib.auth.wifToPublic(wif); } catch (_) { verify[c][r] = false; continue; }
        pubs[c][r] = pub;
        verify[c][r] = !!chain[c] && pub === chain[c]![r];
        if (verify[c][r]) liveMatches++;
      }
    }
    if (liveMatches === 0) {
      /* כלל-הזהב: לא-שומרים-מת — גם-לחיילים */
      return NextResponse.json({
        ok: false,
        error: "אף-מפתח-מהגיליון-לא-תואם את @" + name + " החי-על-השרשרת — לא-נשמר-כלום (כלל-הזהב: לא-שומרים-מת)",
        verify,
      }, { status: 400 });
    }

    /* VAULT-FIRST — מיזוג-חכם: קיים-חי-לא-נמחק · חדש-מאומת-נכנס · שימור-פורמט-הכניסה
     * (שטוח=אוניברסלי-לשתי-השרשראות — מתעדכן-שטוח · מקונן/חדש — נכנס-מקונן) */
    const now = new Date().toISOString();
    const vault = readJson<{ accounts?: VaultAccount[] }>(VAULT, { accounts: [] });
    vault.accounts = vault.accounts || [];
    const idx = vault.accounts.findIndex((a) => String(a.username || "").toLowerCase() === name);
    const existing: VaultAccount = idx >= 0 ? vault.accounts[idx] : { username: name, addedAt: now };
    const existingKeys = (existing.keys || {}) as Record<string, unknown>;
    const isFlat = !existingKeys.steem && !existingKeys.hive && (("owner" in existingKeys) || ("posting" in existingKeys) || ("memo" in existingKeys) || ("active" in existingKeys));
    const keys: Record<string, Record<string, VaultKey>> = isFlat
      ? ({ ...(existingKeys as unknown as Record<string, VaultKey>) } as unknown as Record<string, Record<string, VaultKey>>)
      : (JSON.parse(JSON.stringify(existingKeys)) as Record<string, Record<string, VaultKey>>);
    const merged: { steem: string[]; hive: string[] } = { steem: [], hive: [] };
    for (const c of CHAINS) {
      for (const r of ROLES) {
        if (!verify[c][r] || !pubs[c][r]) continue;
        if (isFlat) {
          /* פורמט-שטוח — אותם-מפתחות-משרתים-שתי-שרשראות: מתעדכן-פעם-אחת */
          (keys as unknown as Record<string, VaultKey>)[r] = { wif: sheet[c][r], pub: pubs[c][r] };
          if (!merged[c].includes(r)) merged[c].push(r);
        } else {
          keys[c] = keys[c] || {};
          keys[c][r] = { wif: sheet[c][r], pub: pubs[c][r] };
          merged[c].push(r);
        }
      }
    }
    const covered = isFlat ? CHAINS.filter((c) => merged[c].length > 0 || chainsHas(existing, c)) : CHAINS.filter((c) => Object.keys(keys[c] || {}).length > 0);
    const entry: VaultAccount = {
      ...existing,
      username: name,
      tier: existing.tier === "head" ? "head" : existing.tier || "soldier",
      mode: "gate-soldier-intake",
      chains: covered,
      keys,
      syncedAt: now,
      soldierIntakeAt: now,
      note: "117p8-R13 THE-GATE soldier-intake — chain-verified-before-persist · merge-not-delete · zero broadcast",
    };
    if (idx >= 0) vault.accounts[idx] = entry;
    else vault.accounts.push(entry);
    fs.writeFileSync(VAULT, JSON.stringify(vault, null, 2) + "\n");
    fs.chmodSync(VAULT, 0o600);

    /* עותק-הגיליון-המקורי (0600 · git-ignored) — עוד-שכבת-גיבוי-שלא-יאבד */
    try {
      fs.writeFileSync(path.join(AGENT, "keys", "soldier-paste-" + name + "-" + now.replace(/[:.]/g, "-") + ".txt"), "account: " + name + "\n" + paste + "\n", { mode: 0o600 });
    } catch (_) {}

    resealAsync();

    const nextStep =
      merged.steem.includes("owner") || merged.hive.includes("owner")
        ? "node agent/soldier_repair.cjs --accounts " + name + (merged.hive.length && !merged.steem.length ? " --chain hive" : "") + " --live"
        : null;

    return NextResponse.json({
      ok: true,
      name,
      verified: verify,
      merged,
      rolesInVault: covered.map((c) => ({ chain: c, roles: Object.keys(rolesOf(entry, c)) })),
      persisted: ["keys/vault.json (@" + name + ")", "keys/soldier-paste-*.txt", "fleet_keys.enc (reseal-fired)"],
      nextStep,
      at: now,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e) }, { status: 500 });
  }
}
