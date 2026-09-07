import { describe, it, expect } from 'vitest';
import { buildPaymentMetadata, validatePaymentMetadata, PURPOSE_CODES } from '../lib/iso20022Fields.js';

const base = {
  originatorAccountId:  'platform::ecos',
  originatorDisplayName:'ECOS Platform',
  beneficiaryAccountId: 'validator::alice',
  beneficiaryDisplayName:'Alice',
  amountMicro:           400000n,
  purposeCode:           'VALI',
};

describe('ISO20022Fields', () => {
  it('builds valid metadata for a validator payment', () => {
    const meta = buildPaymentMetadata(base);
    expect(meta.iso20022.originator.accountId).toBe('platform::ecos');
    expect(meta.iso20022.beneficiary.accountId).toBe('validator::alice');
    expect(meta.iso20022.purposeCode).toBe('VALI');
    expect(meta.iso20022.compliance.closedLoop).toBe(true);
    expect(meta.iso20022.compliance.fatfR16Compliant).toBe(true);
  });

  it('stores amountMicro as string (BigInt-safe)', () => {
    const meta = buildPaymentMetadata(base);
    expect(typeof meta.iso20022.amount.micro).toBe('string');
    expect(meta.iso20022.amount.micro).toBe('400000');
  });

  it('sets travelRuleRequired false for sub-threshold amounts', () => {
    const meta = buildPaymentMetadata({ ...base, amountMicro: 100n });
    expect(meta.iso20022.compliance.travelRuleRequired).toBe(false);
  });

  it('sets travelRuleRequired true for amounts >= $3000 USD', () => {
    const meta = buildPaymentMetadata({ ...base, amountMicro: 30_000_000n });
    expect(meta.iso20022.compliance.travelRuleRequired).toBe(true);
  });

  it('validates a well-formed metadata object', () => {
    const meta = buildPaymentMetadata(base);
    const { valid, errors } = validatePaymentMetadata(meta);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('rejects unknown purposeCode', () => {
    expect(() => buildPaymentMetadata({ ...base, purposeCode: 'XXXX' })).toThrow();
  });

  it('rejects empty originatorAccountId', () => {
    expect(() => buildPaymentMetadata({ ...base, originatorAccountId: '' })).toThrow();
  });

  it('exports all expected purpose codes', () => {
    expect(PURPOSE_CODES.VALI).toBeDefined();
    expect(PURPOSE_CODES.ROYL).toBeDefined();
    expect(PURPOSE_CODES.GRNT).toBeDefined();
    expect(PURPOSE_CODES.RFND).toBeDefined();
    expect(PURPOSE_CODES.TASK).toBeDefined();
    expect(PURPOSE_CODES.PLTF).toBeDefined();
  });
});
