/**
 * config.test.js — V101
 * Tests for lib/config.js validateConfig()
 *
 * Changes vs V100:
 *   [FIX-BUG-D] DATABASE_URL missing in production → error (was: warning)
 *   [FIX-BUG-E] JWT_SECRET missing / weak / default in production → error
 *   [FIX-BUG-F] REFINEMENT_THRESHOLD validated when set
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let savedEnv = {};

function saveEnv(...keys) {
  for (const k of keys) savedEnv[k] = process.env[k];
}
function restoreEnv(...keys) {
  for (const k of keys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

const ALL_KEYS = [
  'NODE_ENV', 'VALIDATOR_JWT_SECRET', 'JWT_SECRET', 'ECOS_DEPOSIT_API_KEY',
  'DATABASE_URL', 'LOG_LEVEL', 'CONFIDENCE_AUTO', 'CONFIDENCE_HITL',
  'PORT', 'LLM_PROVIDER', 'LOCAL_LLM_URL', 'REFINEMENT_THRESHOLD',
];

describe('validateConfig() — V101', () => {
  beforeEach(() => {
    saveEnv(...ALL_KEYS);
    process.env.NODE_ENV        = 'test';
    process.env.CONFIDENCE_AUTO = '0.70';
    process.env.CONFIDENCE_HITL = '0.50';
    delete process.env.VALIDATOR_JWT_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.ECOS_DEPOSIT_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.LOG_LEVEL;
    delete process.env.REFINEMENT_THRESHOLD;
  });

  afterEach(() => {
    restoreEnv(...ALL_KEYS);
    const configPath = require.resolve('../lib/config');
    delete require.cache[configPath];
  });

  it('validateConfig passes with valid test config', () => {
    const { validateConfig } = require('../lib/config');
    const result = validateConfig();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.config).toHaveProperty('NODE_ENV', 'test');
    expect(result.config.VALIDATOR_JWT_SECRET).toBe('[not set]');
  });

  it('validateConfig fails in production without VALIDATOR_JWT_SECRET', () => {
    process.env.NODE_ENV             = 'production';
    process.env.ECOS_DEPOSIT_API_KEY = 'key-set';
    process.env.JWT_SECRET           = 'a'.repeat(32);
    process.env.DATABASE_URL         = 'postgres://localhost/ecos';
    delete process.env.VALIDATOR_JWT_SECRET;

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('validator_jwt_secret'))).toBe(true);
  });

  // [FIX-BUG-D] DATABASE_URL missing → error in production
  it('[BUG-D] validateConfig fails in production without DATABASE_URL', () => {
    process.env.NODE_ENV             = 'production';
    process.env.VALIDATOR_JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET           = 'b'.repeat(32);
    process.env.ECOS_DEPOSIT_API_KEY = 'key-set';
    delete process.env.DATABASE_URL;

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('database_url'))).toBe(true);
    // Must NOT be just a warning anymore
    expect(result.warnings.some(w => w.toLowerCase().includes('database_url'))).toBe(false);
  });

  // [FIX-BUG-E] JWT_SECRET missing in production → error
  it('[BUG-E] validateConfig fails in production without JWT_SECRET', () => {
    process.env.NODE_ENV             = 'production';
    process.env.VALIDATOR_JWT_SECRET = 'a'.repeat(32);
    process.env.ECOS_DEPOSIT_API_KEY = 'key-set';
    process.env.DATABASE_URL         = 'postgres://localhost/ecos';
    delete process.env.JWT_SECRET;

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('jwt_secret'))).toBe(true);
  });

  // [FIX-BUG-E] JWT_SECRET set to hardcoded dev default → error
  it('[BUG-E] validateConfig fails in production with JWT_SECRET=ecos-dev-secret', () => {
    process.env.NODE_ENV             = 'production';
    process.env.VALIDATOR_JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET           = 'ecos-dev-secret';
    process.env.ECOS_DEPOSIT_API_KEY = 'key-set';
    process.env.DATABASE_URL         = 'postgres://localhost/ecos';

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('jwt_secret'))).toBe(true);
  });

  // [FIX-BUG-E] JWT_SECRET too short → error
  it('[BUG-E] validateConfig fails in production with JWT_SECRET shorter than 32 chars', () => {
    process.env.NODE_ENV             = 'production';
    process.env.VALIDATOR_JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET           = 'too-short';
    process.env.ECOS_DEPOSIT_API_KEY = 'key-set';
    process.env.DATABASE_URL         = 'postgres://localhost/ecos';

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('jwt_secret'))).toBe(true);
  });

  it('validateConfig rejects invalid CONFIDENCE_AUTO value', () => {
    process.env.CONFIDENCE_AUTO = '1.50';

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('confidence_auto'))).toBe(true);
  });

  // [FIX-BUG-F] REFINEMENT_THRESHOLD out of range → error
  it('[BUG-F] validateConfig rejects REFINEMENT_THRESHOLD out of range', () => {
    process.env.REFINEMENT_THRESHOLD = '1.50';

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('refinement_threshold'))).toBe(true);
  });

  // [FIX-BUG-F] REFINEMENT_THRESHOLD valid → no error
  it('[BUG-F] validateConfig accepts valid REFINEMENT_THRESHOLD', () => {
    process.env.REFINEMENT_THRESHOLD = '0.75';

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(true);
    expect(result.config.REFINEMENT_THRESHOLD).toBe('0.75');
  });

  it('validateConfig passes with all production vars set correctly', () => {
    process.env.NODE_ENV             = 'production';
    process.env.VALIDATOR_JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET           = 'b'.repeat(32);
    process.env.ECOS_DEPOSIT_API_KEY = 'key-set';
    process.env.DATABASE_URL         = 'postgres://localhost/ecos';

    const { validateConfig } = require('../lib/config');
    const result = validateConfig();

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
