// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · API helpers — עטיפות JSON, קריאת body ומיפויי DTO
// (נוסף על ידי Task 2-a; לא נוגע בקבצים הסופיים types/chain/evm/merkle/anchor)
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { Agent, Checkpoint, PlanStage, RepoInventory } from "@prisma/client";
import { LedgerError } from "./ledger";
import type { AgentDTO, CheckpointDTO, RepoDTO, StageDTO } from "./types";

/** תפקידי סוכן חוקיים ברשת */
export const AGENT_ROLES = [
  "AUDITOR",
  "SCOUT",
  "BUILDER",
  "DAEMON",
  "RELAYER",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** תשובת הצלחה אחידה: { ok: true, ...payload } */
export function jsonOk<T extends object>(payload: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

/**
 * תשובת שגיאה אחידה: { ok: false, error } — הודעות בעברית.
 * LedgerError מוחזר עם ה-status שלו; כל דבר אחר → 500 גנרי (בלי לחשוף פנים).
 */
export function jsonError(error: unknown): NextResponse {
  if (error instanceof LedgerError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  // לוג שרת בלבד — בלי חומר מפתחות לעולם (הודעות שגיאה בלבד)
  console.error(
    "[weave/api] שגיאה פנימית:",
    error instanceof Error ? error.message : String(error)
  );
  return NextResponse.json(
    { ok: false, error: "שגיאת שרת פנימית — הפעולה לא הושלמה, נסה שוב" },
    { status: 500 }
  );
}

/** קריאת body כ-JSON בזהירות — body ריק/שבור מחזיר אובייקט ריק */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

// ─── מיפויי DTO (מפורשים — כדי ש-devKeyHex לעולם לא ידלוף) ───────────

export function toAgentDTO(agent: Agent, attCount: number): AgentDTO {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    ethAddress: agent.ethAddress,
    pubKeyHex: agent.pubKeyHex,
    status: agent.status,
    // R117 — כנות-יכולת: הסטטוס "ACTIVE" שיקר כשאין מפתח-חתימה בסביבה.
    // היכולת נמדדת מנוכחות devKeyHex (לעולם לא נחשף בעצמו), לא מהשדה.
    capability: agent.devKeyHex ? "SEALED-SIGNER" : "IDENTITY-ONLY",
    attCount,
    createdAt: agent.createdAt.toISOString(),
  };
}

export function toCheckpointDTO(row: Checkpoint): CheckpointDTO {
  return {
    index: row.index,
    attFrom: row.attFrom,
    attTo: row.attTo,
    leafCount: row.leafCount,
    root: row.root,
    prevRoot: row.prevRoot,
    entryHash: row.entryHash,
    sig: row.sig,
    signerAddr: row.signerAddr,
    anchorStatus: row.anchorStatus,
    anchorNet: row.anchorNet,
    anchorTx: row.anchorTx,
    calldata: row.calldata,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRepoDTO(row: RepoInventory): RepoDTO {
  return {
    id: row.id,
    name: row.name,
    sizeMb: row.sizeMb,
    currentRole: row.currentRole,
    targetRole: row.targetRole,
    findings: row.findings,
    dupScore: row.dupScore,
    status: row.status,
  };
}

export function toStageDTO(row: PlanStage): StageDTO {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    detail: row.detail,
    gate: row.gate,
    gateType: row.gateType,
    state: row.state,
    attSeq: row.attSeq,
    sortOrder: row.sortOrder,
  };
}
