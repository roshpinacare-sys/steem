'use strict';
const { logger } = require('./logger');

const DEFAULTS = {
  PORT:             '3000',
  LLM_PROVIDER:     'ollama',
  LOCAL_LLM_URL:    'http://localhost:11434',
  CONFIDENCE_AUTO:  '0.70',
  CONFIDENCE_HITL:  '0.50',
  LOG_LEVEL:        'info',
};

/**
 * Comprehensive startup config validator — V101
 *
 * Returns { valid, errors, warnings, config } without throwing.
 * ecos-api-server.js calls this and decides whether to exit.
 *
 * Changes in V101:
 *   [FIX-BUG-D] DATABASE_URL missing in production → hard error (was: warning)
 *   [FIX-BUG-E] JWT_SECRET (apiKeyAuth) < 32 chars in production → hard error
 *   [FIX-BUG-F] REFINEMENT_THRESHOLD validated (float 0.50–0.99, default 0.65)
 *
 * @returns {{ valid: boolean, errors: string[], warnings: string[], config: object }}
 */
function validateConfig() {
  const warnings = [];
  const errors   = [];
  const env      = process.env.NODE_ENV || 'development';

  // 1. Apply defaults for missing vars
  for (const [key, def] of Object.entries(DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = def;
      warnings.push(`${key} not set — using default: ${def}`);
    }
  }

  // 2. NODE_ENV must be one of the recognised values
  if (!['production', 'development', 'test'].includes(env)) {
    errors.push(`NODE_ENV must be 'production', 'development', or 'test' (got '${env}')`);
  }

  // 3. Production-only mandatory checks
  if (env === 'production') {
    // VALIDATOR_JWT_SECRET must be set AND at least 32 chars
    const jwtSecret = process.env.VALIDATOR_JWT_SECRET || '';
    if (!jwtSecret) {
      errors.push('VALIDATOR_JWT_SECRET must be set in production');
    } else if (jwtSecret.length < 32) {
      errors.push(`VALIDATOR_JWT_SECRET must be >= 32 characters (got ${jwtSecret.length})`);
    }

    // [FIX-BUG-E] JWT_SECRET (used by apiKeyAuth for deposit signing) must be set and >= 32 chars
    const jwtApiSecret = process.env.JWT_SECRET || '';
    if (!jwtApiSecret) {
      errors.push('JWT_SECRET must be set in production (used by apiKeyAuth for deposit JWT signing)');
    } else if (jwtApiSecret === 'ecos-dev-secret') {
      errors.push('JWT_SECRET must not use the default dev value in production — set a strong secret (>= 32 chars)');
    } else if (jwtApiSecret.length < 32) {
      errors.push(`JWT_SECRET must be >= 32 characters in production (got ${jwtApiSecret.length})`);
    }

    // ECOS_DEPOSIT_API_KEY must be set
    if (!process.env.ECOS_DEPOSIT_API_KEY) {
      errors.push('ECOS_DEPOSIT_API_KEY must be set in production');
    }

    // [FIX-BUG-D] DATABASE_URL missing in production is now a hard error, not a warning.
    // The in-memory fallback is not production-safe: data is lost on restart.
    if (!process.env.DATABASE_URL) {
      errors.push('DATABASE_URL must be set in production — in-memory fallback is not production-safe');
    }

    // LOG_LEVEL should not be 'debug' in production
    const logLevel = process.env.LOG_LEVEL || 'info';
    if (!['info', 'warn', 'error'].includes(logLevel)) {
      warnings.push(`LOG_LEVEL '${logLevel}' is not recommended in production (use info/warn/error)`);
    }
  }

  // 4. CONFIDENCE_AUTO: float in [0.50, 0.99]
  const autoRaw  = process.env.CONFIDENCE_AUTO;
  const autoVal  = parseFloat(autoRaw);
  if (isNaN(autoVal) || autoVal < 0.50 || autoVal > 0.99) {
    errors.push(`CONFIDENCE_AUTO must be a float between 0.50 and 0.99 (got '${autoRaw}')`);
  }

  // 5. CONFIDENCE_HITL: float in [0.30, CONFIDENCE_AUTO)
  const hitlRaw  = process.env.CONFIDENCE_HITL;
  const hitlVal  = parseFloat(hitlRaw);
  if (isNaN(hitlVal) || hitlVal < 0.30) {
    errors.push(`CONFIDENCE_HITL must be a float >= 0.30 (got '${hitlRaw}')`);
  } else if (!isNaN(autoVal) && hitlVal >= autoVal) {
    errors.push(
      `CONFIDENCE_HITL (${hitlVal}) must be < CONFIDENCE_AUTO (${autoVal})`
    );
  }

  // [FIX-BUG-F] 6. REFINEMENT_THRESHOLD: float in [0.50, 0.99], default 0.65
  if (process.env.REFINEMENT_THRESHOLD !== undefined) {
    const rtVal = parseFloat(process.env.REFINEMENT_THRESHOLD);
    if (isNaN(rtVal) || rtVal < 0.50 || rtVal > 0.99) {
      errors.push(`REFINEMENT_THRESHOLD must be a float between 0.50 and 0.99 (got '${process.env.REFINEMENT_THRESHOLD}')`);
    }
  }

  // Log results
  warnings.forEach(w => logger.warn({ component: 'config' }, w));
  if (errors.length > 0) {
    errors.forEach(e => logger.error({ component: 'config' }, e));
  } else {
    logger.info({ component: 'config' }, 'Configuration validated.');
  }

  // Sanitized config (no secrets)
  const config = {
    NODE_ENV:             env,
    PORT:                 process.env.PORT,
    LLM_PROVIDER:         process.env.LLM_PROVIDER,
    LOCAL_LLM_URL:        process.env.LOCAL_LLM_URL,
    CONFIDENCE_AUTO:      process.env.CONFIDENCE_AUTO,
    CONFIDENCE_HITL:      process.env.CONFIDENCE_HITL,
    REFINEMENT_THRESHOLD: process.env.REFINEMENT_THRESHOLD || '0.65',
    LOG_LEVEL:            process.env.LOG_LEVEL,
    DATABASE_URL:         process.env.DATABASE_URL ? '[set]' : '[not set]',
    ECOS_DEPOSIT_API_KEY: process.env.ECOS_DEPOSIT_API_KEY  ? '[set]' : '[not set]',
    VALIDATOR_JWT_SECRET: process.env.VALIDATOR_JWT_SECRET  ? '[set]' : '[not set]',
    JWT_SECRET:           process.env.JWT_SECRET            ? '[set]' : '[not set]',
    ENABLE_SELF_REFINEMENT: process.env.ENABLE_SELF_REFINEMENT || 'false',
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config,
  };
}

module.exports = { validateConfig };
