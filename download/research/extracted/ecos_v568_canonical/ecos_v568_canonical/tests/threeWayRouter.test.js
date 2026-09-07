import { describe, it, expect } from 'vitest';
import { routeTask, isHighStakesDomain } from '../lib/threeWayRouter.js';

describe('ThreeWayRouter', () => {
  it('routes high-confidence to AUTO_FLOW', () => {
    const r = routeTask({ confidence: 0.85 });
    expect(r.verdict).toBe('AUTO_FLOW');
    expect(r.requiresQuorum).toBe(false);
  });

  it('routes mid-confidence non-high-stakes to BEGINNER_QUEUE', () => {
    const r = routeTask({ confidence: 0.60, domain: 'customer-service' });
    expect(r.verdict).toBe('BEGINNER_QUEUE');
    expect(r.requiresQuorum).toBe(false);
  });

  it('routes mid-confidence legal domain to SENIOR_QUEUE', () => {
    const r = routeTask({ confidence: 0.60, domain: 'legal' });
    expect(r.verdict).toBe('SENIOR_QUEUE');
  });

  it('routes mid-confidence insurance domain to SENIOR_QUEUE', () => {
    const r = routeTask({ confidence: 0.60, domain: 'insurance-claims' });
    expect(r.verdict).toBe('SENIOR_QUEUE');
  });

  it('routes low-confidence to SENIOR_QUEUE with quorum', () => {
    const r = routeTask({ confidence: 0.30 });
    expect(r.verdict).toBe('SENIOR_QUEUE');
    expect(r.requiresQuorum).toBe(true);
  });

  it('routes NaN confidence to SENIOR_QUEUE', () => {
    const r = routeTask({ confidence: NaN });
    expect(r.verdict).toBe('SENIOR_QUEUE');
  });

  it('respects quorumRequired override even at high confidence', () => {
    const r = routeTask({ confidence: 0.90, quorumRequired: true });
    expect(r.verdict).toBe('SENIOR_QUEUE');
    expect(r.requiresQuorum).toBe(true);
  });

  it('detects insurance as high-stakes', () => {
    expect(isHighStakesDomain('insurance')).toBe(true);
  });

  it('detects legal-document-review as high-stakes', () => {
    expect(isHighStakesDomain('legal-document-review')).toBe(true);
  });

  it('does not flag generic domains as high-stakes', () => {
    expect(isHighStakesDomain('customer-service')).toBe(false);
  });
});
