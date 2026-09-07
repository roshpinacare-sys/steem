import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { openSQLite } from "@/lib/db/sqlite-client";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

describe("SQLite driver fallback", () => {
  it("executes Drizzle queries and immediate transactions through node:sqlite", () => {
    const path = join(tmpdir(), `titai-node-sqlite-${process.pid}-${Date.now()}.db`);
    paths.push(path);
    const client = openSQLite(path, { driver: "node:sqlite" });
    const database = drizzle(client as never);
    try {
      database.run(sql`create table items (id integer primary key, value text not null)`);
      const transaction = client.transaction(() => {
        database.run(sql`insert into items(value) values ('one')`);
        database.run(sql`insert into items(value) values ('two')`);
      });
      transaction.immediate();
      const rows = database.all<{ id: number; value: string }>(sql`select id, value from items order by id`);
      expect(rows).toEqual([
        { id: 1, value: "one" },
        { id: 2, value: "two" },
      ]);
      expect(client.driverName).toBe("node:sqlite");
    } finally {
      client.close();
    }
  });

  it("rolls back failed nested transactions", () => {
    const client = openSQLite(":memory:", { driver: "node:sqlite" });
    const database = drizzle(client as never);
    try {
      database.run(sql`create table counters (value integer not null)`);
      const outer = client.transaction(() => {
        database.run(sql`insert into counters(value) values (1)`);
        const inner = client.transaction(() => {
          database.run(sql`insert into counters(value) values (2)`);
          throw new Error("nested_failure");
        });
        expect(() => inner.immediate()).toThrow("nested_failure");
        database.run(sql`insert into counters(value) values (3)`);
      });
      outer.immediate();
      const rows = database.all<{ value: number }>(sql`select value from counters order by value`);
      expect(rows).toEqual([{ value: 1 }, { value: 3 }]);
    } finally {
      client.close();
    }
  });
});
