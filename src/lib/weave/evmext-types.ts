// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · EVM Extension Types — DTOs להרחבת חבילת ה-EVM (Task 5)
// לא נוגע ב-types.ts הסופי — רק מוסיף. חוזה משותף BE ↔ FE.
// ─────────────────────────────────────────────────────────────────────

import type { TruthLabel } from "./types";

// ─── EVM-3 · אתגרי nonce לזהויות סוכנים ──────────────────────────────

export interface ChallengeDTO {
  agentId: string;
  agentName: string;
  agentAddress: string;
  nonce: number; // ה-nonce הנדרש — agent.nonce + 1
  digest: string; // keccak256 דטרמיניסטי — זה מה שהסוכן חייב לחתום
}

export interface ChallengeVerifyDTO {
  agentId: string;
  agentName: string;
  consumedNonce: number;
  recovered: string; // כתובת ששוחזרה — חייבת להתאים לזהות הפעילה
}

// ─── EVM-3 · רוטציית מפתח חתומה EIP-712 ──────────────────────────────

export interface KeyOpDTO {
  id: string;
  agentId: string;
  agentName: string;
  kind: string;
  nonce: number;
  oldAddress: string;
  newAddress: string;
  digest: string;
  recovered: string;
  note: string;
  createdAt: string;
}

export interface ReplayDemoDTO {
  agentId: string;
  agentName: string;
  activeAddress: string;
  attemptedAddress: string; // מה ששוחזר מהחתימה של המפתח המשוך
  rejected: true;
  reason: string;
}

export interface Evm3StatsDTO {
  rotations: number; // מה-DB — סה"כ רוטציות מתועדות
  challengesVerified: number; // מונה בזיכרון — מאז הפעלת השרת
  replaysBlocked: number; // מונה בזיכרון — מאז הפעלת השרת
  counterScope: string;
}

// ─── EVM-2 · רישום עוגן מקומי (סימולציית חוזה — LOCAL) ─────────────

export interface LocalAnchorDTO {
  registryIndex: number;
  root: string;
  checkpointIndex: number;
  attFrom: number;
  attTo: number;
  calldata: string;
  anchoredBy: string;
  anchoredAt: string;
}

export interface RegistryVerifyDTO {
  mode: "LOCAL"; // תווית אמת מוצהרת: סימולציית חוזה בשרת, לא שרשרת
  seq: number;
  entryHash: string; // העלה
  leafRecomputedMatch: boolean; // hashEntry(חישוב מחדש) === entryHash שמור
  checkpointIndex: number;
  registryIndex: number;
  root: string;
  rootInRegistry: boolean; // roots[registryIndex] === root
  proof: string[];
  proofValid: boolean; // verifyMerkleProof(leaf, proof, root, index)
  verifiedAt: string;
}

// ─── EVM-1 · חבילת פריסה ─────────────────────────────────────────────

export interface DeployChecklistItem {
  label: string;
  truth: TruthLabel;
  note?: string;
}

export interface DeployKitDTO {
  available: true;
  contractName: string;
  compiler: string;
  evmVersion: string;
  optimizer: { enabled: boolean; runs: number };
  compiledAt: string;
  deterministicRecompileMatch: boolean;
  runtimeEmbeddedInCreation: boolean;
  sourceMatch: boolean; // artifact.source === המקור המוצג ב-UI
  sourceKeccak: string;
  bytecode: string;
  bytecodeKeccak: string;
  deployedBytecodeKeccak: string;
  codeDepositGas: number | null; // אומדן קומפילטור — לא מדידת רשת
  abiJson: string;
  deployData: string; // נתוני tx הפריסה (ה-bytecode עצמו)
  checklist: DeployChecklistItem[];
  notes: string[];
}
