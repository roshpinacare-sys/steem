/**
 * ECOS Postgres pool
 * ------------------
 * Single shared `pg.Pool` instance with native connection pooling. No
 * external bouncer is assumed for this phase -- the pool handles its
 * own connection lifecycle.
 *
 * BIGINT handling: pg returns int8 as `string` by default once we override
 * the type parser. We DO NOT install the global BigInt parser because
 * we want the application repos to control conversion deliberately
 * (via `BigInt(string)` only when arithmetic is needed). Returning
 * strings keeps JSON safe and aligns with the rest of the BigInt-first
 * money discipline of fiatLedger.js.
 *
 * Usage:
 *   const { getPool, withTx, closePool } = require('./pool');
 *   const { rows } = await getPool().query('SELECT 1');
 *   await withTx(async (client) => { await client.query(...); ... });
 */

'use strict';

const pg = require('pg');

// Force BIGINT (oid=20) and NUMERIC (oid=1700) to come back as strings.
// Money math is done by repos using BigInt; never let pg coerce to Number.
pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1700, (v) => v);

let _pool = null;

function getPool() {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up` first.'
    );
  }

  _pool = new pg.Pool({
    connectionString,
    max:                       Number(process.env.PG_POOL_MAX        || 10),
    min:                       Number(process.env.PG_POOL_MIN        || 0),
    idleTimeoutMillis:         Number(process.env.PG_IDLE_MS         || 30_000),
    connectionTimeoutMillis:   Number(process.env.PG_CONNECT_MS      || 5_000),
    statement_timeout:         Number(process.env.PG_STATEMENT_MS    || 15_000),
    query_timeout:             Number(process.env.PG_QUERY_MS        || 15_000),
    keepAlive:                 true,
  });

  _pool.on('error', (err) => {
    // Idle-client errors are non-fatal but must be logged for audit.
    // We never silently swallow them.
    // eslint-disable-next-line no-console
    console.error('[ecos.pool] idle client error:', err.message);
  });

  return _pool;
}

/**
 * Run `fn(client)` inside a BEGIN/COMMIT transaction. Rolls back on any
 * thrown error. Always releases the client.
 */
async function withTx(fn, options = {}) {
  const {
    isolation = null,
    retries = 0,
  } = options;

  let attempt = 0;
  for (;;) {
    const client = await getPool().connect();
    let released = false;
    try {
      if (isolation) {
        const allowed = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);
        const level = String(isolation).toUpperCase();
        if (!allowed.has(level)) throw new TypeError(`unsupported isolation level: ${isolation}`);
        await client.query(`BEGIN ISOLATION LEVEL ${level}`);
      } else {
        await client.query('BEGIN');
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
      const retryable = err && (err.code === '40001' || err.code === '40P01');
      if (retryable && attempt < retries) {
        attempt += 1;
        client.release();
        released = true;
        continue;
      }
      throw err;
    } finally {
      if (!released) client.release();
    }
  }
}

async function closePool() {
  if (_pool) {
    const p = _pool;
    _pool = null;
    await p.end();
  }
}

module.exports = { getPool, withTx, closePool };
