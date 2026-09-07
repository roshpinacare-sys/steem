'use strict';
/**
 * creditReserveRepo.js — PostgreSQL-backed repository for credit_reserve table.
 * V271 persistence foundation. Zero new npm deps. Singleton row (id=1) pattern.
 */
class CreditReserveRepo {
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('CreditReserveRepo requires a PostgreSQL pool-like object');
    }
    this.pool = pool;
  }

  async getBalance() {
    const res = await this.pool.query(
      'SELECT reserve_balance FROM credit_reserve WHERE id = 1'
    );
    return res.rows[0] ? BigInt(res.rows[0].reserve_balance) : 0n;
  }

  async updateBalance(deltaMicro) {
    await this.pool.query(
      `INSERT INTO credit_reserve (id, reserve_balance)
       VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE
         SET reserve_balance = credit_reserve.reserve_balance + $1,
             updated_at = now()`,
      [String(deltaMicro)]
    );
  }

  async getStats() {
    const res = await this.pool.query(
      'SELECT reserve_balance, updated_at FROM credit_reserve WHERE id = 1'
    );
    if (!res.rows.length) return { balance: 0n, updatedAt: null };
    return { balance: BigInt(res.rows[0].reserve_balance), updatedAt: res.rows[0].updated_at };
  }
}

module.exports = { CreditReserveRepo };
