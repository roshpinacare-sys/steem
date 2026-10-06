// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Deploy Kit (שער EVM-1 — הכנה) — חבילת הפריסה של החוזה
//
// ה-artifact נוצר בקומפילציה אמיתית (solc-js, scripts/compile-anchor.ts):
// קומפילציה כפולה להוכחת דטרמיניזם + keccak256 של ה-bytecode.
// כל מה שחסר לפריסה בפועל — חותם ממומן, RPC יעד ו-eth_estimateGas —
// מסומן בכנות כ-NOT-YET ב-checklist. שום דבר לא מומצא ידנית.
// ─────────────────────────────────────────────────────────────────────

import { keccak256, getBytes } from "ethers";
import artifact from "./artifacts/WeaveAnchorRegistry.json";
import { ANCHOR_REGISTRY_SOURCE } from "./anchor";
import type { DeployChecklistItem, DeployKitDTO } from "./evmext-types";

export function getDeployKit(): DeployKitDTO {
  const sourceMatch = artifact.source === ANCHOR_REGISTRY_SOURCE;
  const bytecodeKeccak = keccak256(getBytes(artifact.bytecode));

  const checklist: DeployChecklistItem[] = [
    {
      label: "קומפילציה מקומית ב-solc (0.8.37)",
      truth: "REAL",
      note: "קומפילציה כפולה אומתה כדטרמיניסטית — אותו bytecode פעמיים",
    },
    {
      label: "ABI + bytecode + keccak256 מתועדים",
      truth: "REAL",
      note: `bytecode keccak256: ${artifact.bytecodeKeccak} · codeDeposit: ${artifact.codeDepositGas ?? "?"} gas (אומדן קומפילטור)`,
    },
    {
      label: "חותם ממומן (מפתח עם כסף ב-testnet)",
      truth: "NOT-YET",
      note: "נדרש מפתח של המשתמש — הפלטפורמה לא מחזיקה ולא מייצרת מפתחות ממומנים",
    },
    {
      label: "RPC יעד + eth_estimateGas בפועל",
      truth: "NOT-YET",
      note: "האומדן שלעיל הוא סטטי (קומפילטור) — מדידת רשת אמיתית תיעשה בזמן הפריסה",
    },
    {
      label: "שידור tx + תיעוד כתובת החוזה",
      truth: "NOT-YET",
      note: "זה בדיוק שער EVM-1 — נסגר רק כשכתובת החוזה תהיה מתועדת ומאומתת",
    },
  ];

  const notes: string[] = [
    "אינטגריציות מקור: ה-artifact נבדק מול המקור המוצג — sourceMatch חייב להיות true, אחרת הרץ bun scripts/compile-anchor.ts מחדש.",
    "ה-EIP-712 domain של הרשת (WEAVE_DOMAIN) עומד על chainId 31337 (devnet) — במעבר ל-testnet יש לעדכן את ה-domain ולתעד את השינוי.",
    "הפריסה עצמה תיעשה מחשבון ה-relayer של המשתמש (למשל MetaMask / cast send) — נתוני ה-tx מוכנים להלן במלואם.",
  ];

  return {
    available: true,
    contractName: artifact.contract,
    compiler: artifact.compiler,
    evmVersion: artifact.evmVersion,
    optimizer: artifact.optimizer,
    compiledAt: artifact.compiledAt,
    deterministicRecompileMatch: artifact.deterministicRecompileMatch,
    runtimeEmbeddedInCreation: artifact.runtimeEmbeddedInCreation,
    sourceMatch,
    sourceKeccak: artifact.sourceKeccak,
    bytecode: artifact.bytecode,
    bytecodeKeccak,
    deployedBytecodeKeccak: artifact.deployedBytecodeKeccak,
    codeDepositGas: artifact.codeDepositGas,
    abiJson: JSON.stringify(artifact.abi, null, 2),
    deployData: artifact.bytecode, // tx פריסה: data = ה-bytecode עצמו
    checklist,
    notes,
  };
}
