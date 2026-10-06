// ─────────────────────────────────────────────────────────────────────
// הכרזת טיפוסים מינימלית ל-bun:sqlite — brain-restore.ts רץ תחת Bun
// (שחזור המוח בענן, מחוץ ל-Next.js); כאן מוצהר רק ה-API שבשימוש בפועל:
// new Database(path, { readonly }), query(sql).get(), query(sql).all(), close().
// דפוס ההכרזות של הצי (steem.d.ts, saos-live.d.ts) — ללא שינוי התנהגות.
// ─────────────────────────────────────────────────────────────────────

declare module "bun:sqlite" {
  export interface BunSqliteStatement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export class Database {
    constructor(
      path: string,
      options?: { readonly?: boolean; create?: boolean; readwrite?: boolean }
    );
    query(sql: string): BunSqliteStatement;
    close(): void;
  }
}
