// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Types — חוזה הנתונים המשותף Backend ↔ Frontend
// ─────────────────────────────────────────────────────────────────────

import type { VitalityDTO } from "./vitality";

export type { VitalityDTO };

export type ClaimType =
  | "MEASUREMENT"
  | "BUILD"
  | "AUDIT"
  | "ROTATION"
  | "ANCHOR"
  | "SELFTEST"
  | "MARKET"
  | "CROSSCHAIN";

export const CLAIM_TYPES: ClaimType[] = [
  "MEASUREMENT",
  "BUILD",
  "AUDIT",
  "ROTATION",
  "ANCHOR",
  "SELFTEST",
  "MARKET",
  "CROSSCHAIN",
];

export type AttestationStatus =
  | "VERIFIED"
  | "REFUTED"
  | "UNMEASURED"
  | "CONTESTED";

export const ATTESTATION_STATUSES: AttestationStatus[] = [
  "VERIFIED",
  "REFUTED",
  "UNMEASURED",
  "CONTESTED",
];

export type TruthLabel = "REAL" | "LOCAL" | "NOT-YET";

export type AgentCapability =
  /** מפתח-חתימה חי ב-DB — יכול לחתום עדויות חדשות */
  | "SEALED-SIGNER"
  /** זהות בלבד — אין devKeyHex בסביבה הזו (שוחזר מהספר/הקנון; חתימה בלתי-אפשרית כאן) */
  | "IDENTITY-ONLY";

export interface AgentDTO {
  id: string;
  name: string;
  role: string;
  ethAddress: string;
  pubKeyHex: string;
  status: string;
  /** R117 — כנות-יכולת: מה הסוכן יכול לעשות *בסביבה הזו*, לא מה כתוב בשדה הסטטוס */
  capability: AgentCapability;
  attCount: number;
  createdAt: string;
}

export interface AttestationDTO {
  seq: number;
  agentId: string;
  agentName: string;
  agentAddress: string;
  claim: string;
  claimType: ClaimType | string;
  evidence: string;
  evidenceHash: string;
  status: AttestationStatus | string;
  prevHash: string;
  entryHash: string;
  sig: string | null;
  signerAddr: string | null;
  createdAt: string;
}

export interface VerifyReportDTO {
  valid: boolean;
  checked: number;
  firstBreak: number | null; // seq של הרשומה הראשונה שנשברה
  errors: string[];
  sigOk: number;
  sigFail: number;
  headHash: string;
  verifiedAt: string;
  recomputedHead: string;
}

export interface CheckpointDTO {
  index: number;
  attFrom: number;
  attTo: number;
  leafCount: number;
  root: string;
  prevRoot: string;
  entryHash: string;
  sig: string | null;
  signerAddr: string | null;
  anchorStatus: string;
  anchorNet: string | null;
  anchorTx: string | null;
  calldata: string | null;
  createdAt: string;
}

export interface RepoDTO {
  id: string;
  name: string;
  sizeMb: number;
  currentRole: string;
  targetRole: string;
  findings: string;
  dupScore: number;
  status: string;
}

export interface StageDTO {
  id: string;
  code: string;
  title: string;
  detail: string;
  gate: string;
  gateType: string;
  state: string;
  attSeq: number | null;
  sortOrder: number;
}

export interface WeaveStateDTO {
  chainCount: number;
  headHash: string;
  agents: number;
  checkpoints: number;
  lastRoot: string | null;
  lastAnchorStatus: string | null;
  stats: Record<string, number>;
  networkAddress: string | null;
  /** מדד החיים הרשמי (חוק 8) — עבודה מאומתת ליחידת זמן, נספר מהספר */
  vitality: VitalityDTO;
}
