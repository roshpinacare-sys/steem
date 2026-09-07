import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export interface ReplayRecord {
  namespace: string;
  id: string;
  payloadSha256: string;
  acceptedAt: string;
  expiresAt?: string;
}

export interface ReplayLedger {
  consume(record: ReplayRecord, now?: Date): void;
  has(namespace: string, id: string, now?: Date): boolean;
  prune(now?: Date): number;
}

function keyOf(namespace: string, id: string): string {
  const ns = namespace.trim();
  const value = id.trim();
  if (!ns || !value || ns.length > 100 || value.length > 300) throw new Error("replay_key_invalid");
  return `${ns}:${value}`;
}

function isExpired(record: ReplayRecord, now: Date): boolean {
  return Boolean(record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime());
}

export class InMemoryReplayLedger implements ReplayLedger {
  private readonly records = new Map<string, ReplayRecord>();

  consume(record: ReplayRecord, now = new Date()): void {
    const key = keyOf(record.namespace, record.id);
    const existing = this.records.get(key);
    if (existing && !isExpired(existing, now)) {
      if (existing.payloadSha256 !== record.payloadSha256) throw new Error("replay_identifier_collision");
      throw new Error("replay_detected");
    }
    this.records.set(key, structuredClone(record));
  }

  has(namespace: string, id: string, now = new Date()): boolean {
    const existing = this.records.get(keyOf(namespace, id));
    return Boolean(existing && !isExpired(existing, now));
  }

  prune(now = new Date()): number {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (isExpired(record, now)) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

interface LedgerFile {
  version: 1;
  records: ReplayRecord[];
}

export class JsonFileReplayLedger implements ReplayLedger {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  private read(): Map<string, ReplayRecord> {
    if (!existsSync(this.path)) return new Map();
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as LedgerFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) throw new Error("replay_ledger_format_invalid");
    return new Map(parsed.records.map((record) => [keyOf(record.namespace, record.id), record]));
  }

  private write(records: Map<string, ReplayRecord>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp-${randomBytes(6).toString("hex")}`;
    const payload: LedgerFile = {
      version: 1,
      records: [...records.values()].sort((a, b) => keyOf(a.namespace, a.id).localeCompare(keyOf(b.namespace, b.id))),
    };
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.path);
  }

  consume(record: ReplayRecord, now = new Date()): void {
    const records = this.read();
    const key = keyOf(record.namespace, record.id);
    const existing = records.get(key);
    if (existing && !isExpired(existing, now)) {
      if (existing.payloadSha256 !== record.payloadSha256) throw new Error("replay_identifier_collision");
      throw new Error("replay_detected");
    }
    records.set(key, structuredClone(record));
    this.write(records);
  }

  has(namespace: string, id: string, now = new Date()): boolean {
    const existing = this.read().get(keyOf(namespace, id));
    return Boolean(existing && !isExpired(existing, now));
  }

  prune(now = new Date()): number {
    const records = this.read();
    let removed = 0;
    for (const [key, record] of records) {
      if (isExpired(record, now)) {
        records.delete(key);
        removed += 1;
      }
    }
    if (removed) this.write(records);
    return removed;
  }
}
