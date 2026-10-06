// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · AUTONOMY LAW (server copy) — חוק-העצירה והחשיבה (r197)
//
// העתק-השרת של חוק mini-services/autonomy.ts — שניהם קוראים/כותבים את
// אותו קובץ-אמת יחיד (sovereign/autonomy/GATE.json). טהור node:fs —
// אפס תלות, fail-closed: קובץ קרוע/לא-קריא ⇒ PAUSED (היעדר-אמת אינו היתר).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const AUTONOMY_DIR = "/home/z/my-project/sovereign/autonomy";
export const GATE_FILE = `${AUTONOMY_DIR}/GATE.json`;
export const DELIB_FILE = `${AUTONOMY_DIR}/deliberations.jsonl`;

export type AutonomyMode = "PAUSED" | "THINKING" | "ACTIVE";

export interface AutonomyGate {
  mode: AutonomyMode;
  since: string;
  reason: string;
  setBy: string;
  updatedAt: string;
}

export interface Deliberation {
  seq?: number;
  prevHash?: string;
  entryHash?: string;
  at: string;
  action: string;
  actor: string;
  claim: string;
  why: string;
  expected: string;
  risk: string;
  rollback: string;
  /** r206 — תחזית-מחלקה-ראשונה: מה יפריך את התחזית באופן מדיד (אופציונלי; סנכרון עם mini-services/autonomy.ts) */
  falsifier?: string;
}

const VALID_MODES: AutonomyMode[] = ["PAUSED", "THINKING", "ACTIVE"];
const REQUIRED_FIELDS: Array<keyof Deliberation> = ["action", "actor", "claim", "why", "expected", "risk", "rollback"];

function defaultGate(): AutonomyGate {
  return {
    mode: "PAUSED",
    since: new Date().toISOString(),
    reason: "fail-closed: קובץ-השער לא נמצא/לא-קריא — היעדר-אמת אינו היתר (חוק-r197)",
    setBy: "law:default",
    updatedAt: new Date().toISOString(),
  };
}

export function readGate(): AutonomyGate {
  try {
    const raw = JSON.parse(fs.readFileSync(GATE_FILE, "utf8")) as Partial<AutonomyGate>;
    if (!raw || !VALID_MODES.includes(raw.mode as AutonomyMode)) return defaultGate();
    return {
      mode: raw.mode as AutonomyMode,
      since: String(raw.since ?? new Date().toISOString()),
      reason: String(raw.reason ?? ""),
      setBy: String(raw.setBy ?? "unknown"),
      updatedAt: String(raw.updatedAt ?? raw.since ?? new Date().toISOString()),
    };
  } catch {
    return defaultGate();
  }
}

function writeTextAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export function writeGate(next: { mode: AutonomyMode; reason: string; setBy: string }): AutonomyGate {
  const gate: AutonomyGate = {
    mode: next.mode,
    since: new Date().toISOString(),
    reason: String(next.reason ?? "").slice(0, 300),
    setBy: String(next.setBy ?? "unknown").slice(0, 80),
    updatedAt: new Date().toISOString(),
  };
  writeTextAtomic(GATE_FILE, `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function validDeliberation(d: Partial<Deliberation> | undefined | null): d is Deliberation {
  if (!d) return false;
  for (const f of REQUIRED_FIELDS) {
    const v = d[f];
    if (typeof v !== "string" || v.trim().length < 8) return false;
  }
  return true;
}

function hashDeliberation(d: object): string {
  const { entryHash: _omit, ...rest } = d as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export function readDeliberations(limit = 50): Deliberation[] {
  try {
    const raw = fs.readFileSync(DELIB_FILE, "utf8").trim();
    if (!raw) return [];
    return raw.split("\n").slice(-limit).map((l) => JSON.parse(l) as Deliberation);
  } catch {
    return [];
  }
}

/** רישום דיון חדש — שרשרת-גיבוב כמו יומן-ההחלטות */
export function appendDeliberation(d: Omit<Deliberation, "seq" | "prevHash" | "entryHash" | "at"> & { at?: string }): Deliberation {
  fs.mkdirSync(AUTONOMY_DIR, { recursive: true });
  const all = readDeliberations(500);
  const prev = all.length > 0 ? all[all.length - 1]! : null;
  const rec: Deliberation = {
    seq: (prev?.seq ?? 0) + 1,
    prevHash: prev?.entryHash ?? "GENESIS",
    at: d.at ?? new Date().toISOString(),
    action: String(d.action).slice(0, 60),
    actor: String(d.actor).slice(0, 60),
    claim: String(d.claim).slice(0, 400),
    why: String(d.why).slice(0, 400),
    expected: String(d.expected).slice(0, 400),
    risk: String(d.risk).slice(0, 400),
    rollback: String(d.rollback).slice(0, 400),
    // r206 — הפרכה נרשמת לפני-המעשה (סנכרון עם mini-services/autonomy.ts)
    ...(typeof d.falsifier === "string" && d.falsifier.trim().length > 0
      ? { falsifier: String(d.falsifier).slice(0, 200) }
      : {}),
  };
  rec.entryHash = hashDeliberation(rec);
  fs.appendFileSync(DELIB_FILE, `${JSON.stringify(rec)}\n`, "utf8");
  return rec;
}
