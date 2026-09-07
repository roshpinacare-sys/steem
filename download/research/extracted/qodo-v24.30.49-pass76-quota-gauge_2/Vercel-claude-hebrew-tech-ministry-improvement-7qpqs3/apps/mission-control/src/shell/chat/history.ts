/**
 * chat/history.ts — device-local persistence for the console conversation, so
 * it survives navigation, reloads, and app restarts (like every serious chat).
 */
import type { ChatTurn } from "./engine.js";

const KEY = "qodo:chat:history";
const MAX = 60;

export function loadHistory(): ChatTurn[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatTurn[];
    return Array.isArray(parsed) ? parsed.slice(-MAX) : [];
  } catch { return []; }
}

export function saveHistory(turns: ChatTurn[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(turns.slice(-MAX))); } catch { /* ignore */ }
}

export function clearHistory(): void {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
