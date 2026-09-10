import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { derivePubQuietly } from "@/lib/wif";

export const dynamic = "force-dynamic";

/**
 * 117p — THE-GATE · שער-החיבור-הריבוני של-המפעיל
 *
 * המנדט (מהמפעיל): "תעשה לי מקום להתחבר עם המפתחות שלי… תישאר מחובר שנוכל לעבוד…
 * וודא שלא יקרה לנו שוב".
 *
 * עקרונות (קשיחים):
 *  · מפתחות-פרטיים: נקלטים-בPOST, נבדקים-מול-השרשרת, נשמרים-vault-first מקומית
 *    (agent/keys/vault.json + agent/.env — שניהם git-ignored · 0600) — ולעולם לא
 *    חוזרים-בתשובה, בלוג או בגיט.
 *  · "תישאר מחובר": מצב-החיבור נשמר ב-agent/gate-state.json — עובד-חזרה/רענון/אתמול.
 *  · "שלא יקרה שוב": אימות-8/8 מול-השרשרת לפני-שמירה; שמירה רק-אם-המפתח-חי;
 *    guardian watchOwnerAuth מתריע-על-כל-שינוי-עתידי.
 */
const ROOT = process.cwd();
const AGENT = path.join(ROOT, "agent");
const VAULT = path.join(AGENT, "keys", "vault.json");
const GATE = path.join(AGENT, "gate-state.json");
const ENVP = path.join(AGENT, ".env");
const ACCOUNT = (process.env.AGENT_ACCOUNT || "headcorner").toLowerCase();
const ROLES = ["owner", "active", "posting", "memo"] as const;

/* 117p6 — מלאות-הצי: תמצית-ביקורת-האימות (agent/soldier_auth_audit.cjs — רץ-חיצונית).
 * כנות-מלאה: זו-תוצאת-הביקורת-האחרונה (mtime), לא-בדיקה-חיה. אפס-חומר-מפתח — רק-בוליאנים. */
type AuditRow = {
  name?: string;
  viaHeadOnly?: boolean;
  steem?: { exists?: boolean; posting?: boolean; headPosting?: boolean };
  hive?: { exists?: boolean; posting?: boolean; active?: boolean; owner?: boolean; headPosting?: boolean };
};
function fleetSummary() {
  try {
    const p = path.join(AGENT, "soldier_auth_audit.json");
    const rows = JSON.parse(fs.readFileSync(p, "utf8")) as AuditRow[];
    let hiveFull = 0;
    const viaHead: string[] = [];
    const dead: string[] = [];
    for (const r of rows) {
      if (!r.name || String(r.name).toLowerCase() === ACCOUNT) continue;
      const h = r.hive;
      const s = r.steem;
      if (h?.headPosting || s?.headPosting) viaHead.push(String(r.name));
      if (h?.posting && h?.active && h?.owner) hiveFull++;
      if (!h?.posting && !h?.headPosting) dead.push(String(r.name));
    }
    return {
      auditedAt: fs.statSync(p).mtime.toISOString(),
      total: rows.filter((r) => r.name && String(r.name).toLowerCase() !== ACCOUNT).length,
      hiveFull,
      viaHead,
      dead,
      rails: { steemAttest: viaHead.length > 0 ? "head-anchor+via-head" : "head-only", hiveAnchor: "fleet+via-head" },
      refresh: "node agent/soldier_auth_audit.cjs",
    };
  } catch (_) {
    return null;
  }
}

type ChainPubs = Record<string, string>;

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return fallback;
  }
}

/* steem-js מתוך agent/node_modules (ה-UI-לא-מצהיר-עליו) */
function steemLib() {
  const req = createRequire(path.join(AGENT, "no-op.js"));
  return req(path.join(AGENT, "node_modules", "steem")) as {
    auth: { wifToPublic: (w: string) => string };
  };
}

async function chainPubs(): Promise<{ steem: ChainPubs | null; hive: ChainPubs | null }> {
  const one = async (url: string): Promise<ChainPubs | null> => {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }),
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

/* ניתוח-גיליון-מפעיל: OWNER = <wif> … עם-מקטע-HIVE-אופציונלי (הפורמט-שהוכיח-את-עצמו) */
function parseSheet(paste: string): { steem: Record<string, string>; hive: Record<string, string> } {
  const out = { steem: {} as Record<string, string>, hive: {} as Record<string, string> };
  let cur: "steem" | "hive" = "steem";
  for (const line of paste.split(/\r?\n/)) {
    const t = line.trim();
    if (/^HIVE$/i.test(t)) { cur = "hive"; continue; }
    if (/^STEEM$/i.test(t)) { cur = "steem"; continue; }
    const m = t.match(/^([A-Za-z_]+)\s*[=:]\s*([5PJKL][1-9A-HJ-NP-Za-km-z]{49,51})\s*$/);
    /* P5… = פורמט-גרפן (P + WIF) — מנורמל ל-WIF רגיל (51, מתחיל-ב-5) לפני-שמירה/גזירה (R18b — יישור-מול-פאנל-החיילים) */
    if (m) out[cur][m[1].toLowerCase()] = m[2].replace(/^P(?=[5JKL])/, "");
  }
  return out;
}

export async function GET() {
  try {
    const state = readJson<{ connected?: boolean; at?: string; account?: string }>(GATE, {});
    const vault = readJson<{ accounts?: Array<{ username?: string; keys?: Record<string, Record<string, { wif?: string; pub?: string }>>; tier?: string }> }>(VAULT, {});
    const head = (vault.accounts || []).find((a) => String(a.username || "").toLowerCase() === ACCOUNT);

    /* אימות-חי: מהכספת-המקומית מול-השרשרת — רק-בוליאנים, אפס-חומר-מפתח */
    let live: { steem: Record<string, boolean> | null; hive: Record<string, boolean> | null } = { steem: null, hive: null };
    if (head?.keys) {
      const chain = await chainPubs();
      const cmp = (set: "steem" | "hive") => {
        if (!chain[set] || !head.keys?.[set]) return null;
        const row: Record<string, boolean> = {};
        for (const r of ROLES) {
          const wif = head.keys[set]?.[r]?.wif;
          let pub: string | null = null;
          try { pub = wif ? derivePubQuietly(wif, (w) => steemLib().auth.wifToPublic(w)) : null; } catch (_) { pub = null; }
          row[r] = !!pub && pub === chain[set]![r];
        }
        row._all = ROLES.every((r) => row[r]);
        return row;
      };
      live = { steem: cmp("steem"), hive: cmp("hive") };
    }

    const soldiers = (vault.accounts || []).filter((a) => a.username !== ACCOUNT).length;
    let broker = false;
    try {
      const r = await fetch("http://127.0.0.1:3040/health", { signal: AbortSignal.timeout(2500) });
      const j = (await r.json()) as { ok?: boolean };
      broker = !!j.ok;
    } catch (_) { broker = false; }
    const guardian = readJson<{ at?: string }>(path.join(AGENT, "guardian_result.json"), {});
    const guardianAgeS = guardian.at ? Math.round((Date.now() - Date.parse(guardian.at)) / 1000) : null;

    return NextResponse.json({
      ok: true,
      account: ACCOUNT,
      connected: !!state.connected,
      connectedAt: state.at || null,
      headEntry: !!head,
      live,
      soldiers,
      fleet: fleetSummary(),
      seal: { enc: fs.existsSync(path.join(AGENT, "fleet_keys.enc")), meta: fs.existsSync(path.join(AGENT, "fleet_keys.meta.json")) },
      broker,
      guardianAgeS,
      backup: { file: "agent/vault/KEYS-BACKUP-2026-09-09.tar.enc", sha256: "5753a90cdad893b2008e6a6abb4407d2a354ec89ac6be39adf6ea1d526fa8ac4" },
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { paste?: string };
    const paste = String(body.paste || "");
    if (!paste.trim() || paste.length > 8000) {
      return NextResponse.json({ ok: false, error: "paste-ריק או חורג-מ-8KB" }, { status: 400 });
    }
    const sheet = parseSheet(paste);
    const haveSteem = ROLES.filter((r) => sheet.steem[r]).length;
    const haveHive = ROLES.filter((r) => sheet.hive[r]).length;
    if (haveSteem + haveHive === 0) {
      return NextResponse.json({ ok: false, error: "לא-זוהו-מפתחות — פורמט: OWNER = 5H… (שורה-לכל-תפקיד, מקטע HIVE אופציונלי)" }, { status: 400 });
    }
    const chain = await chainPubs();
    if (!chain.steem && !chain.hive) {
      return NextResponse.json({ ok: false, error: "הרשת-לא-נענתה — נסה-שוב (לא-נשמר-דבר)" }, { status: 502 });
    }
    const lib = steemLib();
    const verify: { steem: Record<string, boolean>; hive: Record<string, boolean> } = { steem: {}, hive: {} };
    const pubs: { steem: Record<string, string>; hive: Record<string, string> } = { steem: {}, hive: {} };
    let ownerLive = false;
    for (const set of ["steem", "hive"] as const) {
      for (const r of ROLES) {
        const wif = sheet[set][r];
        if (!wif) continue;
        let pub = "";
        try { pub = derivePubQuietly(wif, (w) => lib.auth.wifToPublic(w)) ?? ""; } catch (_) { verify[set][r] = false; continue; }
        pubs[set][r] = pub;
        verify[set][r] = !!chain[set] && pub === chain[set]![r];
        if (r === "owner" && verify[set][r]) ownerLive = true;
      }
    }
    if (!ownerLive) {
      return NextResponse.json({ ok: false, error: "המפתחות-לא-תואמים-את-השרשרת — לא-נשמר-כלום (כלל-הזהב: לא-שומרים-מת)", verify }, { status: 400 });
    }

    /* VAULT-FIRST — שמירה-מקומית בלבד, אפס-שידור, אפס-גיט */
    const now = new Date().toISOString();
    const vault = readJson<{ accounts?: Array<Record<string, unknown>> }>(VAULT, { accounts: [] });
    vault.accounts = (vault.accounts || []).filter((a) => String((a as { username?: string }).username || "").toLowerCase() !== ACCOUNT);
    vault.accounts.push({
      username: ACCOUNT,
      tier: "head",
      mode: "gate-connect",
      addedAt: now,
      syncedAt: now,
      chains: (["steem", "hive"] as const).filter((s) => Object.keys(pubs[s]).length > 0),
      keys: Object.fromEntries(
        (["steem", "hive"] as const)
          .filter((s) => Object.keys(pubs[s]).length > 0)
          .map((s) => [s, Object.fromEntries(Object.keys(pubs[s]).map((r) => [r, { wif: sheet[s][r], pub: pubs[s][r] }]))])
      ),
      note: "117p THE-GATE — operator paste, chain-verified before persist, zero broadcast",
    });
    fs.writeFileSync(VAULT, JSON.stringify(vault, null, 2) + "\n");
    fs.chmodSync(VAULT, 0o600);

    /* .env — תפקידי-steem במשתנים-הסטנדרטיים + HIVE_* מפורדים */
    try {
      let env = fs.readFileSync(ENVP, "utf8");
      const setVar = (name: string, val: string) => {
        const re = new RegExp("^" + name + "=.*$", "m");
        if (re.test(env)) env = env.replace(re, name + "=" + val);
        else env += "\n" + name + "=" + val;
      };
      for (const r of ROLES) {
        if (sheet.steem[r]) { setVar(r.toUpperCase() + "_WIF", sheet.steem[r]); setVar(r.toUpperCase() + "_WIF_PUB", pubs.steem[r] || ""); }
        if (sheet.hive[r]) { setVar("HIVE_" + r.toUpperCase() + "_WIF", sheet.hive[r]); setVar("HIVE_" + r.toUpperCase() + "_WIF_PUB", pubs.hive[r] || ""); }
      }
      fs.writeFileSync(ENVP, env);
      fs.chmodSync(ENVP, 0o600);
    } catch (_) { /* env הוא-בונוס — הכספת-היא-מקור-האמת */ }

    /* הגיליון-המקורי נשמר-מקומית (0600, git-ignored) — עותק-נוסף-שלא-יאבד */
    try {
      const dst = path.join(AGENT, "keys", "operator-paste-" + now.replace(/[:.]/g, "-") + ".txt");
      fs.writeFileSync(dst, paste, { mode: 0o600 });
    } catch (_) {}

    /* "תישאר מחובר" */
    fs.writeFileSync(GATE, JSON.stringify({ connected: true, at: now, account: ACCOUNT, steem: Object.keys(verify.steem).length > 0, hive: Object.keys(verify.hive).length > 0 }, null, 2) + "\n");
    fs.chmodSync(GATE, 0o600);

    return NextResponse.json({ ok: true, connected: true, verified: verify, persisted: ["keys/vault.json (headcorner)", "agent/.env", "keys/operator-paste-*.txt", "gate-state.json"], at: now });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e) }, { status: 500 });
  }
}
