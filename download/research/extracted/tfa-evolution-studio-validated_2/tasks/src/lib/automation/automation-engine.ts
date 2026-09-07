/**
 * TFA Evolution Studio v28 — Automation Engine
 *
 * Rule-based event processing with trigger matching,
 * action execution, and append-only audit logging.
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { AUTOMATION_FILE, AUTOMATION_LOG_FILE, ensureDir } from "@/lib/paths";
import type { AutomationRule, AutomationLog } from "@/lib/types";

function loadRules(): AutomationRule[] {
  if (!fs.existsSync(AUTOMATION_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(AUTOMATION_FILE, "utf-8")) as AutomationRule[];
  } catch {
    return [];
  }
}

function saveRules(rules: AutomationRule[]): void {
  ensureDir(path.dirname(AUTOMATION_FILE));
  fs.writeFileSync(AUTOMATION_FILE, JSON.stringify(rules, null, 2));
}

function loadLogs(): AutomationLog[] {
  if (!fs.existsSync(AUTOMATION_LOG_FILE)) return [];
  const lines = fs.readFileSync(AUTOMATION_LOG_FILE, "utf-8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as AutomationLog);
}

function appendLog(log: AutomationLog): void {
  ensureDir(path.dirname(AUTOMATION_LOG_FILE));
  fs.appendFileSync(AUTOMATION_LOG_FILE, JSON.stringify(log) + "\n");
}

export function listRules(projectId?: string): AutomationRule[] {
  const rules = loadRules();
  return projectId ? rules.filter((r) => r.projectId === projectId || r.projectId === "__global__") : rules;
}

export function createRule(rule: Omit<AutomationRule, "id" | "createdAt">): AutomationRule {
  const rules = loadRules();
  const newRule: AutomationRule = {
    ...rule,
    id: `rul_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  rules.push(newRule);
  saveRules(rules);
  return newRule;
}

export function updateRule(id: string, updates: Partial<AutomationRule>): AutomationRule | undefined {
  const rules = loadRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return undefined;
  rules[idx] = { ...rules[idx], ...updates };
  saveRules(rules);
  return rules[idx];
}

export function deleteRule(id: string): boolean {
  const rules = loadRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  saveRules(rules);
  return true;
}

export function getAutomationLogs(limit = 200): AutomationLog[] {
  return loadLogs().slice(-limit).reverse();
}

export function fireAutomation(
  event: string,
  payload: Record<string, unknown>,
  projectId?: string
): AutomationLog[] {
  const rules = loadRules();
  const fired: AutomationLog[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (projectId && rule.projectId !== "__global__" && rule.projectId !== projectId) continue;
    if (rule.trigger.event !== event) continue;

    // Simple condition matching
    if (rule.trigger.condition) {
      let match = true;
      for (const [key, value] of Object.entries(rule.trigger.condition)) {
        if (payload[key] !== value) {
          match = false;
          break;
        }
      }
      if (!match) continue;
    }

    const logEntry: AutomationLog = {
      id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ruleId: rule.id,
      firedAt: new Date().toISOString(),
      result: "success",
      message: `Fired rule "${rule.name}" on event "${event}"`,
    };

    // Execute actions (simplified — real system would dispatch)
    for (const action of rule.actions) {
      logEntry.message += ` | action:${action.type}`;
    }

    appendLog(logEntry);
    fired.push(logEntry);
  }

  return fired;
}
