'use strict';
/**
 * reputationRepo.js — PostgreSQL-backed repository for reputation_events table.
 * V271 persistence foundation. Zero new npm deps.
 */
class ReputationRepo {
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('ReputationRepo requires a PostgreSQL pool-like object');
    }
    this.pool = pool;
  }

  async recordEvent(userId, dimension, delta, context = {}) {
    if (!userId || !dimension || delta == null) {
      throw new Error('recordEvent: userId, dimension, and delta are required');
    }
    await this.pool.query(
      `INSERT INTO reputation_events (user_id, dimension, delta, context)
       VALUES ($1, $2, $3, $4)`,
      [userId, dimension, Number(delta), JSON.stringify(context)]
    );
  }

  async getScore(userId, dimension) {
    const res = await this.pool.query(
      `SELECT COALESCE(SUM(delta), 0) AS score
       FROM reputation_events
       WHERE user_id = $1 AND dimension = $2`,
      [userId, dimension]
    );
    return parseFloat(res.rows[0].score);
  }

  async getAllScores(userId) {
    const res = await this.pool.query(
      `SELECT dimension, COALESCE(SUM(delta), 0) AS score
       FROM reputation_events
       WHERE user_id = $1
       GROUP BY dimension`,
      [userId]
    );
    return res.rows.reduce((acc, r) => {
      acc[r.dimension] = parseFloat(r.score);
      return acc;
    }, {});
  }

  async getRecentEvents(userId, limit = 50) {
    const res = await this.pool.query(
      `SELECT dimension, delta, context, issued_at
       FROM reputation_events
       WHERE user_id = $1
       ORDER BY issued_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }
}

module.exports = { ReputationRepo };
