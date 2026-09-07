/**
 * ECOS Structured Logger — V19
 * ----------------------------
 * Singleton pino logger. Replaces ad-hoc console.log/error in ecos-api-server.js.
 *
 * Usage:
 *   const { logger } = require('./lib/logger');
 *   logger.info({ component: 'gate', event: 'HITL_QUEUE', missionId }, 'routed');
 *   logger.error({ component: 'db', err: err.message }, 'DB write failed');
 *
 * Configuration:
 *   LOG_LEVEL env var — 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
 *   LOG_PRETTY env var — set to '1' for human-readable output (dev only)
 *
 * In production (Docker): LOG_LEVEL=info, output is newline-delimited JSON.
 * In demo / local dev: LOG_LEVEL=debug, LOG_PRETTY=1 for readable output.
 *
 * NOTE: lib/ modules (fiatLedger, auditLog, hitlGate, etc.) keep console.warn
 * for internal warnings — they are not aware of the app logger. Only
 * ecos-api-server.js uses this logger.
 */

'use strict';

let pino;
try {
  pino = require('pino');
} catch (_) {
  // pino not installed — fall back to console with the same interface
  const _noop = () => {};
  const _makeLevel = (fn) => (obj, msg) => {
    if (typeof obj === 'string') { fn(`[ECOS] ${obj}`); return; }
    fn(`[ECOS] ${msg || ''}`, JSON.stringify(obj));
  };
  pino = () => ({
    trace: _noop,
    debug: _makeLevel(console.debug),
    info:  _makeLevel(console.log),
    warn:  _makeLevel(console.warn),
    error: _makeLevel(console.error),
    fatal: _makeLevel(console.error),
    child: () => ({ trace:_noop, debug:_noop, info:_noop, warn:_noop, error:_noop, fatal:_noop }),
  });
}

const level = process.env.LOG_LEVEL || 'info';
const pretty = process.env.LOG_PRETTY === '1';

const transport = pretty
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
  : undefined;

const logger = pino({
  level,
  ...(transport ? { transport } : {}),
  base: { service: 'ecos-api' },
  timestamp: pino.stdTimeFunctions?.isoTime ?? (() => `,"time":"${new Date().toISOString()}"`),
});

module.exports = { logger };
