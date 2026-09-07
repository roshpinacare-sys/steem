/**
 * TFA Evolution Studio v28 — Backlog Engine
 *
 * Cross-project backlog management with scan, scoring, and automatic item
 * generation from learning outcomes.
 *
 * V23 additions:
 *   - `applyPromotedPatternsToPrioritization()` — reads PrioritizationHints
 *     from the pattern promoter and uplifts backlog items whose topics match
 *     high-confidence proven areas, and downgrades items in topics with many
 *     taxonomy failure entries.
 *   - `backlogFromTaxonomy()` — auto-generates backlog items from the failure
 *     taxonomy so recurring failure modes surface as tracked work items.
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getProjectDir, ensureDir } from "@/lib/paths";
import {
  buildPrioritizationHints,
  getTopFailureModes,
} from "@/lib/distillation/pattern-promoter";
import type { BacklogItem, JobPriority } from "@/lib/types";

const BACKLOG_FILE = path.join(
  getProjectDir("").replace(/\/projects\/\/?$/, ""),
  "backlog.json"
);

function loadBacklog(): BacklogItem[] {
  if (!fs.existsSync(BACKLOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(BACKLOG_FILE, "utf-8")) as BacklogItem[];
  } catch {
    return [];
  }
}

function saveBacklog(items: BacklogItem[]): void {
  ensureDir(path.dirname(BACKLOG_FILE));
  fs.writeFileSync(BACKLOG_FILE, JSON.stringify(items, null, 2));
}

export function getAllBacklogItems(): BacklogItem[] {
  return loadBacklog();
}

export function getTopBacklogItems(n = 10): BacklogItem[] {
  const items = loadBacklog();
  const priorityOrder: Record<JobPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  return items
    .filter((i) => i.status !== "resolved" && i.status !== "wont_fix")
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, n);
}

export function applyLearningScoreAdjustments(item: BacklogItem): BacklogItem {
  if (item.source === "learning" && item.priority !== "critical") {
    const next: Record<JobPriority, JobPriority> = {
      low: "normal",
      normal: "high",
      high: "critical",
      critical: "critical",
    };
    return { ...item, priority: next[item.priority] };
  }
  return item;
}

/**
 * Adjust backlog item priorities using distilled prioritization hints and
 * failure taxonomy data.
 *
 * High-confidence proven topics → uplift priority of matching open items.
 * Topics with many taxonomy failures → add a warning tag but do not lower
 * priority (failures need addressing, not deferral).
 *
 * Returns the number of items whose priority was adjusted.
 */
export function applyPromotedPatternsToPrioritization(): number {
  const items = loadBacklog();
  const hints = buildPrioritizationHints();
  const failureModes = getTopFailureModes(20);

  const highConfidenceTopics = new Set(
    hints.filter((h) => h.confidenceScore >= 0.5).map((h) => h.topic)
  );
  const failureTopics = new Set(failureModes.map((f) => f.topic));

  const priorityUp: Record<JobPriority, JobPriority> = {
    low: "normal",
    normal: "high",
    high: "critical",
    critical: "critical",
  };

  let adjusted = 0;
  const updated = items.map((item) => {
    if (item.status === "resolved" || item.status === "wont_fix") return item;
    let mutated = { ...item };

    const matchesTopic =
      highConfidenceTopics.has(item.title) ||
      [...highConfidenceTopics].some(
        (t) =>
          item.title.toLowerCase().includes(t.toLowerCase()) ||
          (item.description ?? "").toLowerCase().includes(t.toLowerCase())
      );

    if (matchesTopic && item.priority !== "critical") {
      mutated = { ...mutated, priority: priorityUp[item.priority] };
      adjusted++;
    }

    const matchesFailure =
      failureTopics.has(item.title) ||
      [...failureTopics].some(
        (t) =>
          item.title.toLowerCase().includes(t.toLowerCase()) ||
          (item.description ?? "").toLowerCase().includes(t.toLowerCase())
      );

    if (matchesFailure) {
      mutated = {
        ...mutated,
        description: `[failure-taxonomy] ${mutated.description ?? ""}`.trim(),
      };
    }

    return mutated;
  });

  saveBacklog(updated);
  return adjusted;
}

/**
 * Auto-generate backlog items from the top recurring failure taxonomy entries.
 * Idempotent: skips entries that already have a backlog item with source "taxonomy".
 */
export function backlogFromTaxonomy(projectId: string): BacklogItem[] {
  const failureModes = getTopFailureModes(10);
  const items = loadBacklog();
  const added: BacklogItem[] = [];

  for (const fm of failureModes) {
    const alreadyTracked = items.some(
      (i) =>
        i.projectId === projectId &&
        i.source === "taxonomy" &&
        i.title.includes(fm.topic)
    );
    if (alreadyTracked) continue;

    const newItem = addBacklogItem({
      projectId,
      title: `Recurring failure: ${fm.topic}`,
      description: `${fm.symptom}\n\nRecovery hint: ${fm.recoveryHint}\n\nOccurrences: ${fm.count}`,
      status: "open",
      priority: fm.count >= 3 ? "high" : "normal",
      source: "taxonomy" as BacklogItem["source"],
    });
    added.push(newItem);
  }

  return added;
}

export function addBacklogItem(
  item: Omit<BacklogItem, "id" | "detectedAt">
): BacklogItem {
  const items = loadBacklog();
  let newItem: BacklogItem = {
    ...item,
    id: `bli_${Date.now()}`,
    detectedAt: new Date().toISOString(),
  };
  newItem = applyLearningScoreAdjustments(newItem);
  items.push(newItem);
  saveBacklog(items);
  return newItem;
}

export function updateBacklogItemStatus(
  projectId: string,
  id: string,
  status: BacklogItem["status"]
): BacklogItem | undefined {
  const items = loadBacklog();
  const idx = items.findIndex((i) => i.id === id && i.projectId === projectId);
  if (idx === -1) return undefined;
  items[idx] = { ...items[idx], status };
  saveBacklog(items);
  return items[idx];
}

export function resolveBacklogItem(
  projectId: string,
  id: string,
  resolvedInVersion: string
): BacklogItem | undefined {
  const items = loadBacklog();
  const idx = items.findIndex((i) => i.id === id && i.projectId === projectId);
  if (idx === -1) return undefined;
  items[idx] = {
    ...items[idx],
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolvedInVersion,
  };
  saveBacklog(items);
  return items[idx];
}

export function scanAllProjectBacklogs(): {
  projectId: string;
  itemsAdded: number;
}[] {
  const results: { projectId: string; itemsAdded: number }[] = [];
  const root = getProjectDir("").replace(/\/projects\/\/?$/, "/projects");
  if (!fs.existsSync(root)) return results;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectId = entry.name;
    const existing = loadBacklog().filter(
      (i) => i.projectId === projectId && i.source === "scan"
    );
    if (existing.length === 0) {
      addBacklogItem({
        projectId,
        title: "Initial project scan",
        description: "Auto-generated from periodic backlog scan.",
        status: "open",
        priority: "normal",
        source: "scan",
      });
      results.push({ projectId, itemsAdded: 1 });
    } else {
      results.push({ projectId, itemsAdded: 0 });
    }
  }
  return results;
}
