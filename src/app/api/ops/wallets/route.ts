import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * 113 — THE-WALLETS (ארנקי-הצבא) · לוח-הזהויות-הכספיות החי.
 *
 * המנדט: ״לכל-חייל ארנקים-מצומדים — ETH/SOL/טרון וכל-הרשתות-המובילות-היום,
 * כתובת-לכל-סוכן, ארנק-פרטי-לכל-סוכן, הכל-מעוגן, תנסה-לתקצב״.
 *
 * מקור-האמת: wallets-public.json (הכתובות-הפומביות + עיגון-המארח)
 * + state-snapshot.json (st.wallets — הרישום-על-הספר-הריבוני, אותו-מצב
 * שהקרנל מאמת) + wallets-airdrop.json + wallets-budget-last.json.
 * הכל חי — אפס-סטטי.
 */
const ROOT = process.cwd();
const PUB = path.join(ROOT, "sovereign", "node", "wallets-public.json");
const SNAP = path.join(ROOT, "sovereign", "node", "state-snapshot.json");
const AIRDROP = path.join(ROOT, "sovereign", "node", "wallets-airdrop.json");
const BUDGET = path.join(ROOT, "sovereign", "node", "wallets-budget-last.json");

const EVM_NETS = [
  { key: "ethereum", he: "Ethereum" },
  { key: "bsc", he: "BNB Chain" },
  { key: "polygon", he: "Polygon" },
  { key: "arbitrum", he: "Arbitrum" },
  { key: "optimism", he: "Optimism" },
  { key: "base", he: "Base" },
  { key: "avalanche", he: "Avalanche" },
];

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return null;
  }
}

export async function GET() {
  const pub = readJson<{
    manifestDigest?: string;
    agents?: { agent: string; idx: number; evm: string; tron: string; sol: string; btc: string }[];
    anchor?: { txid: string; by: string; at: string; digest: string; verified?: boolean };
  }>(PUB);
  const snap = readJson<{
    height?: number;
    st?: {
      meta?: { walletsTotal?: number; walletsAgents?: number };
      wallets?: { recs?: { agent: string; digest: string; hostTxid?: string; by?: string; selfReg?: boolean }[] };
      accounts?: Record<string, { saos?: number; wrapped?: Record<string, number> }>;
    };
  }>(SNAP);

  if (!pub || !pub.agents?.length) {
    return NextResponse.json({ ok: false, error: "not-derived-yet" }, { status: 503 });
  }

  const st = snap?.st || {};
  const onBook: Record<string, { digest: string; hostTxid?: string; by?: string; selfReg?: boolean }> = {};
  for (const r of st.wallets?.recs || []) onBook[r.agent] = { digest: r.digest, hostTxid: r.hostTxid, by: r.by, selfReg: r.selfReg };

  const airdrop = readJson<{ at?: string; results?: Record<string, { funded?: boolean; sig?: string | null; lamports?: number; err?: string | null }> }>(AIRDROP);
  const budget = readJson<{ at?: string; plan?: string[]; txs?: number }>(BUDGET);

  const agents = pub.agents.map((a) => {
    const ob = onBook[a.agent];
    const acct = st.accounts?.[a.agent];
    const wrapped = acct?.wrapped || {};
    const dr = airdrop?.results?.[a.agent];
    return {
      agent: a.agent,
      evm: a.evm,
      tron: a.tron,
      sol: a.sol,
      btc: a.btc,
      anchored: !!ob,
      hostTxid: ob?.hostTxid || pub.anchor?.txid || null,
      budget: { WSTEEM: wrapped.WSTEEM || 0, WBLURT: wrapped.WBLURT || 0, ENERGY: wrapped.ENERGY || 0, saos: acct?.saos || 0 },
      devnetSol: { funded: !!dr?.funded, lamports: dr?.lamports || 0, err: dr?.err || null },
      selfReg: !!ob?.selfReg,
    };
  });

  const anchoredCount = agents.filter((a) => a.anchored).length;
  const fundedCount = agents.filter((a) => a.budget.WSTEEM > 0 || a.budget.WBLURT > 0 || a.budget.ENERGY > 0).length;
  const devnetFunded = agents.filter((a) => a.devnetSol.funded).length;

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    height: snap?.height ?? null,
    digest: pub.manifestDigest || null,
    anchor: pub.anchor
      ? {
          txid: pub.anchor.txid,
          by: pub.anchor.by,
          at: pub.anchor.at,
          verified: !!pub.anchor.verified,
          url: `https://steemscan.com/transaction/${pub.anchor.txid}`,
        }
      : null,
    networks: EVM_NETS.map((n) => n.he),
    totals: {
      agents: agents.length,
      anchored: anchoredCount,
      funded: fundedCount,
      devnetFunded,
      onBookTotal: st.meta?.walletsTotal ?? null,
    },
    agents,
    budgetLast: budget || null,
    airdropAt: airdrop?.at || null,
  });
}
