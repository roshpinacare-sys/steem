// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · EVM Wire — רגל האת'ריום בנתיב הכספת הריבוני (R102)
//
// חוק המפעיל (R102, הוכח מיד במדידה): "כבר שלחתי לך את הארנק של eth
// sol יש גישה והכל — הטענות שלך לא נכונות". נמדד: 12 רשומות ethereum
// + 12 solana בכספת הארנק, כולן verified, כולן נפתחות בנתיב הריבוני
// (סיסמת-האב → active-STEEM → חותמת → מפתח-אב → AES-256-GCM), והפומבי
// הנגזר מהמפתח הפרטי תואם ביט-מול-ביט לכתובת הרשומה (12/12 MATCH).
//
// חוקי-ברזל (מנסחי R99/R101, חלים גם כאן):
//   · המפתח הפרטי חי בזיכרון-ההרצה בלבד — לא נכתב, לא מודפס, לא נכנס ללוג.
//   · השרשרת היא השופט: הכתובת הנגזרת חייבת להתאים ל-entryPub לפני כל שידור.
//   · קבלה כנה: NO-GAS כשהמאזן לא מכסה גז — לא "נכשל", אלא אמת מדודה.
//   · שער-מאה: מתחת ל-$100 אוטונומיה מלאה; מעל — תור-מפעיל (tx-gate).
// ─────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";
import { openVaultEntryRaw } from "@/lib/dex/wallet-vault";

/** צומת ציבורי — נמדד חי מהסנדבוקס (R102: drpc עונה, llamarpc/ankr חוסמים) */
const ETH_RPC = process.env.ETH_RPC || "https://eth.drpc.org";
const FALLBACK_RPCS = ["https://eth.drpc.org", "https://rpc.ankr.com/eth", "https://1rpc.io/eth"];

/** R105 — אוצר ה-ETH של הזירה: cashmachine (שם ההון היסטורי, אותו מפתח-אב).
 * כתובת ציבורית נטולת-סוד; בכל שידור הנגזרת מאומתת מול הכספת בכל מקרה. */
export const ETH_TREASURY_ADDR = "0x0FB6C1807d8D7945B5E3a14ea3679e19795cb545";

let provider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!provider) provider = new ethers.JsonRpcProvider(ETH_RPC);
  return provider;
}

export interface EthVaultWallet {
  ok: boolean;
  address?: string;
  entryPub?: string;
  match?: boolean;
  detail?: string;
  /** הארנק החי — זיכרון-הרצה בלבד; לעולם לא נכנס ללוג או ל-DB */
  wallet?: ethers.Wallet;
}

/** פתיחת ארנק EVM מהכספת בנתיב הריבוני + אימות כתובת מול הרשומה */
export function openEthVaultWallet(account: string): EthVaultWallet {
  const raw = openVaultEntryRaw("ethereum", account, "wallet");
  if (!raw.ok || !raw.priv) {
    return { ok: false, detail: raw.detail ?? "VAULT-CLOSED" };
  }
  const hex = raw.priv.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return { ok: false, detail: "BAD-FORMAT: חומר המפתח אינו 64-hex" };
  }
  try {
    const wallet = new ethers.Wallet("0x" + hex);
    const match = wallet.address.toLowerCase() === String(raw.entryPub ?? "").toLowerCase();
    if (!match) {
      // חוק השרשרת-השופט: אי-התאמה = עצירה מוחלטת, אפס שידור
      return { ok: false, address: wallet.address, entryPub: raw.entryPub, match: false, detail: "PUB-MISMATCH: הכתובת הנגזרת אינה מתאימה לרשומת הכספת — שידור חסום" };
    }
    return { ok: true, address: wallet.address, entryPub: raw.entryPub, match: true, wallet, detail: raw.detail };
  } catch (e) {
    return { ok: false, detail: "KEY-ERROR: " + String((e as Error).message ?? e).slice(0, 80) };
  }
}

export interface EthBalanceRow {
  account: string;
  address: string;
  wei: string;
  eth: number;
  usd: number | null;
  error?: string;
}

/** מאזן חי של כתובת (ציבורי, חסר-מפתחות) */
export async function ethBalanceOf(address: string): Promise<{ wei: bigint; eth: number; error?: string }> {
  try {
    const wei = await getProvider().getBalance(address, "latest");
    return { wei, eth: Number(wei) / 1e18 };
  } catch {
    // ניסיון נפילה לצומת חלופי — חוסן צומת בודד
    for (const rpc of FALLBACK_RPCS) {
      try {
        const p = new ethers.JsonRpcProvider(rpc);
        const wei = await p.getBalance(address, "latest");
        return { wei, eth: Number(wei) / 1e18 };
      } catch { /* הצומת הבא */ }
    }
    return { wei: BigInt(0), eth: 0, error: "RPC-DOWN: כל צמתי ה-Ethereum לא ענו" };
  }
}

export interface EthSendResult {
  ok: boolean;
  txid?: string;
  broadcast?: boolean;
  detail: string;
  gasEstimateEth?: number;
  balanceEth?: number;
}

/**
 * שידור EIP-1559 אמיתי. קבלה כנה בכל ענף:
 * NO-GAS כשאין כיסוי, NO-KEY כשהכספת סגורה, PUB-MISMATCH כשהנגזרת לא תואמת.
 */
export async function ethSend(
  account: string,
  toAddress: string,
  valueEth: number,
  opts?: { maxFeeGweiCap?: number },
): Promise<EthSendResult> {
  const vw = openEthVaultWallet(account);
  if (!vw.ok || !vw.wallet) {
    return { ok: false, detail: `NO-KEY: ${vw.detail ?? "vault-closed"}` };
  }
  if (!ethers.isAddress(toAddress)) {
    return { ok: false, detail: "BAD-TO: כתובת יעד שגויה" };
  }
  if (!(valueEth > 0)) {
    return { ok: false, detail: "BAD-VALUE: סכום חייב להיות חיובי" };
  }
  try {
    const p = getProvider();
    const w = vw.wallet.connect(p);
    const [balance, net] = await Promise.all([
      p.getBalance(vw.address!, "latest"),
      p.getNetwork(),
    ]);
    const feeData = await p.getFeeData();
    const maxFee = feeData.maxFeePerGas;
    const priority = feeData.maxPriorityFeePerGas;
    if (!maxFee || !priority) {
      return { ok: false, detail: "NO-FEE-DATA: הצומת לא מסר תמחור גז (legacy?)" };
    }
    const gasLimit = BigInt(21000);
    const gasCostWei = maxFee * gasLimit;
    const valueWei = ethers.parseEther(valueEth.toFixed(12));
    if (balance < valueWei + gasCostWei) {
      return {
        ok: false,
        detail: `NO-GAS: המאזן ${(Number(balance) / 1e18).toFixed(8)} ETH אינו מכסה סכום+גז (${(Number(valueWei + gasCostWei) / 1e18).toFixed(8)} ETH) — אמת מדודה, לא תקלה`,
        gasEstimateEth: Number(gasCostWei) / 1e18,
        balanceEth: Number(balance) / 1e18,
      };
    }
    // תקרת-גז (חוק שימור-הון): דחייה כנה אם שוק הגז מטורף
    const capGwei = opts?.maxFeeGweiCap ?? 80;
    if (Number(maxFee) / 1e9 > capGwei) {
      return { ok: false, detail: `GAS-CEILING: maxFee ${Number(maxFee) / 1e9} gwei מעל התקרה ${capGwei} — המתנה זולה משיגור` };
    }
    const tx = await w.sendTransaction({
      to: toAddress,
      value: valueWei,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
      gasLimit,
      chainId: net.chainId,
      type: 2,
    });
    return {
      ok: true,
      txid: tx.hash,
      broadcast: true,
      detail: `broadcast-accepted chainId=${net.chainId} (השרשרת השופט: אישור = כריתה בבלוק)`,
      gasEstimateEth: Number(gasCostWei) / 1e18,
      balanceEth: Number(balance) / 1e18,
    };
  } catch (e) {
    return { ok: false, detail: "SEND-ERROR: " + String((e as Error).message ?? e).slice(0, 140) };
  }
}
