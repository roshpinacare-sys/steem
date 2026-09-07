import { RedisState } from "./redis-state.js";

const FOURTEEN_DAYS_SEC = 14 * 24 * 60 * 60;

function memoryKey(owner: string, repo: string) {
  return `warden:memory:${owner}:${repo}`;
}

export interface WardenLesson {
  path: string;
  rule: string;
  count: number;
  lastSeen: string;
}

export async function recordWardenRejection(
  owner: string,
  repo: string,
  path: string,
  rule: string,
  state: RedisState,
): Promise<void> {
  const key = memoryKey(owner, repo);
  const memory = (await state.getJSON<Record<string, WardenLesson>>(key)) || {};
  const id = `${path}::${rule}`;
  const existing = memory[id];
  memory[id] = {
    path,
    rule,
    count: (existing?.count || 0) + 1,
    lastSeen: new Date().toISOString(),
  };
  await state.setJSONWithTTL(key, memory, FOURTEEN_DAYS_SEC);
}

export async function loadWardenLessons(
  owner: string,
  repo: string,
  state: RedisState,
  limit = 5,
): Promise<WardenLesson[]> {
  const memory = await state.getJSON<Record<string, WardenLesson>>(memoryKey(owner, repo));
  if (!memory) return [];
  return Object.values(memory)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
