'use strict';
/**
 * identityQuotaForecast399.js — ECOS V399 D4
 *
 * Quota forecast engine: extrapolates an actor's current daily consumption rate
 * to predict remaining-quota exhaustion time. Integrates with the V398 D1 quota
 * manager.
 *
 * Function: createIdentityQuotaForecast399({ auditLog, audit, quotaManager })
 * Methods:
 *   forecastQuotaExhaustion399(actorId, opts?)  — predict when quota will be exhausted
 *   forecastAllActors399(opts?)                 — batch forecast for all tracked actors
 *   getForeccastSummary399(opts?)               — aggregate risk summary
 */

const IDENTITY_QUOTA_FORECAST_VERSION_399 = '399.0.0';

const EVT_QUOTA_FORECAST_399 = 'identity_quota_forecast_event_type_399';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY  = 24 * MS_PER_HOUR;

function createIdentityQuotaForecast399(opts = {}) {
  const auditLog     = opts.auditLog || opts.audit || null;
  const quotaManager = opts.quotaManager || null;

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  /**
   * _computeForecast(status, windowMs)
   * Given a quota status from the V398 quota manager, compute exhaustion forecast.
   * windowMs: the look-back window used to compute the current rate (default: 1 hour).
   */
  function _computeForecast(actorId, dailyUsed, dailyRemaining, dailyQuota, sinceWindowMs) {
    const now = Date.now();

    if (dailyQuota <= 0) {
      return {
        actorId,
        dailyUsed,
        dailyRemaining,
        dailyQuota,
        currentRatePerHour: 0,
        estimatedExhaustionMs: null,
        estimatedExhaustionAt: null,
        riskLevel: 'none',
        forecastedAt: now,
        version: IDENTITY_QUOTA_FORECAST_VERSION_399,
      };
    }

    // Rate: events per hour based on the consumption so far today
    // We use window = time elapsed since start-of-day or sinceWindowMs, whichever is shorter
    const windowMs = Math.min(sinceWindowMs, MS_PER_DAY);
    const windowHours = windowMs / MS_PER_HOUR || 1;
    const ratePerHour = dailyUsed / windowHours;

    let estimatedExhaustionMs   = null;
    let estimatedExhaustionAt   = null;
    let riskLevel               = 'low';

    if (ratePerHour > 0 && dailyRemaining > 0) {
      const hoursToExhaustion    = dailyRemaining / ratePerHour;
      estimatedExhaustionMs      = Math.round(hoursToExhaustion * MS_PER_HOUR);
      estimatedExhaustionAt      = now + estimatedExhaustionMs;

      // Risk level
      if (hoursToExhaustion < 1)       riskLevel = 'critical';
      else if (hoursToExhaustion < 4)  riskLevel = 'high';
      else if (hoursToExhaustion < 12) riskLevel = 'medium';
      else                             riskLevel = 'low';
    } else if (dailyRemaining <= 0) {
      riskLevel = 'exhausted';
    } else {
      riskLevel = 'none'; // no activity yet
    }

    return {
      actorId,
      dailyUsed,
      dailyRemaining,
      dailyQuota,
      currentRatePerHour: Math.round(ratePerHour * 100) / 100,
      estimatedExhaustionMs,
      estimatedExhaustionAt,
      riskLevel,
      lookbackWindowMs: windowMs,
      forecastedAt: now,
      version: IDENTITY_QUOTA_FORECAST_VERSION_399,
    };
  }

  /**
   * forecastQuotaExhaustion399(actorId, opts?)
   * Predicts when the given actor will exhaust their daily quota.
   *
   * opts.lookbackWindowMs — time window to measure rate (default: 1 hour)
   * opts.snapshot         — append audit event
   *
   * Returns forecast object with riskLevel: 'none'|'low'|'medium'|'high'|'critical'|'exhausted'
   * Throws QUOTA_MANAGER_NOT_CONFIGURED if no quota manager was provided.
   */
  function forecastQuotaExhaustion399(actorId, opts = {}) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    if (!quotaManager) throw new Error('QUOTA_MANAGER_NOT_CONFIGURED');

    const lookbackWindowMs = typeof opts.lookbackWindowMs === 'number' && opts.lookbackWindowMs > 0
      ? opts.lookbackWindowMs : MS_PER_HOUR;

    // Get current quota status from V398 quota manager
    const status = quotaManager.checkQuota398(actorId);

    const forecast = _computeForecast(
      actorId,
      status.dailyUsed,
      status.dailyRemaining,
      status.dailyQuota,
      lookbackWindowMs
    );

    if (opts.snapshot === true) {
      _appendAudit({
        type: EVT_QUOTA_FORECAST_399,
        ts: forecast.forecastedAt,
        data: { actorId, riskLevel: forecast.riskLevel, estimatedExhaustionMs: forecast.estimatedExhaustionMs },
      });
    }

    return forecast;
  }

  /**
   * forecastAllActors399(opts?)
   * Batch forecast for all actors tracked by the quota manager.
   *
   * opts.lookbackWindowMs — look-back window (default: 1 hour)
   * opts.minUsage         — minimum daily usage to include (default: 0)
   * opts.riskLevel        — filter by risk level (optional)
   */
  function forecastAllActors399(opts = {}) {
    if (!quotaManager) throw new Error('QUOTA_MANAGER_NOT_CONFIGURED');

    const lookbackWindowMs = typeof opts.lookbackWindowMs === 'number' && opts.lookbackWindowMs > 0
      ? opts.lookbackWindowMs : MS_PER_HOUR;
    const minUsage  = typeof opts.minUsage === 'number' ? opts.minUsage : 0;
    const riskFilter = opts.riskLevel || null;

    const summary = quotaManager.getQuotaSummary398({ minUsage });
    const now     = Date.now();

    const forecasts = [];
    for (const actor of summary.actors) {
      const forecast = _computeForecast(
        actor.actorId,
        actor.dailyUsed,
        actor.dailyRemaining,
        actor.dailyQuota,
        lookbackWindowMs
      );
      if (riskFilter && forecast.riskLevel !== riskFilter) continue;
      forecasts.push(forecast);
    }

    // Sort by exhaustion risk: exhausted → critical → high → medium → low → none
    const riskOrder = { exhausted: 0, critical: 1, high: 2, medium: 3, low: 4, none: 5 };
    forecasts.sort((a, b) => (riskOrder[a.riskLevel] ?? 5) - (riskOrder[b.riskLevel] ?? 5));

    return {
      forecasts,
      totalActors: forecasts.length,
      riskBreakdown: {
        exhausted: forecasts.filter(f => f.riskLevel === 'exhausted').length,
        critical:  forecasts.filter(f => f.riskLevel === 'critical').length,
        high:      forecasts.filter(f => f.riskLevel === 'high').length,
        medium:    forecasts.filter(f => f.riskLevel === 'medium').length,
        low:       forecasts.filter(f => f.riskLevel === 'low').length,
        none:      forecasts.filter(f => f.riskLevel === 'none').length,
      },
      generatedAt: now,
      lookbackWindowMs,
      version: IDENTITY_QUOTA_FORECAST_VERSION_399,
    };
  }

  /**
   * getForecastSummary399(opts?)
   * Aggregate risk summary across all actors.
   * opts.lookbackWindowMs, opts.snapshot
   */
  function getForecastSummary399(opts = {}) {
    if (!quotaManager) throw new Error('QUOTA_MANAGER_NOT_CONFIGURED');

    const now      = Date.now();
    const allFcast = forecastAllActors399(opts);

    const atRisk = allFcast.forecasts.filter(f =>
      f.riskLevel === 'critical' || f.riskLevel === 'exhausted' || f.riskLevel === 'high'
    );

    const result = {
      totalActors: allFcast.totalActors,
      atRiskActors: atRisk,
      riskBreakdown: allFcast.riskBreakdown,
      generatedAt: now,
      version: IDENTITY_QUOTA_FORECAST_VERSION_399,
    };

    if (opts.snapshot === true) {
      _appendAudit({
        type: EVT_QUOTA_FORECAST_399,
        ts: now,
        data: { action: 'summary', totalActors: allFcast.totalActors, ...allFcast.riskBreakdown },
      });
    }

    return result;
  }

  return {
    forecastQuotaExhaustion399,
    forecastAllActors399,
    getForecastSummary399,
    IDENTITY_QUOTA_FORECAST_VERSION_399,
    EVT_QUOTA_FORECAST_399,
  };
}

module.exports = {
  createIdentityQuotaForecast399,
  IDENTITY_QUOTA_FORECAST_VERSION_399,
  EVT_QUOTA_FORECAST_399,
};
