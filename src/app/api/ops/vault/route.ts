import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * 114 — THE-VAULT + THE-DEPOSITS · הכספת-המוצפנת ותיבת-ההפקדות החיה.
 *
 * המנדט: ״וודא כתובות אמיתיות שיהיה מפתחות בכספת כמו שצריך והכל ·
 * בהמשך אני אשלח גם איתריום וסולנה לרשת אז אולי כדאי קצת להיערך״.
 *
 * מקורות: vault-verify-last.json (טקס-האימות) + wallets-public.json (הזהות-
 * המעוגנת — הכתובות-לשליחה) + deposits-state.json (רשת-הקבלה-החיה).
 * אפס-סודות-כאן — רק-דיגסטים, כתובות-פומביות וסטטוסים.
 */
const ROOT = process.cwd();
const NODE = path.join(ROOT, "sovereign", "node");
const VERIFY_LAST = path.join(NODE, "vault-verify-last.json");
const PUB = path.join(NODE, "wallets-public.json");
const DEP = path.join(NODE, "deposits-state.json");
const DEP_LOG = path.join(NODE, "deposits.log");

const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  base: "Base",
  avalanche: "Avalanche",
  tron: "Tron",
  solana: "Solana",
  bitcoin: "Bitcoin",
};

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return null;
  }
}

export async function GET() {
  const verify = readJson<{
    at?: string;
    ok?: boolean;
    mode?: string;
    envelopeDigest?: string;
    sealedAt?: string;
    anchoredDigest?: string;
    anchoredTxid?: string;
    checks?: Record<string, unknown>;
    errors?: string[];
  }>(VERIFY_LAST);
  const pub = readJson<{
    manifestDigest?: string;
    agents?: { agent: string; idx: number; evm: string; tron: string; sol: string; btc: string }[];
  }>(PUB);
  const dep = readJson<{
    tick?: number;
    last?: Record<string, string>;
    pending?: { key: string; chain: string; agent: string; sym: string; human: number; ticks: number }[];
    events?: {
      at: string;
      chain: string;
      agent: string;
      sym: string;
      human: number;
      unit: string;
      note?: string;
    }[];
    rpcHealth?: Record<string, { at?: string; ok?: boolean; via?: string; err?: string; note?: string }>;
    minted?: number;
    poolsOpened?: string[];
    lastTickAt?: string;
  }>(DEP);

  // watcher-חי: טיק-רענן (≤12 דק׳ — הטיק-החוקי-5 דק׳) = חי · סטלה = הגרדיאן-ישכים-אותו
  const lastTickAt = dep?.lastTickAt || null;
  const ageMs = lastTickAt ? Date.now() - new Date(lastTickAt).getTime() : Infinity;
  const watcherAlive = ageMs < 12 * 60 * 1000;

  // כתובות-ההפקדה של-הראש (headcorner) — לאן-המפעיל-שולח-את-האיתריום-והסולנה
  const head = pub?.agents?.find((a) => a.agent === "headcorner") || null;

  const chains = dep?.rpcHealth
    ? Object.entries(dep.rpcHealth).map(([key, h]) => ({
        key,
        he: CHAIN_LABELS[key] || key,
        ok: !!h.ok,
        via: h.via || null,
        err: h.err || null,
        note: h.note || null,
        at: h.at || null,
      }))
    : [];

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    vault: {
      sealed: !!(verify?.envelopeDigest && verify?.ok),
      verified: !!verify?.ok,
      verifiedAt: verify?.at || null,
      envelopeDigest: verify?.envelopeDigest || null,
      sealedAt: verify?.sealedAt || null,
      anchoredTxid: verify?.anchoredTxid || null,
      anchoredDigest: verify?.anchoredDigest || null,
      checks: verify?.checks || {},
      errors: verify?.errors || [],
      ceremony: "AES-256-GCM · scrypt N=2^15 · מפתח-אב-chmod600 · טקס-גזירה-מחדש 12×4 מול-העיגון-על-STEEM",
    },
    deposits: {
      watcherAlive,
      watcherAgeSec: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
      tick: dep?.tick ?? null,
      lastTickAt: dep?.lastTickAt || null,
      addressesTracked: dep?.last ? Object.keys(dep.last).length : 0,
      mintedTotal: dep?.minted || 0,
      poolsOpened: dep?.poolsOpened || [],
      chains,
      pending: dep?.pending || [],
      events: (dep?.events || []).slice(0, 24),
    },
    sendTo: head
      ? {
          evm: head.evm, // Ethereum + BSC + Polygon + Arbitrum + Optimism + Base + Avalanche
          tron: head.tron,
          sol: head.sol,
          btc: head.btc,
        }
      : null,
  });
}
