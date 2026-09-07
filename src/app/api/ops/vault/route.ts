import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { keccak_256 } from "js-sha3";

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
const PREFLIGHT = path.join(NODE, "deposits-preflight.json");
const SWAP_ATTEST = path.join(NODE, "theswap-attest.json"); // 117f — מחירים-חיים-מעד-ההצמדה (להערכת-שווי-הצינור)

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

/**
 * 117e — תוויות-התקינות של-כתובות-הראש (אפס-סודות: כתובות-פומביות-בלבד).
 * EVM: חישוב-EIP-55 (keccak-256 דרך-js-sha3) והשוואה-לכתובת-מהרישום ·
 * TRON: base58check מקומי (sha256d + בייט-ראש 0x41) · SOL: base58→32בייט (ed25519) ·
 * BTC: פורמט-bech32. כנות: אם-הבדיקה-עצמה-לא-יכולה-לרוץ — computed=false והדגל-שקר.
 */
type HeadValidity = {
  evmChecksumOk: boolean;
  evmChecksummed: string;
  evmComputed: boolean;
  tronOk: boolean;
  tronComputed: boolean;
  solBytesOk: boolean;
  btcFormatOk: boolean;
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58ToBuffer(s: string): Buffer {
  let n = BigInt(0);
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad-base58-char");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const leadZeros = s.length - s.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(leadZeros), Buffer.from(hex, "hex")]);
}

function headValidity(head: { evm: string; tron: string; sol: string; btc: string }): HeadValidity {
  const out: HeadValidity = { evmChecksumOk: false, evmChecksummed: "", evmComputed: false, tronOk: false, tronComputed: true, solBytesOk: false, btcFormatOk: false };
  try {
    if (/^0x[0-9a-fA-F]{40}$/.test(head.evm)) {
      out.evmComputed = true;
      const lower = head.evm.toLowerCase().slice(2);
      const hash = keccak_256(lower);
      let cs = "";
      for (let i = 0; i < 40; i++) {
        const nib = Number.parseInt(hash[i], 16);
        cs += nib >= 8 ? lower[i].toUpperCase() : lower[i];
      }
      out.evmChecksummed = "0x" + cs;
      out.evmChecksumOk = "0x" + cs === head.evm;
    }
  } catch (_) {
    /* כנות */
  }
  try {
    // TRON base58check: 25 בייטים = 0x41+20-גוף + 4-ביקורת sha256d
    const raw = b58ToBuffer(head.tron);
    if (raw.length === 25 && raw[0] === 0x41) {
      const body = raw.subarray(0, 21);
      const sum = raw.subarray(21);
      const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(body).digest()).digest();
      out.tronOk = h.subarray(0, 4).equals(sum);
    }
  } catch (_) {
    out.tronComputed = false;
  }
  try {
    const raw = b58ToBuffer(head.sol);
    out.solBytesOk = raw.length === 32;
  } catch (_) {
    /* כנות */
  }
  out.btcFormatOk = /^bc1[a-z0-9]{20,71}$/.test(head.btc);
  return out;
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

  // 117 — מוכנות-הקבלה למשימת-$1-אמת (המפעיל-מפקיד ETH+SOL אמת)
  const preflight = readJson<{
    at?: string;
    ready?: boolean;
    mission?: string;
    addresses?: { evm?: string; sol?: string };
    checks?: { name: string; ok: boolean; detail: string }[];
  }>(PREFLIGHT);

  // כתובות-ההפקדה של-הראש (headcorner) — לאן-המפעיל-שולח-את-האיתריום-והסולנה
  const head = pub?.agents?.find((a) => a.agent === "headcorner") || null;

  // 117f — מחירי-הצמדה-חיים (double-read attest) — להערכת-שווי-$-של-הצינור-בדף
  const attest = readJson<{ prices?: Record<string, number> }>(SWAP_ATTEST);
  const prices = attest?.prices || null;

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
      prices,
      pending: dep?.pending || [],
      events: (dep?.events || []).slice(0, 24),
      preflight: preflight
        ? {
            at: preflight.at || null,
            ready: !!preflight.ready,
            mission: preflight.mission || null,
            checksOk: (preflight.checks || []).filter((c) => c.ok).length,
            checksTotal: (preflight.checks || []).length,
            checks: preflight.checks || [],
          }
        : null,
    },
    sendTo: head
      ? {
          evm: head.evm, // Ethereum + BSC + Polygon + Arbitrum + Optimism + Base + Avalanche
          tron: head.tron,
          sol: head.sol,
          btc: head.btc,
          validity: headValidity(head),
        }
      : null,
  });
}
