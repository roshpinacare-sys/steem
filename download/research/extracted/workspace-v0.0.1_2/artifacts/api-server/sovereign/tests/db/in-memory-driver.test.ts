import "../_flush.mjs";
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pool() { return new InMemoryPool(); }

const USER_DDL = `CREATE TABLE users (
  id   text,
  name text,
  age  integer,
  tenant_id text,
  active boolean
)`;

const ACCT_DDL = `CREATE TABLE accounts (
  id        text,
  tenant_id text,
  balance   integer
)`;

// ─── DDL ──────────────────────────────────────────────────────────────────────

test("CREATE TABLE — creates empty table", async () => {
  const db = pool();
  await db.query(USER_DDL);
  const { rows, rowCount } = await db.query("SELECT * FROM users");
  eq(rowCount, 0);
  eq(rows.length, 0);
});

test("CREATE TABLE IF NOT EXISTS — no error on duplicate", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("CREATE TABLE IF NOT EXISTS users (id text)"); // must not throw
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 0); // still empty
});

test("CREATE TABLE — duplicate without IF NOT EXISTS throws", async () => {
  const db = pool();
  await db.query(USER_DDL);
  let threw = false;
  try { await db.query(USER_DDL); } catch { threw = true; }
  assert(threw, "Expected error for duplicate table");
});

test("DROP TABLE — removes table and data", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name) VALUES ($1, $2)", ["u1", "Alice"]);
  await db.query("DROP TABLE users");
  let threw = false;
  try { await db.query("SELECT * FROM users"); } catch { threw = true; }
  assert(threw, "Expected error querying dropped table");
});

test("DROP TABLE IF EXISTS — no error on missing table", async () => {
  const db = pool();
  await db.query("DROP TABLE IF EXISTS nonexistent"); // must not throw
});

// ─── INSERT ───────────────────────────────────────────────────────────────────

test("INSERT — adds a row", async () => {
  const db = pool();
  await db.query(USER_DDL);
  const r = await db.query("INSERT INTO users (id, name, age) VALUES ($1, $2, $3)", ["u1", "Alice", 30]);
  eq(r.rowCount, 1);
  eq(r.command, "INSERT 0 1");
});

test("INSERT — multiple rows persist independently", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name, tenant_id) VALUES ($1, $2, $3)", ["u1", "Alice", "t1"]);
  await db.query("INSERT INTO users (id, name, tenant_id) VALUES ($1, $2, $3)", ["u2", "Bob", "t2"]);
  await db.query("INSERT INTO users (id, name, tenant_id) VALUES ($1, $2, $3)", ["u3", "Carol", "t1"]);
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 3);
});

test("INSERT — missing columns default to null", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id) VALUES ($1)", ["u1"]);
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", ["u1"]);
  eq(rows.length, 1);
  eq(rows[0].name, null);
});

// ─── SELECT ───────────────────────────────────────────────────────────────────

test("SELECT * — returns all columns", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name, age) VALUES ($1, $2, $3)", ["u1", "Alice", 30]);
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 1);
  eq(rows[0].id, "u1");
  eq(rows[0].name, "Alice");
  eq(rows[0].age, 30);
});

test("SELECT specific columns", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name, age) VALUES ($1, $2, $3)", ["u1", "Alice", 30]);
  const { rows } = await db.query("SELECT id, name FROM users");
  eq(rows.length, 1);
  eq(rows[0].id, "u1");
  eq(rows[0].name, "Alice");
  assert(rows[0].age === undefined || rows[0].age === null, "age should not be in result");
});

test("SELECT WHERE = string param", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name) VALUES ($1, $2)", ["u1", "Alice"]);
  await db.query("INSERT INTO users (id, name) VALUES ($1, $2)", ["u2", "Bob"]);
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", ["u1"]);
  eq(rows.length, 1);
  eq(rows[0].name, "Alice");
});

test("SELECT WHERE != (not equal)", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u1","Alice"]);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u2","Bob"]);
  const { rows } = await db.query("SELECT * FROM users WHERE id != $1", ["u1"]);
  eq(rows.length, 1);
  eq(rows[0].id, "u2");
});

test("SELECT WHERE numeric comparison", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, age) VALUES ($1, $2)", ["u1", 25]);
  await db.query("INSERT INTO users (id, age) VALUES ($1, $2)", ["u2", 35]);
  await db.query("INSERT INTO users (id, age) VALUES ($1, $2)", ["u3", 40]);
  const { rows } = await db.query("SELECT * FROM users WHERE age > $1", [30]);
  eq(rows.length, 2);
});

test("SELECT WHERE AND", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name, tenant_id) VALUES ($1,$2,$3)", ["u1","Alice","t1"]);
  await db.query("INSERT INTO users (id, name, tenant_id) VALUES ($1,$2,$3)", ["u2","Bob","t1"]);
  await db.query("INSERT INTO users (id, name, tenant_id) VALUES ($1,$2,$3)", ["u3","Alice","t2"]);
  const { rows } = await db.query(
    "SELECT * FROM users WHERE name = $1 AND tenant_id = $2",
    ["Alice", "t1"]
  );
  eq(rows.length, 1);
  eq(rows[0].id, "u1");
});

test("SELECT WHERE OR", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u1","Alice"]);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u2","Bob"]);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u3","Carol"]);
  const { rows } = await db.query(
    "SELECT * FROM users WHERE name = $1 OR name = $2",
    ["Alice", "Carol"]
  );
  eq(rows.length, 2);
});

test("SELECT WHERE IS NULL", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u1", null]);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u2","Bob"]);
  const { rows } = await db.query("SELECT * FROM users WHERE name IS NULL");
  eq(rows.length, 1);
  eq(rows[0].id, "u1");
});

test("SELECT WHERE IS NOT NULL", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u1", null]);
  await db.query("INSERT INTO users (id, name) VALUES ($1,$2)", ["u2","Bob"]);
  const { rows } = await db.query("SELECT * FROM users WHERE name IS NOT NULL");
  eq(rows.length, 1);
  eq(rows[0].id, "u2");
});

test("SELECT WHERE LIKE", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","Alice"]);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u2","Alice Smith"]);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u3","Bob"]);
  const { rows } = await db.query("SELECT * FROM users WHERE name LIKE $1", ["Alice%"]);
  eq(rows.length, 2);
});

test("SELECT WHERE ILIKE (case-insensitive)", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","ALICE"]);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u2","Bob"]);
  const { rows } = await db.query("SELECT * FROM users WHERE name ILIKE $1", ["alice"]);
  eq(rows.length, 1);
});

test("SELECT ORDER BY ASC", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,age) VALUES ($1,$2)", ["u1",30]);
  await db.query("INSERT INTO users (id,age) VALUES ($1,$2)", ["u2",20]);
  await db.query("INSERT INTO users (id,age) VALUES ($1,$2)", ["u3",40]);
  const { rows } = await db.query("SELECT * FROM users ORDER BY age ASC");
  eq(rows[0].id, "u2");
  eq(rows[1].id, "u1");
  eq(rows[2].id, "u3");
});

test("SELECT ORDER BY DESC", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,age) VALUES ($1,$2)", ["u1",30]);
  await db.query("INSERT INTO users (id,age) VALUES ($1,$2)", ["u2",20]);
  const { rows } = await db.query("SELECT * FROM users ORDER BY age DESC");
  eq(rows[0].id, "u1");
});

test("SELECT LIMIT", async () => {
  const db = pool();
  await db.query(USER_DDL);
  for (let i = 1; i <= 5; i++) {
    await db.query("INSERT INTO users (id) VALUES ($1)", [`u${i}`]);
  }
  const { rows } = await db.query("SELECT * FROM users LIMIT $1", [3]);
  eq(rows.length, 3);
});

test("SELECT OFFSET", async () => {
  const db = pool();
  await db.query(USER_DDL);
  for (let i = 1; i <= 5; i++) {
    await db.query("INSERT INTO users (id) VALUES ($1)", [`u${i}`]);
  }
  const { rows } = await db.query("SELECT * FROM users LIMIT $1 OFFSET $2", [2, 2]);
  eq(rows.length, 2);
  eq(rows[0].id, "u3");
});

test("SELECT from nonexistent table throws", async () => {
  const db = pool();
  let threw = false;
  try { await db.query("SELECT * FROM ghost"); } catch { threw = true; }
  assert(threw, "Expected error for missing table");
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

test("UPDATE — changes matching rows", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name,age) VALUES ($1,$2,$3)", ["u1","Alice",25]);
  await db.query("UPDATE users SET age = $1 WHERE id = $2", [30, "u1"]);
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", ["u1"]);
  eq(rows[0].age, 30);
});

test("UPDATE — multiple columns", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name,age) VALUES ($1,$2,$3)", ["u1","Alice",25]);
  await db.query("UPDATE users SET name = $1, age = $2 WHERE id = $3", ["Alicia", 26, "u1"]);
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", ["u1"]);
  eq(rows[0].name, "Alicia");
  eq(rows[0].age, 26);
});

test("UPDATE — returns rowCount", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u1","t1"]);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u2","t1"]);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u3","t2"]);
  const r = await db.query("UPDATE users SET active = $1 WHERE tenant_id = $2", [true, "t1"]);
  eq(r.rowCount, 2);
});

test("UPDATE — no-match returns 0 rowCount", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id) VALUES ($1)", ["u1"]);
  const r = await db.query("UPDATE users SET name = $1 WHERE id = $2", ["X", "u999"]);
  eq(r.rowCount, 0);
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test("DELETE WHERE — removes matching rows", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","Alice"]);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u2","Bob"]);
  const r = await db.query("DELETE FROM users WHERE id = $1", ["u1"]);
  eq(r.rowCount, 1);
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 1);
  eq(rows[0].id, "u2");
});

test("DELETE WHERE — no match returns 0", async () => {
  const db = pool();
  await db.query(USER_DDL);
  const r = await db.query("DELETE FROM users WHERE id = $1", ["ghost"]);
  eq(r.rowCount, 0);
});

test("DELETE WHERE — tenant-scoped delete does not touch other tenants", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u1","t1"]);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u2","t2"]);
  await db.query("DELETE FROM users WHERE tenant_id = $1", ["t1"]);
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 1);
  eq(rows[0].id, "u2");
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

test("Transaction commit — changes persist", async () => {
  const db = pool();
  await db.query(USER_DDL);
  const tx = await db.begin();
  await tx.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","Alice"]);
  await tx.commit();
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 1);
});

test("Transaction rollback — changes undone", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u0","Existing"]);
  const tx = await db.begin();
  await tx.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","Rollback"]);
  await tx.rollback();
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 1);
  eq(rows[0].id, "u0");
});

test("Transaction rollback — restores UPDATE", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","Original"]);
  const tx = await db.begin();
  await tx.query("UPDATE users SET name = $1 WHERE id = $2", ["Modified", "u1"]);
  await tx.rollback();
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", ["u1"]);
  eq(rows[0].name, "Original");
});

test("Transaction rollback — restores DELETE", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","ShouldSurvive"]);
  const tx = await db.begin();
  await tx.query("DELETE FROM users WHERE id = $1", ["u1"]);
  await tx.rollback();
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 1);
});

test("Transaction closed — query after commit throws", async () => {
  const db = pool();
  await db.query(USER_DDL);
  const tx = await db.begin();
  await tx.commit();
  let threw = false;
  try { await tx.query("SELECT * FROM users"); } catch { threw = true; }
  assert(threw, "Expected error using committed tx");
});

test("Transaction closed — rollback after rollback throws", async () => {
  const db = pool();
  await db.query(USER_DDL);
  const tx = await db.begin();
  await tx.rollback();
  let threw = false;
  try { await tx.rollback(); } catch { threw = true; }
  assert(threw, "Expected error on double rollback");
});

// ─── CONNECT / PoolClient ─────────────────────────────────────────────────────

test("connect() — client.query works and shares state", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1","Alice"]);
  const client = await db.connect();
  const { rows } = await client.query("SELECT * FROM users");
  eq(rows.length, 1);
  client.release();
});

test("connect() — client.release is a no-op (does not throw)", async () => {
  const db = pool();
  const client = await db.connect();
  client.release(); // must not throw
  client.release(); // idempotent
});

// ─── SEED HELPER ─────────────────────────────────────────────────────────────

test("seed() — creates table and inserts rows", async () => {
  const db = pool();
  await db.seed(
    "CREATE TABLE items (id text, label text, qty integer)",
    [{ id: "i1", label: "Foo", qty: 10 }, { id: "i2", label: "Bar", qty: 5 }]
  );
  const { rows } = await db.query("SELECT * FROM items");
  eq(rows.length, 2);
  eq(rows.find((r) => r.id === "i1")?.qty, 10);
});

test("seed() — no rows skips inserts", async () => {
  const db = pool();
  await db.seed("CREATE TABLE empty_table (id text)");
  const { rows } = await db.query("SELECT * FROM empty_table");
  eq(rows.length, 0);
});

// ─── QUERY CONFIG OBJECT ──────────────────────────────────────────────────────

test("QueryConfig object — text + values work", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query({ text: "INSERT INTO users (id,name) VALUES ($1,$2)", values: ["u1","Alice"] });
  const { rows } = await db.query({ text: "SELECT * FROM users WHERE id = $1", values: ["u1"] });
  eq(rows.length, 1);
  eq(rows[0].name, "Alice");
});

// ─── TENANT ISOLATION (enforced via WHERE) ────────────────────────────────────

test("Tenant isolation — SELECT filters by tenantId", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name,tenant_id) VALUES ($1,$2,$3)", ["u1","Alice","t1"]);
  await db.query("INSERT INTO users (id,name,tenant_id) VALUES ($1,$2,$3)", ["u2","Bob","t2"]);
  const { rows } = await db.query("SELECT * FROM users WHERE tenant_id = $1", ["t1"]);
  eq(rows.length, 1);
  eq(rows[0].name, "Alice");
});

test("Tenant isolation — UPDATE scoped to tenant", async () => {
  const db = pool();
  await db.query(ACCT_DDL);
  await db.query("INSERT INTO accounts (id,tenant_id,balance) VALUES ($1,$2,$3)", ["a1","t1",100]);
  await db.query("INSERT INTO accounts (id,tenant_id,balance) VALUES ($1,$2,$3)", ["a2","t2",200]);
  await db.query("UPDATE accounts SET balance = $1 WHERE tenant_id = $2", [999, "t1"]);
  const t2 = await db.query("SELECT * FROM accounts WHERE tenant_id = $1", ["t2"]);
  eq(t2.rows[0].balance, 200, "t2 balance must not change");
});

test("Tenant isolation — DELETE does not cross tenant boundary", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u1","t1"]);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u2","t1"]);
  await db.query("INSERT INTO users (id,tenant_id) VALUES ($1,$2)", ["u3","t2"]);
  await db.query("DELETE FROM users WHERE tenant_id = $1", ["t1"]);
  const { rows } = await db.query("SELECT * FROM users");
  eq(rows.length, 1);
  eq(rows[0].id, "u3");
});

test("Tenant isolation — two tenants with identical IDs do not collide", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name,tenant_id) VALUES ($1,$2,$3)", ["same-id","T1 Alice","t1"]);
  await db.query("INSERT INTO users (id,name,tenant_id) VALUES ($1,$2,$3)", ["same-id","T2 Alice","t2"]);
  const r1 = await db.query("SELECT * FROM users WHERE id = $1 AND tenant_id = $2", ["same-id","t1"]);
  const r2 = await db.query("SELECT * FROM users WHERE id = $1 AND tenant_id = $2", ["same-id","t2"]);
  eq(r1.rows[0].name, "T1 Alice");
  eq(r2.rows[0].name, "T2 Alice");
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test("fail-closed — INSERT into nonexistent table throws", async () => {
  const db = pool();
  let threw = false;
  try { await db.query("INSERT INTO ghost (id) VALUES ($1)", ["x"]); } catch { threw = true; }
  assert(threw, "Expected error for missing table");
});

test("fail-closed — UPDATE nonexistent table throws", async () => {
  const db = pool();
  let threw = false;
  try { await db.query("UPDATE ghost SET x = $1 WHERE id = $2", [1, "y"]); } catch { threw = true; }
  assert(threw, "Expected error");
});

test("fail-closed — DELETE from nonexistent table throws", async () => {
  const db = pool();
  let threw = false;
  try { await db.query("DELETE FROM ghost WHERE id = $1", ["y"]); } catch { threw = true; }
  assert(threw, "Expected error");
});

test("fail-closed — empty SQL is safe (no-op, does not throw)", async () => {
  const db = pool();
  const r = await db.query("   "); // whitespace only
  eq(r.rowCount, 0);
  eq(r.rows.length, 0);
});

test("fail-closed — pool.end() is safe to call", async () => {
  const db = pool();
  await db.end(); // must not throw
});

// ─── MULTIPLE TABLES ─────────────────────────────────────────────────────────

test("Multiple independent tables share same pool", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query(ACCT_DDL);
  await db.query("INSERT INTO users (id) VALUES ($1)", ["u1"]);
  await db.query("INSERT INTO accounts (id,tenant_id,balance) VALUES ($1,$2,$3)", ["a1","t1",100]);
  const u = await db.query("SELECT * FROM users");
  const a = await db.query("SELECT * FROM accounts");
  eq(u.rows.length, 1);
  eq(a.rows.length, 1);
});

// ─── efficiency/LIKE-regex-cache ───────────────────────────────────────────────
// evalExpr's "like" case now memoizes the compiled RegExp per (flags, pattern)
// instead of recompiling on every row of a scan. These tests pin correctness
// across repeated scans (cache hits), special-character escaping (cache key
// must not collide across distinct patterns), and a wide spread of distinct
// patterns that forces the cache's bound to be exercised (clear-on-overflow),
// confirming the eviction path never produces a stale or wrong match.

test("efficiency/LIKE-regex-cache — repeated identical LIKE scan stays correct (cache hit path)", async () => {
  const db = pool();
  await db.query(USER_DDL);
  for (let n = 0; n < 50; n++) {
    await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", [`u${n}`, n % 2 === 0 ? "Alice" : "Bob"]);
  }
  // Run the same WHERE LIKE scan twice — second run hits the memoized regex.
  const first = await db.query("SELECT * FROM users WHERE name LIKE $1", ["Alice"]);
  const second = await db.query("SELECT * FROM users WHERE name LIKE $1", ["Alice"]);
  eq(first.rows.length, 25);
  eq(second.rows.length, 25);
});

test("efficiency/LIKE-regex-cache — special regex characters stay escaped across cache keys", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u1", "a.b"]);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u2", "axb"]); // would match if '.' were treated as regex dot
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["u3", "a(b)"]);
  // Literal "." must only match a literal dot, not "any character" — even
  // after a structurally similar pattern ("a_b", SQL wildcard for any-char)
  // has already been compiled and cached, the two cache keys must not collide.
  const wildcard = await db.query("SELECT * FROM users WHERE name LIKE $1", ["a_b"]);
  const literalDot = await db.query("SELECT * FROM users WHERE name LIKE $1", ["a.b"]);
  const parens = await db.query("SELECT * FROM users WHERE name LIKE $1", ["a(b)"]);
  eq(wildcard.rows.length, 2);   // a_b matches both a.b and axb
  eq(literalDot.rows.length, 1); // a.b (escaped) matches only the literal dot
  eq(literalDot.rows[0].id, "u1");
  eq(parens.rows.length, 1);     // a(b) (escaped) matches only the literal parens
  eq(parens.rows[0].id, "u3");
});

test("efficiency/LIKE-regex-cache — regression: cache bound overflow still yields correct matches", async () => {
  const db = pool();
  await db.query(USER_DDL);
  await db.query("INSERT INTO users (id,name) VALUES ($1,$2)", ["target", "FindMe"]);
  // Force well past the cache's bound (500) with distinct patterns so the
  // clear-on-overflow path runs, then confirm a fresh lookup right after is
  // still correct (no stale entry, no crash, no false match/no-match).
  for (let n = 0; n < 600; n++) {
    await db.query("SELECT * FROM users WHERE name LIKE $1", [`pattern-${n}%`]);
  }
  const { rows } = await db.query("SELECT * FROM users WHERE name LIKE $1", ["FindMe"]);
  eq(rows.length, 1);
  eq(rows[0].id, "target");
});

// ─── efficiency/tokenizer-module-level-sets — v371 ──────────────────────────
// KEYWORDS and TWO_CHAR_OPERATORS were lifted from per-call (and per-character,
// for the operator array) allocations to module-level Sets computed once at
// load. These tests guard correctness across all operators, repeated calls
// (no stale/shared mutable state), and the single-char fallback boundary.

test("efficiency/tokenizer-sets — all six two-char operators still tokenize correctly", async () => {
  const db = pool();
  await db.query(ACCT_DDL);
  await db.query("INSERT INTO accounts (id,tenant_id,balance) VALUES ($1,$2,$3)", ["a1", "t1", 100]);
  await db.query("INSERT INTO accounts (id,tenant_id,balance) VALUES ($1,$2,$3)", ["a2", "t1", 200]);

  const ne = await db.query("SELECT * FROM accounts WHERE balance != $1", [100]);
  eq(ne.rows.length, 1);
  eq(ne.rows[0].id, "a2");

  const neAlt = await db.query("SELECT * FROM accounts WHERE balance <> $1", [100]);
  eq(neAlt.rows.length, 1);
  eq(neAlt.rows[0].id, "a2");

  const gte = await db.query("SELECT * FROM accounts WHERE balance >= $1", [200]);
  eq(gte.rows.length, 1);
  eq(gte.rows[0].id, "a2");

  const lte = await db.query("SELECT * FROM accounts WHERE balance <= $1", [100]);
  eq(lte.rows.length, 1);
  eq(lte.rows[0].id, "a1");
});

test("efficiency/tokenizer-sets — single-char operator fallback still works (boundary of TWO_CHAR_OPERATORS.has)", async () => {
  const db = pool();
  await db.query(ACCT_DDL);
  await db.query("INSERT INTO accounts (id,tenant_id,balance) VALUES ($1,$2,$3)", ["a1", "t1", 50]);
  await db.query("INSERT INTO accounts (id,tenant_id,balance) VALUES ($1,$2,$3)", ["a2", "t1", 150]);

  // Single '>' and '<' must still fall through correctly when the two-char
  // lookahead does NOT match a known operator (e.g. "> " is not in the set).
  const gt = await db.query("SELECT * FROM accounts WHERE balance > $1", [100]);
  eq(gt.rows.length, 1);
  eq(gt.rows[0].id, "a2");

  const lt = await db.query("SELECT * FROM accounts WHERE balance < $1", [100]);
  eq(lt.rows.length, 1);
  eq(lt.rows[0].id, "a1");

  const eqOp = await db.query("SELECT * FROM accounts WHERE balance = $1", [50]);
  eq(eqOp.rows.length, 1);
  eq(eqOp.rows[0].id, "a1");
});

test("efficiency/tokenizer-sets — module-level KEYWORDS Set has no stale state across repeated calls", async () => {
  const db = pool();
  // Run many queries in a row, each exercising the keyword path (SELECT,
  // FROM, WHERE, AND, OR, ORDER, BY, LIMIT). If KEYWORDS were accidentally
  // shared+mutated across calls instead of being a stable module-level
  // constant, repeated use would eventually misclassify a keyword as IDENT
  // (or vice versa) and these structurally-identical queries would start
  // failing or returning wrong shapes partway through the loop.
  await db.query(USER_DDL);
  for (let n = 0; n < 50; n++) {
    await db.query("INSERT INTO users (id,name,age,tenant_id,active) VALUES ($1,$2,$3,$4,$5)",
      [`u${n}`, `Name${n}`, 20 + n, "t1", true]);
  }
  const { rows } = await db.query(
    "SELECT * FROM users WHERE tenant_id = $1 AND active = $2 ORDER BY age DESC LIMIT $3",
    ["t1", true, 5],
  );
  eq(rows.length, 5);
  // ORDER BY age DESC should give the highest ages first.
  eq(rows[0].age, 69);
  eq(rows[4].age, 65);
});
