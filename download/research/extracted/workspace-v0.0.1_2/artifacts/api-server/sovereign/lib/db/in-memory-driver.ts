/**
 * lib/db/in-memory-driver.ts — InMemoryDriver: pg.Pool-compatible in-memory DB.
 *
 * PURPOSE
 * -------
 * Replaces a real PostgreSQL connection in tests and local dev.
 * Implements DbPool (see types.ts), so any code that accepts DbPool
 * works identically against a live Postgres or this in-memory engine.
 *
 * WHAT IT SUPPORTS
 * ----------------
 * DDL:
 *   CREATE TABLE t (col type, ...)  — stores schema, creates empty table
 *   DROP TABLE [IF EXISTS] t        — removes table + data
 *
 * DML:
 *   INSERT INTO t (cols) VALUES ($1, $2, ...)          — one row per call
 *   SELECT col,... FROM t [WHERE ...] [ORDER BY ...] [LIMIT n] [OFFSET m]
 *   UPDATE t SET col=$1 [WHERE ...]                    — updates matching rows
 *   DELETE FROM t [WHERE ...]                          — removes matching rows
 *
 * Expressions:
 *   =, !=, <>, <, >, <=, >=, IS NULL, IS NOT NULL, LIKE, ILIKE
 *   AND / OR (left-associative, AND before OR)
 *   Parameterised placeholders $1 … $N
 *
 * WHAT IT DOES NOT SUPPORT (by design — add when needed)
 * -------------------------------------------------------
 * JOINs, subqueries, RETURNING, ON CONFLICT, transactions with SAVEPOINT,
 * aggregate functions, window functions, full-text search, JSONB operators.
 *
 * TENANT ISOLATION
 * ----------------
 * The engine itself is tenant-agnostic — it stores whatever rows are given.
 * Tenant isolation is enforced by the application's WHERE tenantId = $N clauses,
 * exactly as it would be against a real Postgres. Tests must pass tenantId
 * in WHERE; the engine will verify the filter works.
 *
 * CONCURRENCY
 * -----------
 * Node is single-threaded so all Map mutations are atomic within one event-loop
 * turn. For multi-process use, replace with a real pg.Pool (same interface).
 */

import { randomUUID } from "node:crypto";
import type {
  Row,
  QueryResult,
  QueryConfig,
  DbPool,
  PoolClient,
  TableDef,
  Transaction,
} from "./types.ts";

// ─── Internal store types ─────────────────────────────────────────────────────

interface StoredRow extends Row {
  __rowid__: string; // internal surrogate key — never exposed to callers
}

interface TableStore {
  def: TableDef;
  rows: StoredRow[];
}

// ─── SQL tokeniser ────────────────────────────────────────────────────────────

type TokenKind =
  | "KEYWORD" | "IDENT" | "NUMBER" | "STRING" | "PARAM"
  | "COMMA" | "LPAREN" | "RPAREN" | "STAR" | "OP" | "SEMI";

interface Token { kind: TokenKind; value: string; }

/**
 * Reserved SQL keywords. Module-level (computed once at load) instead of
 * rebuilt on every tokenise() call — every DB operation in this driver
 * invokes tokenise(), so this was previously rebuilt once per query.
 */
const KEYWORDS = new Set([
  "SELECT","FROM","WHERE","INSERT","INTO","VALUES","UPDATE","SET",
  "DELETE","CREATE","DROP","TABLE","IF","EXISTS","ORDER","BY","ASC","DESC",
  "LIMIT","OFFSET","AND","OR","NOT","IS","NULL","LIKE","ILIKE","IN",
  "BEGIN","COMMIT","ROLLBACK","PRIMARY","KEY","UNIQUE","DEFAULT","CONSTRAINT",
  "RETURNING","ON","CONFLICT","DO","NOTHING","INDEX",
]);

/**
 * Two-character operators. Module-level Set instead of an array literal that
 * was previously allocated fresh and linearly scanned on every character
 * scanned by the tokenizer (the hottest loop in this file).
 */
const TWO_CHAR_OPERATORS = new Set(["!=", "<>", "<=", ">=", "::", "||"]);

function tokenise(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = sql.trim();

  while (i < s.length) {
    // whitespace
    if (/\s/.test(s[i])) { i++; continue; }
    // line comment
    if (s[i] === "-" && s[i+1] === "-") { while (i < s.length && s[i] !== "\n") i++; continue; }
    // block comment
    if (s[i] === "/" && s[i+1] === "*") {
      i += 2;
      while (i < s.length && !(s[i-1] === "*" && s[i] === "/")) i++;
      i++; continue;
    }
    // string literal 'text'
    if (s[i] === "'") {
      let v = ""; i++;
      while (i < s.length) {
        if (s[i] === "'" && s[i+1] === "'") { v += "'"; i += 2; }
        else if (s[i] === "'") { i++; break; }
        else { v += s[i++]; }
      }
      tokens.push({ kind: "STRING", value: v }); continue;
    }
    // parameter $N
    if (s[i] === "$") {
      let v = "$"; i++;
      while (i < s.length && /\d/.test(s[i])) v += s[i++];
      tokens.push({ kind: "PARAM", value: v }); continue;
    }
    // number
    if (/\d/.test(s[i])) {
      let v = "";
      while (i < s.length && /[\d.]/.test(s[i])) v += s[i++];
      tokens.push({ kind: "NUMBER", value: v }); continue;
    }
    // identifier or keyword
    if (/[a-z_"]/i.test(s[i])) {
      let v = "";
      if (s[i] === '"') { // quoted identifier
        i++;
        while (i < s.length && s[i] !== '"') v += s[i++];
        i++;
      } else {
        while (i < s.length && /[\w]/.test(s[i])) v += s[i++];
      }
      const up = v.toUpperCase();
      tokens.push({ kind: KEYWORDS.has(up) ? "KEYWORD" : "IDENT", value: v }); continue;
    }
    // operators
    const twoChar = s.slice(i, i+2);
    if (TWO_CHAR_OPERATORS.has(twoChar)) {
      tokens.push({ kind: "OP", value: twoChar }); i += 2; continue;
    }
    if ("=<>!".includes(s[i])) { tokens.push({ kind: "OP", value: s[i] }); i++; continue; }
    if (s[i] === ",") { tokens.push({ kind: "COMMA", value: "," }); i++; continue; }
    if (s[i] === "(") { tokens.push({ kind: "LPAREN", value: "(" }); i++; continue; }
    if (s[i] === ")") { tokens.push({ kind: "RPAREN", value: ")" }); i++; continue; }
    if (s[i] === "*") { tokens.push({ kind: "STAR", value: "*" }); i++; continue; }
    if (s[i] === ";") { tokens.push({ kind: "SEMI", value: ";" }); i++; continue; }
    // skip unknown characters (e.g. type casts ::, colons)
    i++;
  }
  return tokens;
}

// ─── LIKE/ILIKE regex memoization ──────────────────────────────────────────────
//
// evalExpr's "like" case runs once per row during a table scan (SELECT/UPDATE/
// DELETE WHERE filtering). The SQL pattern and case-sensitivity flag are almost
// always identical across the whole scan (one WHERE clause, many rows), so
// recompiling `new RegExp(...)` on every row is wasted work proportional to
// table size. LIKE_RE_CACHE memoizes the compiled RegExp per (flags, pattern)
// so a full-table LIKE scan compiles the pattern once instead of N times.
// Bounded to avoid unbounded growth from pathological/dynamic pattern columns.

const LIKE_RE_CACHE = new Map<string, RegExp>();
const LIKE_RE_CACHE_MAX = 500;

function compileLikeRegex(pat: string, icase: boolean): RegExp {
  const key = (icase ? "i\u0000" : "\u0000") + pat;
  const cached = LIKE_RE_CACHE.get(key);
  if (cached) return cached;
  const regex = pat
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "%" || c === "_") ? c : "\\" + c)
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  const compiled = new RegExp("^" + regex + "$", icase ? "i" : "");
  if (LIKE_RE_CACHE.size >= LIKE_RE_CACHE_MAX) LIKE_RE_CACHE.clear(); // simple bound, not LRU
  LIKE_RE_CACHE.set(key, compiled);
  return compiled;
}

// ─── Expression evaluator ─────────────────────────────────────────────────────

type Expr =
  | { type: "lit"; value: unknown }
  | { type: "col"; name: string }
  | { type: "param"; index: number }
  | { type: "op"; op: string; left: Expr; right: Expr }
  | { type: "is_null"; col: string; negate: boolean }
  | { type: "like"; col: string; pattern: Expr; icase: boolean; negate: boolean }
  | { type: "and"; clauses: Expr[] }
  | { type: "or"; clauses: Expr[] }
  | { type: "not"; inner: Expr };

function evalExpr(expr: Expr, row: Row, params: unknown[]): unknown {
  switch (expr.type) {
    case "lit": return expr.value;
    case "col": return row[expr.name] ?? row[expr.name.toLowerCase()];
    case "param": return params[expr.index - 1];
    case "is_null": {
      const v = row[expr.col] ?? row[expr.col.toLowerCase()];
      const isNull = v === null || v === undefined;
      return expr.negate ? !isNull : isNull;
    }
    case "like": {
      const v = String(evalExpr({ type: "col", name: expr.col }, row, params) ?? "");
      const pat = String(evalExpr(expr.pattern, row, params) ?? "");
      const match = compileLikeRegex(pat, expr.icase).test(v);
      return expr.negate ? !match : match;
    }
    case "op": {
      const l = evalExpr(expr.left, row, params);
      const r = evalExpr(expr.right, row, params);
      switch (expr.op) {
        case "=": return l === r || (l !== null && r !== null && String(l) === String(r));
        case "!=": case "<>": return l !== r;
        case "<": return (l as number) < (r as number);
        case ">": return (l as number) > (r as number);
        case "<=": return (l as number) <= (r as number);
        case ">=": return (l as number) >= (r as number);
        default: return false;
      }
    }
    case "and": return expr.clauses.every((c) => evalExpr(c, row, params));
    case "or": return expr.clauses.some((c) => evalExpr(c, row, params));
    case "not": return !evalExpr(expr.inner, row, params);
  }
}

// ─── WHERE parser ─────────────────────────────────────────────────────────────

class TokenStream {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }
  peek(offset = 0): Token | undefined { return this.tokens[this.pos + offset]; }
  next(): Token | undefined { return this.tokens[this.pos++]; }
  matches(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.value.toUpperCase() === value.toUpperCase();
  }
  consume(value?: string): Token | undefined {
    const t = this.next();
    if (value && t?.value.toUpperCase() !== value.toUpperCase()) {
      throw new Error(`Expected '${value}', got '${t?.value ?? "EOF"}'`);
    }
    return t;
  }
  atEnd(): boolean { return this.pos >= this.tokens.length; }
  remaining(): Token[] { return this.tokens.slice(this.pos); }
  clone(): TokenStream { const s = new TokenStream(this.tokens); s.pos = this.pos; return s; }
  setPos(pos: number) { this.pos = pos; }
  getPos(): number { return this.pos; }
}

function parseAtom(ts: TokenStream): Expr {
  // NOT prefix
  if (ts.matches("NOT")) { ts.next(); return { type: "not", inner: parseAtom(ts) }; }

  // Parenthesised
  if (ts.peek()?.kind === "LPAREN") {
    ts.next();
    const inner = parseOr(ts);
    ts.consume(")");
    return inner;
  }

  // Literal: number, string, NULL keyword
  const t = ts.peek();
  if (!t) throw new Error("Unexpected end of expression");

  if (t.kind === "NUMBER") { ts.next(); return { type: "lit", value: Number(t.value) }; }
  if (t.kind === "STRING") { ts.next(); return { type: "lit", value: t.value }; }
  if (t.kind === "KEYWORD" && t.value.toUpperCase() === "NULL") {
    ts.next(); return { type: "lit", value: null };
  }
  if (t.kind === "PARAM") {
    ts.next(); return { type: "param", index: parseInt(t.value.slice(1), 10) };
  }

  // Column reference or keyword-as-ident
  if (t.kind === "IDENT" || t.kind === "KEYWORD") {
    ts.next();
    const col = t.value;

    // IS [NOT] NULL
    if (ts.matches("IS")) {
      ts.next();
      const negate = ts.matches("NOT");
      if (negate) ts.next();
      ts.consume("NULL");
      return { type: "is_null", col, negate };
    }
    // [NOT] LIKE / ILIKE
    const negLike = ts.matches("NOT") && (ts.matches("LIKE", 1) || ts.matches("ILIKE", 1));
    if (negLike) { ts.next(); }
    if (ts.matches("LIKE") || ts.matches("ILIKE")) {
      const icase = ts.peek()!.value.toUpperCase() === "ILIKE";
      ts.next();
      const pat = parseAtom(ts);
      return { type: "like", col, pattern: pat, icase, negate: negLike };
    }

    // Binary operator
    const op = ts.peek();
    if (op && op.kind === "OP") {
      ts.next();
      const rhs = parseAtom(ts);
      return { type: "op", op: op.value, left: { type: "col", name: col }, right: rhs };
    }

    return { type: "col", name: col };
  }

  throw new Error(`Unexpected token '${t.value}' (${t.kind}) in WHERE expression`);
}

function parseAnd(ts: TokenStream): Expr {
  const clauses: Expr[] = [parseAtom(ts)];
  while (ts.matches("AND")) { ts.next(); clauses.push(parseAtom(ts)); }
  return clauses.length === 1 ? clauses[0] : { type: "and", clauses };
}

function parseOr(ts: TokenStream): Expr {
  const clauses: Expr[] = [parseAnd(ts)];
  while (ts.matches("OR")) { ts.next(); clauses.push(parseAnd(ts)); }
  return clauses.length === 1 ? clauses[0] : { type: "or", clauses };
}

function parseWhere(ts: TokenStream): Expr | null {
  if (!ts.matches("WHERE")) return null;
  ts.next(); // consume WHERE
  return parseOr(ts);
}

// ─── SQL executor ─────────────────────────────────────────────────────────────

function stripRowId(row: StoredRow): Row {
  const { __rowid__: _omit, ...rest } = row;
  return rest;
}

class SqlEngine {
  private tables = new Map<string, TableStore>();

  /** Expose tables for snapshot / restore in transactions. */
  snapshot(): Map<string, TableStore> {
    const snap = new Map<string, TableStore>();
    for (const [name, store] of this.tables) {
      snap.set(name, { def: store.def, rows: store.rows.map((r) => ({ ...r })) });
    }
    return snap;
  }
  restore(snap: Map<string, TableStore>) { this.tables = snap; }

  execute<T extends Row = Row>(
    sql: string,
    params: unknown[] = []
  ): QueryResult<T> {
    const tokens = tokenise(sql.trim().replace(/;$/, "").trim());
    if (tokens.length === 0) return empty("", 0) as unknown as QueryResult<T>;
    const ts = new TokenStream(tokens);
    const kw = ts.peek()?.value.toUpperCase();

    switch (kw) {
      case "SELECT": return this.execSelect<T>(ts, params);
      case "INSERT": return this.execInsert<T>(ts, params);
      case "UPDATE": return this.execUpdate<T>(ts, params);
      case "DELETE": return this.execDelete<T>(ts, params);
      case "CREATE": return this.execCreate(ts) as unknown as QueryResult<T>;
      case "DROP":   return this.execDrop(ts) as unknown as QueryResult<T>;
      case "BEGIN": case "COMMIT": case "ROLLBACK": return empty(kw, 0) as unknown as QueryResult<T>;
      default: return empty("", 0) as unknown as QueryResult<T>;
    }
  }

  // ── SELECT ──────────────────────────────────────────────────────────────────

  private execSelect<T extends Row>(ts: TokenStream, params: unknown[]): QueryResult<T> {
    ts.consume("SELECT");

    // Column list or *
    const cols: string[] = [];
    let star = false;
    if (ts.peek()?.kind === "STAR") { ts.next(); star = true; }
    else {
      while (!ts.matches("FROM") && !ts.atEnd()) {
        const t = ts.next()!;
        if (t.kind !== "COMMA") cols.push(t.value);
      }
    }

    ts.consume("FROM");
    const tableName = ts.next()!.value.toLowerCase();
    const store = this.tables.get(tableName);
    if (!store) throw new Error(`relation "${tableName}" does not exist`);

    const whereExpr = parseWhere(ts);

    // ORDER BY
    const orderCols: Array<{ col: string; desc: boolean }> = [];
    if (ts.matches("ORDER")) {
      ts.next(); ts.consume("BY");
      while (!ts.matches("LIMIT") && !ts.matches("OFFSET") && !ts.atEnd()) {
        const t = ts.next()!;
        if (t.kind === "COMMA") continue;
        const desc = ts.matches("DESC");
        if (ts.matches("ASC") || ts.matches("DESC")) ts.next();
        orderCols.push({ col: t.value, desc });
      }
    }

    // LIMIT
    let limit: number | null = null;
    if (ts.matches("LIMIT")) {
      ts.next();
      const t = ts.next()!;
      limit = t.kind === "PARAM" ? Number(params[parseInt(t.value.slice(1), 10) - 1]) : Number(t.value);
    }
    // OFFSET
    let offset = 0;
    if (ts.matches("OFFSET")) {
      ts.next();
      const t = ts.next()!;
      offset = t.kind === "PARAM" ? Number(params[parseInt(t.value.slice(1), 10) - 1]) : Number(t.value);
    }

    let result = store.rows.filter((row) =>
      !whereExpr || evalExpr(whereExpr, row, params)
    );

    // ORDER BY
    if (orderCols.length > 0) {
      result = [...result].sort((a, b) => {
        for (const { col, desc } of orderCols) {
          const av = a[col] ?? a[col.toLowerCase()] ?? null;
          const bv = b[col] ?? b[col.toLowerCase()] ?? null;
          if (av === bv) continue;
          const cmp = av === null ? -1 : bv === null ? 1 :
            av < bv ? -1 : av > bv ? 1 : 0;
          return desc ? -cmp : cmp;
        }
        return 0;
      });
    }

    // OFFSET + LIMIT
    if (offset > 0) result = result.slice(offset);
    if (limit !== null) result = result.slice(0, limit);

    const fieldNames = star
      ? store.def.columns.map((c) => c.name)
      : cols;

    const rows = result.map((row) => {
      if (star) return stripRowId(row) as T;
      const out: Row = {};
      for (const name of fieldNames) {
        const lower = name.toLowerCase();
        out[lower] = row[lower] ?? row[name] ?? null;
      }
      return out as T;
    });

    return {
      rows,
      rowCount: rows.length,
      fields: fieldNames.map((name) => ({ name: name.toLowerCase() })),
      command: "SELECT",
    };
  }

  // ── INSERT ──────────────────────────────────────────────────────────────────

  private execInsert<T extends Row>(ts: TokenStream, params: unknown[]): QueryResult<T> {
    ts.consume("INSERT");
    ts.consume("INTO");
    const tableName = ts.next()!.value.toLowerCase();
    const store = this.tables.get(tableName);
    if (!store) throw new Error(`relation "${tableName}" does not exist`);

    // Column list
    const cols: string[] = [];
    ts.consume("(");
    while (!ts.matches(")")) {
      const t = ts.next()!;
      if (t.kind !== "COMMA") cols.push(t.value.toLowerCase());
    }
    ts.consume(")");
    ts.consume("VALUES");
    ts.consume("(");
    const vals: unknown[] = [];
    while (!ts.matches(")")) {
      const t = ts.next()!;
      if (t.kind === "COMMA") continue;
      if (t.kind === "PARAM") vals.push(params[parseInt(t.value.slice(1), 10) - 1]);
      else if (t.kind === "NUMBER") vals.push(Number(t.value));
      else if (t.kind === "STRING") vals.push(t.value);
      else if (t.kind === "KEYWORD" && t.value.toUpperCase() === "NULL") vals.push(null);
      else vals.push(t.value);
    }
    ts.consume(")");

    // Apply column defaults for missing columns
    const newRow: StoredRow = { __rowid__: randomUUID() };
    for (const col of store.def.columns) {
      newRow[col.name.toLowerCase()] = col.default ?? null;
    }
    for (let j = 0; j < cols.length; j++) {
      newRow[cols[j]] = vals[j] ?? null;
    }

    store.rows.push(newRow);
    return { rows: [], rowCount: 1, fields: [], command: "INSERT 0 1" };
  }

  // ── UPDATE ──────────────────────────────────────────────────────────────────

  private execUpdate<T extends Row>(ts: TokenStream, params: unknown[]): QueryResult<T> {
    ts.consume("UPDATE");
    const tableName = ts.next()!.value.toLowerCase();
    const store = this.tables.get(tableName);
    if (!store) throw new Error(`relation "${tableName}" does not exist`);

    ts.consume("SET");

    // col = value [, col = value ...]
    const updates: Array<{ col: string; expr: Expr }> = [];
    while (!ts.matches("WHERE") && !ts.atEnd()) {
      const col = ts.next()!.value.toLowerCase();
      ts.consume("=");
      const t = ts.peek()!;
      let valExpr: Expr;
      if (t.kind === "PARAM") { ts.next(); valExpr = { type: "param", index: parseInt(t.value.slice(1), 10) }; }
      else if (t.kind === "NUMBER") { ts.next(); valExpr = { type: "lit", value: Number(t.value) }; }
      else if (t.kind === "STRING") { ts.next(); valExpr = { type: "lit", value: t.value }; }
      else if (t.kind === "KEYWORD" && t.value.toUpperCase() === "NULL") { ts.next(); valExpr = { type: "lit", value: null }; }
      else { ts.next(); valExpr = { type: "col", name: t.value }; }
      updates.push({ col, expr: valExpr });
      if (ts.peek()?.kind === "COMMA") ts.next();
    }

    const whereExpr = parseWhere(ts);
    let count = 0;

    for (const row of store.rows) {
      if (!whereExpr || evalExpr(whereExpr, row, params)) {
        for (const { col, expr } of updates) {
          row[col] = evalExpr(expr, row, params);
        }
        count++;
      }
    }

    return { rows: [], rowCount: count, fields: [], command: `UPDATE ${count}` };
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────

  private execDelete<T extends Row>(ts: TokenStream, params: unknown[]): QueryResult<T> {
    ts.consume("DELETE");
    ts.consume("FROM");
    const tableName = ts.next()!.value.toLowerCase();
    const store = this.tables.get(tableName);
    if (!store) throw new Error(`relation "${tableName}" does not exist`);

    const whereExpr = parseWhere(ts);
    const before = store.rows.length;
    store.rows = store.rows.filter((row) =>
      whereExpr ? !evalExpr(whereExpr, row, params) : false
    );
    const deleted = before - store.rows.length;
    return { rows: [], rowCount: deleted, fields: [], command: `DELETE ${deleted}` };
  }

  // ── CREATE TABLE ────────────────────────────────────────────────────────────

  private execCreate(ts: TokenStream): QueryResult<Row> {
    ts.consume("CREATE");
    ts.consume("TABLE");
    const ifNotExists = ts.matches("IF");
    if (ifNotExists) { ts.consume("IF"); ts.consume("NOT"); ts.consume("EXISTS"); }
    const tableName = ts.next()!.value.toLowerCase();

    if (this.tables.has(tableName)) {
      if (ifNotExists) return empty("CREATE TABLE", 0);
      throw new Error(`relation "${tableName}" already exists`);
    }

    const columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; default: unknown }> = [];
    ts.consume("(");
    let depth = 1;

    while (!ts.atEnd() && depth > 0) {
      const t = ts.peek();
      if (!t) break;
      if (t.kind === "LPAREN") { depth++; ts.next(); continue; }
      if (t.kind === "RPAREN") {
        depth--;
        if (depth === 0) { ts.next(); break; }
        ts.next(); continue;
      }
      // Skip CONSTRAINT, UNIQUE, INDEX keywords
      if (t.kind === "KEYWORD" && ["CONSTRAINT","UNIQUE","PRIMARY","INDEX"].includes(t.value.toUpperCase())) {
        while (!ts.matches(",") && !ts.matches(")") && !ts.atEnd()) ts.next();
        if (ts.peek()?.kind === "COMMA") ts.next();
        continue;
      }
      if (t.kind === "COMMA") { ts.next(); continue; }

      // column definition: name type [NOT NULL] [DEFAULT ...]
      const colName = ts.next()!.value.toLowerCase();
      const colType = ts.next()?.value ?? "text";

      let nullable = true;
      let primaryKey = false;
      let defVal: unknown = null;

      while (ts.peek() && ts.peek()!.kind !== "COMMA" && ts.peek()!.kind !== "RPAREN") {
        const p = ts.peek()!.value.toUpperCase();
        if (p === "NOT") { ts.next(); ts.consume("NULL"); nullable = false; }
        else if (p === "NULL") { ts.next(); nullable = true; }
        else if (p === "PRIMARY") { ts.next(); ts.consume("KEY"); primaryKey = true; nullable = false; }
        else if (p === "DEFAULT") {
          ts.next();
          const dt = ts.next()!;
          if (dt.kind === "KEYWORD" && dt.value.toUpperCase() === "NULL") defVal = null;
          else if (dt.kind === "NUMBER") defVal = Number(dt.value);
          else if (dt.kind === "STRING") defVal = dt.value;
          else if (dt.kind === "KEYWORD" && ["NOW()","CURRENT_TIMESTAMP"].includes(dt.value.toUpperCase())) defVal = () => new Date().toISOString();
          else defVal = dt.value;
        }
        else if (p === "UNIQUE") { ts.next(); }
        else break;
      }

      columns.push({ name: colName, type: colType.toLowerCase(), nullable, primaryKey, default: defVal });
    }

    this.tables.set(tableName, {
      def: { name: tableName, columns: columns as TableDef["columns"] },
      rows: [],
    });
    return empty("CREATE TABLE", 0);
  }

  // ── DROP TABLE ──────────────────────────────────────────────────────────────

  private execDrop(ts: TokenStream): QueryResult<Row> {
    ts.consume("DROP");
    ts.consume("TABLE");
    const ifExists = ts.matches("IF");
    if (ifExists) { ts.consume("IF"); ts.consume("EXISTS"); }
    const tableName = ts.next()!.value.toLowerCase();
    if (!this.tables.has(tableName)) {
      if (ifExists) return empty("DROP TABLE", 0);
      throw new Error(`relation "${tableName}" does not exist`);
    }
    this.tables.delete(tableName);
    return empty("DROP TABLE", 0);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function empty(command: string, rowCount: number): QueryResult<Row> {
  return { rows: [], rowCount, fields: [], command };
}

function normalise(
  sql: string | QueryConfig,
  values?: unknown[]
): { text: string; params: unknown[] } {
  if (typeof sql === "string") return { text: sql, params: values ?? [] };
  return { text: sql.text, params: sql.values ?? values ?? [] };
}

// ─── InMemoryPool ─────────────────────────────────────────────────────────────

/**
 * InMemoryPool — a DbPool backed by SqlEngine.
 *
 * Usage:
 *   const pool = new InMemoryPool();
 *   await pool.query("CREATE TABLE users (id text PRIMARY KEY, name text)");
 *   await pool.query("INSERT INTO users (id, name) VALUES ($1, $2)", ["u1", "Alice"]);
 *   const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", ["u1"]);
 */
export class InMemoryPool implements DbPool {
  private engine = new SqlEngine();

  async query<T extends Row = Row>(
    sql: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    const { text, params } = normalise(sql, values);
    return this.engine.execute<T>(text, params);
  }

  async connect(): Promise<PoolClient> {
    const engine = this.engine;
    return {
      async query<T extends Row = Row>(
        sql: string | QueryConfig,
        values?: unknown[]
      ): Promise<QueryResult<T>> {
        const { text, params } = normalise(sql, values);
        return engine.execute<T>(text, params);
      },
      release() {}, // no-op for in-memory pool
    };
  }

  async end(): Promise<void> {} // no-op

  /**
   * Begin a transaction. On rollback, all changes since begin() are undone.
   * On commit, changes persist.
   */
  async begin(): Promise<Transaction> {
    const snapshot = this.engine.snapshot();
    const engine = this.engine;
    let done = false;

    return {
      async query<T extends Row = Row>(
        sql: string | QueryConfig,
        values?: unknown[]
      ): Promise<QueryResult<T>> {
        if (done) throw new Error("Transaction already closed");
        const { text, params } = normalise(sql, values);
        return engine.execute<T>(text, params);
      },
      async commit() {
        if (done) throw new Error("Transaction already closed");
        done = true; // keep changes
      },
      async rollback() {
        if (done) throw new Error("Transaction already closed");
        done = true;
        engine.restore(snapshot);
      },
    };
  }

  /**
   * Seed helper — run a CREATE TABLE statement, then optionally insert rows.
   * Simplifies test setup.
   *
   *   await pool.seed(
   *     "CREATE TABLE tenants (id text, name text)",
   *     [{ id: "t1", name: "Acme" }]
   *   );
   */
  async seed(ddl: string, rows: Row[] = []): Promise<void> {
    await this.query(ddl);
    if (rows.length === 0) return;

    // Derive column names from the first row
    const cols = Object.keys(rows[0]);
    const colList = cols.join(", ");
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const insertSql = `INSERT INTO ${this.tableNameFromDdl(ddl)} (${colList}) VALUES (${placeholders})`;

    for (const row of rows) {
      await this.query(insertSql, cols.map((c) => row[c]));
    }
  }

  private tableNameFromDdl(ddl: string): string {
    const m = ddl.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i);
    if (!m) throw new Error("Cannot extract table name from DDL: " + ddl);
    return m[1].toLowerCase();
  }
}
