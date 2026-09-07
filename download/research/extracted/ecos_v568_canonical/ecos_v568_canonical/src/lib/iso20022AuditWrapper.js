'use strict';

  /**
   * ISO20022AuditWrapper — V116 P12-07
   * ─────────────────────────────────────────────────────────────────────────────
   * Wraps value-moving audit events from fiatLedger with ISO 20022 metadata.
   * Sacred files (fiatLedger.js, auditLog.js) are NOT modified — this module
   * intercepts events post-emission and enriches them for compliance.
   *
   * Usage:
   *   const wrapper = new ISO20022AuditWrapper({ auditLog, iso20022Fields });
   *   wrapper.wrapHitlPayout({ originatorId, beneficiaryId, amountMicro, referenceId });
   *   wrapper.wrapRoyaltyPayout({ authorId, amountMicro, patchId });
   */

  const { buildPaymentMetadata } = require('./iso20022Fields');

  const EVENT_TYPES = {
    HITL_PAYOUT:   'HITL_PAYOUT_ISO20022',
    ROYALTY_PAYOUT:'ROYALTY_PAYOUT_ISO20022',
    TASK_CHARGE:   'TASK_CHARGE_ISO20022',
    REFUND:        'REFUND_ISO20022',
  };

  class ISO20022AuditWrapper {
    /**
     * @param {{ auditLog, logger? }} opts
     */
    constructor({ auditLog = null, logger = null } = {}) {
      this._auditLog = auditLog;
      this._log      = logger || console;
    }

    /**
     * Wrap a HITL payout event with ISO 20022 payment metadata.
     * Called after the fiatLedger has already credited the validator.
     */
    wrapHitlPayout({ originatorId = 'ECOS_PLATFORM', beneficiaryId, amountMicro, currency = 'USD', referenceId = null, originatorName = 'ECOS Platform', beneficiaryName = null }) {
      if (!beneficiaryId) throw new Error('ISO20022AuditWrapper.wrapHitlPayout: beneficiaryId required');
      if (!amountMicro)   throw new Error('ISO20022AuditWrapper.wrapHitlPayout: amountMicro required');

      const iso20022 = buildPaymentMetadata({
        originatorAccountId:    originatorId,
        originatorDisplayName:  originatorName,
        beneficiaryAccountId:   beneficiaryId,
        beneficiaryDisplayName: beneficiaryName || beneficiaryId,
        amountMicro,
        currency,
        purposeCode: 'VALI',
        referenceId,
      });

      this._emit(EVENT_TYPES.HITL_PAYOUT, { originatorId, beneficiaryId, amountMicro, currency, referenceId, iso20022 });
      return iso20022;
    }

    /**
     * Wrap a royalty payout event with ISO 20022 payment metadata.
     */
    wrapRoyaltyPayout({ authorId, amountMicro, patchId, currency = 'USD' }) {
      if (!authorId)    throw new Error('ISO20022AuditWrapper.wrapRoyaltyPayout: authorId required');
      if (!amountMicro) throw new Error('ISO20022AuditWrapper.wrapRoyaltyPayout: amountMicro required');

      const iso20022 = buildPaymentMetadata({
        originatorAccountId:    'ECOS_PLATFORM',
        originatorDisplayName:  'ECOS Platform',
        beneficiaryAccountId:   authorId,
        beneficiaryDisplayName: authorId,
        amountMicro,
        currency,
        purposeCode: 'ROYL',
        referenceId: patchId || null,
      });

      this._emit(EVENT_TYPES.ROYALTY_PAYOUT, { authorId, amountMicro, currency, patchId, iso20022 });
      return iso20022;
    }

    /**
     * Wrap a task charge event with ISO 20022 payment metadata.
     */
    wrapTaskCharge({ clientId, amountMicro, taskId, currency = 'USD' }) {
      if (!clientId)    throw new Error('ISO20022AuditWrapper.wrapTaskCharge: clientId required');
      if (!amountMicro) throw new Error('ISO20022AuditWrapper.wrapTaskCharge: amountMicro required');

      const iso20022 = buildPaymentMetadata({
        originatorAccountId:    clientId,
        originatorDisplayName:  clientId,
        beneficiaryAccountId:   'ECOS_PLATFORM',
        beneficiaryDisplayName: 'ECOS Platform',
        amountMicro,
        currency,
        purposeCode: 'TASK',
        referenceId: taskId || null,
      });

      this._emit(EVENT_TYPES.TASK_CHARGE, { clientId, amountMicro, currency, taskId, iso20022 });
      return iso20022;
    }

    _emit(type, data) {
      try {
        if (this._auditLog && typeof this._auditLog.append === 'function') {
          this._auditLog.append({ type, ...data, ts: new Date().toISOString() });
        }
      } catch (err) {
        this._log.warn?.({ err, type }, '[ISO20022AuditWrapper] emit failed');
      }
    }

    static eventTypes() { return { ...EVENT_TYPES }; }
  }

  module.exports = { ISO20022AuditWrapper, EVENT_TYPES };
  