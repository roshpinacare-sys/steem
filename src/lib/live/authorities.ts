// ─────────────────────────────────────────────────────────────────────
// authorities — הרשויות החיות של חשבון גרפני בשלוש-השרשראות (r136).
//
// החוק (דוקטרינת-הבית): השרשרת היא השופט. כל מפתח שמודבק באחת
// מהדלתות נשפט מול הרשות החיה כאן — ביט מול ביט — לפני שהוא נוגע
// בכלום. אין מטמון, אין זיכרון: כל קריאה שואלת את השרשרת עצמה.
// ─────────────────────────────────────────────────────────────────────

export type GrapheneChain = "steem" | "hive" | "blurt";

export const CHAIN_RPC: Record<GrapheneChain, string> = {
  steem: process.env.STEEM_RPC || "https://api.steemit.com",
  hive: process.env.HIVE_RPC || "https://api.hive.blog",
  blurt: process.env.BLURT_RPC || "https://rpc.blurt.blog",
};

// r136b — נפלת-צמתים לכל שרשרת (הראשונה = CHAIN_RPC ההיסטורי)
const CHAIN_NODES: Record<GrapheneChain, string[]> = {
  steem: [CHAIN_RPC.steem],
  hive: [CHAIN_RPC.hive],
  blurt: [CHAIN_RPC.blurt, "https://rpc.blurt.world"],
};

export interface ChainAuthorities {
  chain: GrapheneChain;
  account: string;
  /** pub לפי תפקיד — נקרא חי מהשרשרת. memo_key הוא שדה ולא key_auths */
  roles: { role: "owner" | "active" | "posting" | "memo"; pub: string | null }[];
  ok: boolean;
  detail?: string;
}

async function rpc<T>(chain: GrapheneChain, method: string, params: unknown[]): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    // r136b — זיהוי נחוץ: צומת-BLURT חוסם User-Agent אנונימי ומחזיר HTML
    // במקום JSON (נמדד חי). פענוח מגן: תגובה לא-JSON = כשל-צומת, לא פסק-דין.
    let lastErr: unknown = null;
    for (const node of CHAIN_NODES[chain]) {
      try {
        const r = await fetch(node, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "saos-grid/1 (+https://headcorner.local)" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: ac.signal,
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`http-${r.status}`);
        const txt = await r.text();
        const j = JSON.parse(txt) as { result?: T; error?: unknown };
        if (j.error) throw new Error("rpc-error");
        return j.result as T;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("all-nodes-failed");
  } finally {
    clearTimeout(t);
  }
}

interface AccountAuth {
  owner?: { key_auths?: Array<[string, number]> };
  active?: { key_auths?: Array<[string, number]> };
  posting?: { key_auths?: Array<[string, number]> };
  memo_key?: string;
}

function firstAuth(auth: AccountAuth, role: "owner" | "active" | "posting"): string | null {
  const auths = auth?.[role]?.key_auths;
  return Array.isArray(auths) && auths.length ? String(auths[0][0]) : null;
}

/** הרשויות החיות של חשבון בשרשרת גרפנית אחת */
export async function fetchAuthorities(chain: GrapheneChain, account: string): Promise<ChainAuthorities> {
  try {
    const accts = await rpc<AccountAuth[]>(chain, "condenser_api.get_accounts", [[account]]);
    const a = accts?.[0];
    if (!a) return { chain, account, roles: [], ok: false, detail: `החשבון @${account} לא נמצא בשרשרת` };
    return {
      chain,
      account,
      ok: true,
      roles: [
        { role: "owner", pub: firstAuth(a, "owner") },
        { role: "active", pub: firstAuth(a, "active") },
        { role: "posting", pub: firstAuth(a, "posting") },
        { role: "memo", pub: a.memo_key ?? null },
      ],
    };
  } catch (e) {
    return { chain, account, roles: [], ok: false, detail: `קריאת השרשרת נכשלה: ${String((e as Error).message ?? e).slice(0, 60)}` };
  }
}

/** הרשויות החיות של חשבון בשלוש-השרשראות — במקביל */
export async function fetchAuthoritiesAllChains(account: string): Promise<ChainAuthorities[]> {
  return Promise.all([
    fetchAuthorities("steem", account),
    fetchAuthorities("hive", account),
    fetchAuthorities("blurt", account),
  ]);
}
