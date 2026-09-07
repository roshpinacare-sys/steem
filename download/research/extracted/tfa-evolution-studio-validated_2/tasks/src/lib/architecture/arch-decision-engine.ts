/**
 * TFA Evolution Studio v28 — Architecture Decision Engine
 *
 * Evaluates architectural decisions against platform standards
 * and records ADR-style decision logs.
 */

import fs from "fs";
import path from "path";
import { getTracesDir, ensureDir } from "@/lib/paths";

interface ArchDecision {
  id: string;
  projectId: string;
  title: string;
  context: string;
  decision: string;
  consequences: string[];
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  createdAt: string;
}

const DECISIONS_FILE = path.join(getTracesDir(), "decisions.json");

function loadDecisions(): ArchDecision[] {
  if (!fs.existsSync(DECISIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DECISIONS_FILE, "utf-8")) as ArchDecision[];
  } catch {
    return [];
  }
}

function saveDecisions(decisions: ArchDecision[]): void {
  ensureDir(path.dirname(DECISIONS_FILE));
  fs.writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2));
}

export function proposeDecision(
  projectId: string,
  decision: Omit<ArchDecision, "id" | "createdAt" | "status">
): ArchDecision {
  const decisions = loadDecisions();
  const newDecision: ArchDecision = {
    ...decision,
    id: `adr_${Date.now()}`,
    status: "proposed",
    createdAt: new Date().toISOString(),
  };
  decisions.push(newDecision);
  saveDecisions(decisions);
  return newDecision;
}

export function acceptDecision(id: string): ArchDecision | undefined {
  const decisions = loadDecisions();
  const idx = decisions.findIndex((d) => d.id === id);
  if (idx === -1) return undefined;
  decisions[idx].status = "accepted";
  saveDecisions(decisions);
  return decisions[idx];
}

export function getProjectDecisions(projectId: string): ArchDecision[] {
  return loadDecisions().filter((d) => d.projectId === projectId);
}
