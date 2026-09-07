'use strict';

/**
 * ISO20022Fields -- V114 Research Integration
 * -------------------------------------------------------------------------
 * Captures ISO 20022-compatible originator/beneficiary fields in audit events.
 *
 * ISO 20022: mandatory for cross-border payment messaging Nov 22, 2025.
 * FATF R.16 June 2025: Travel Rule integrated with ISO 20022.
 *
 * ECOS is closed-loop in Phase 0-1 (no money transmission). This module
 * pre-structures audit events for Phase 2 stablecoin rail integration
 * (Bridge, BVNK, Circle CPN) without any code changes to the audit chain.
 *
 * Purpose codes (ISO 20022 ExternalPurpose1Code subset):
 *   VALI -- Validation payment (validator earning)
 *   ROYL -- Royalty payment (patch author earning)
 *   GRNT -- Grant (free-tier or referral)
 *   RFND -- Refund
 *   TASK -- Task payment (client paying)
 *   PLTF -- Platform fee deduction
 */

const TRAVEL_RULE_THRESHOLD_USD = 3000; // US FinCEN threshold

const PURPOSE_CODES = {
  VALI: 'Validator compensation for human review task',
  ROYL: 'Royalty payment for knowledge patch reuse',
  GRNT: 'Platform credit grant (free tier or referral)',
  RFND: 'Refund of platform charges',
  TASK: 'Client payment for AI task processing',
  PLTF: 'Platform fee deduction',
};

/**
 * Build ISO 20022-compatible payment metadata for an audit event.
 * @returns {object} ISO 20022-compatible payment metadata
 */
function buildPaymentMetadata({
  originatorAccountId,
  originatorDisplayName,
  originatorJurisdiction = 'US',
  originatorEntityType   = 'individual',
  beneficiaryAccountId,
  beneficiaryDisplayName,
  beneficiaryJurisdiction = 'US',
  amountMicro,
  currency     = 'USD',
  purposeCode,
  referenceId  = null,
}) {
  if (!originatorAccountId)  throw new Error('iso20022Fields: originatorAccountId required');
  if (!beneficiaryAccountId) throw new Error('iso20022Fields: beneficiaryAccountId required');
  if (!PURPOSE_CODES[purposeCode]) throw new Error(`iso20022Fields: unknown purposeCode: ${purposeCode}`);

  const amountMicroStr = String(amountMicro !== undefined ? amountMicro : '0');
  const amountUsd      = Number(amountMicroStr) / 10_000; // 1 USD = 10,000 microcents
  const travelRuleRequired = amountUsd >= TRAVEL_RULE_THRESHOLD_USD;

  return {
    iso20022: {
      messageType:      'pacs.008.001.10',
      creationDateTime: new Date().toISOString(),
      originator: {
        accountId:   originatorAccountId,
        displayName: originatorDisplayName,
        jurisdiction: originatorJurisdiction,
        entityType:  originatorEntityType,
      },
      beneficiary: {
        accountId:   beneficiaryAccountId,
        displayName: beneficiaryDisplayName,
        jurisdiction: beneficiaryJurisdiction,
      },
      amount: {
        micro:          amountMicroStr,
        currency,
        usdEquivalent:  amountUsd.toFixed(4),
      },
      purposeCode,
      purposeDescription: PURPOSE_CODES[purposeCode],
      referenceId,
      compliance: {
        closedLoop:                true,
        travelRuleRequired,
        travelRuleThresholdUsd:    TRAVEL_RULE_THRESHOLD_USD,
        fatfR16Compliant:          true,
        isoMandatoryFromDate:      '2025-11-22',
      },
    },
  };
}

/**
 * Validate that a payment metadata object has all required ISO 20022 fields.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePaymentMetadata(meta) {
  const errors = [];
  const iso = meta && meta.iso20022;
  if (!iso)                          { errors.push('missing iso20022 key'); return { valid: false, errors }; }
  if (!iso.originator?.accountId)    errors.push('missing originator.accountId');
  if (!iso.beneficiary?.accountId)   errors.push('missing beneficiary.accountId');
  if (!iso.purposeCode)              errors.push('missing purposeCode');
  if (iso.purposeCode && !PURPOSE_CODES[iso.purposeCode]) errors.push(`unknown purposeCode: ${iso.purposeCode}`);
  return { valid: errors.length === 0, errors };
}

module.exports = { buildPaymentMetadata, validatePaymentMetadata, PURPOSE_CODES, TRAVEL_RULE_THRESHOLD_USD };
